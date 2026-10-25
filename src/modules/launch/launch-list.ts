import "server-only";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { db, isUniqueViolation, transaction } from "@/server/db";
import { serverEnv } from "@/server/env";
import { decryptField, encryptField } from "@/server/crypto";
import { rateLimit } from "@/server/http/rate-limit";
import { now } from "@/modules/shared/clock";
import { DomainError } from "@/modules/shared/errors";
import { normalizeRwandaMobile } from "@/modules/shared/phone";
import { normalizeHost } from "@/server/site-gate";

// Launch list (DR-045). The only personal data collected before launch: an e-mail address
// and/or a Rwanda mobile number, with consent, used once to say BeautyBOX is open. Each is
// stored encrypted and found again only through a keyed hash. Details typed together in one
// sign-up share a row; a detail that is already listed is never joined to another row (it may
// be a shared phone), only linked to it by hash, so a removal deletes the row it names and shows
// the operator any linked details to confirm with the person (scripts/ops/launch-list.ts).
// The answer never reveals whether someone was already on the list.

/** Version of the wording people agree to; bump it when the notice or the checkbox text changes. */
export const LAUNCH_CONSENT_VERSION = "2026-10-25";

/** The privacy notice's limit: details are deleted at the latest this long after the latest sign-up. */
export const LAUNCH_RETENTION_DAYS = 365;

const emailSchema = z.email().max(254);

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Keyed hash of a normalized contact detail: finds repeats without storing it in clear. */
export function launchContactHash(kind: "email" | "phone", value: string, key = serverEnv().TOKEN_HASH_SECRET): string {
  return createHmac("sha256", key).update(`launch-list:${kind}:${value}`, "utf8").digest("base64url");
}

export function launchListOpen(): boolean {
  return serverEnv().LAUNCH_LIST === "open";
}

type Contact = { email: string | null; phone: string | null };

/** Validates and normalizes what was typed; at least one way to reach the person is required. */
export function parseLaunchContact(input: { email?: string | null; phone?: string | null }): Contact {
  const rawEmail = input.email?.trim() ?? "";
  const rawPhone = input.phone?.trim() ?? "";
  const fieldErrors: { field: string; message: string }[] = [];
  const email = rawEmail ? normalizeEmail(rawEmail) : null;
  if (email && !emailSchema.safeParse(email).success) fieldErrors.push({ field: "email", message: "Enter a valid e-mail address." });
  let phone: string | null = null;
  if (rawPhone) {
    const parsed = normalizeRwandaMobile(rawPhone);
    if (parsed.ok) phone = parsed.e164;
    else fieldErrors.push({ field: "phone", message: "Enter a Rwanda mobile number, e.g. 078 123 4567." });
  }
  if (!rawEmail && !rawPhone) fieldErrors.push({ field: "email", message: "Enter an e-mail address or a phone number." });
  if (fieldErrors.length > 0) throw new DomainError("VALIDATION_ERROR", fieldErrors[0]!.message, { fieldErrors });
  return { email, phone };
}

export async function joinLaunchList(input: { email?: string | null; phone?: string | null; consent: boolean }, ctx: { client: string; host: string }): Promise<void> {
  if (!launchListOpen()) throw new DomainError("ACTION_NOT_ALLOWED", "The launch list is not open yet.");
  const contact = parseLaunchContact(input);
  if (input.consent !== true) {
    throw new DomainError("VALIDATION_ERROR", "Tick the box to agree before joining.", { fieldErrors: [{ field: "consent", message: "Required." }] });
  }
  await rateLimit("launchList", ctx.client);
  const at = now();
  const host = normalizeHost(ctx.host).slice(0, 253);
  const emailHash = contact.email ? launchContactHash("email", contact.email) : null;
  const phoneHash = contact.phone ? launchContactHash("phone", contact.phone) : null;
  const consent = { consentVersion: LAUNCH_CONSENT_VERSION, consentedAt: at };
  const submitted = (row: { emailHash: string | null; phoneHash: string | null }) =>
    (row.emailHash === null || row.emailHash === emailHash) && (row.phoneHash === null || row.phoneHash === phoneHash);
  const save = () =>
    transaction(async (tx) => {
      const existing = await tx.launchSignup.findMany({
        where: { OR: [...(emailHash ? [{ emailHash }] : []), ...(phoneHash ? [{ phoneHash }] : [])] },
        select: { id: true, emailHash: true, phoneHash: true },
      });
      // Fresh consent only for rows made up entirely of what was typed now: a row that also holds
      // a detail this sign-up did not give may be someone else's (a shared phone).
      const refresh = existing.filter(submitted).map((r) => r.id);
      if (refresh.length > 0) await tx.launchSignup.updateMany({ where: { id: { in: refresh } }, data: consent });
      // Details not listed yet go on a new row of their own, never onto an existing one; the row
      // remembers (as a keyed hash) the already-listed detail it was typed with, so a removal or
      // access request for either can show the other to the operator.
      const newEmail = contact.email && !existing.some((r) => r.emailHash === emailHash);
      const newPhone = contact.phone && !existing.some((r) => r.phoneHash === phoneHash);
      if (!newEmail && !newPhone) return;
      await tx.launchSignup.create({
        data: {
          ...(newEmail ? { emailHash: emailHash!, emailEncrypted: encryptField(contact.email!) } : {}),
          ...(newPhone ? { phoneHash: phoneHash!, phoneEncrypted: encryptField(contact.phone!) } : {}),
          ...(newPhone && emailHash && !newEmail ? { linkedEmailHash: emailHash } : {}),
          ...(newEmail && phoneHash && !newPhone ? { linkedPhoneHash: phoneHash } : {}),
          sourceHost: host,
          ...consent,
        },
      });
    });
  // Another sign-up listing one of these details at the same moment makes the insert fail; the
  // next attempt finds that row, leaves it where it is and adds only what is still missing.
  for (let attempt = 1; ; attempt++) {
    try {
      await save();
      return;
    } catch (error) {
      if (!isUniqueViolation(error) || attempt >= 3) throw error;
    }
  }
}

export type LaunchListEntry = { email: string | null; phone: string | null; consentVersion: string; consentedAt: Date; createdAt: Date };

function toEntry(r: { emailEncrypted: string | null; phoneEncrypted: string | null; consentVersion: string; consentedAt: Date; createdAt: Date }): LaunchListEntry {
  return {
    email: r.emailEncrypted ? decryptField(r.emailEncrypted) : null,
    phone: r.phoneEncrypted ? decryptField(r.phoneEncrypted) : null,
    consentVersion: r.consentVersion,
    consentedAt: r.consentedAt,
    createdAt: r.createdAt,
  };
}

/** Operator export (decrypted), oldest first. Only for scripts/ops/launch-list.ts. */
export async function exportLaunchList(): Promise<LaunchListEntry[]> {
  const rows = await db().launchSignup.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return rows.map(toEntry);
}

/**
 * Reads the detail an operator was given in a request: an e-mail address (also as
 * "Name <address>" or "mailto:address") or a Rwanda mobile number in any common format.
 * Anything else is refused, so "not on the list" only ever means the detail was looked up.
 */
export function parseListedDetail(raw: string): { kind: "email"; value: string } | { kind: "phone"; value: string } {
  let text = raw.trim();
  // One detail at a time: a pasted header line with several addresses is refused, not guessed at.
  if ((text.match(/@/g) ?? []).length > 1 || (text.match(/</g) ?? []).length > 1) {
    throw new DomainError("VALIDATION_ERROR", "Type one e-mail address or one number at a time.");
  }
  const bracketed = /<([^<>]+)>\s*$/.exec(text);
  if (bracketed) text = bracketed[1]!.trim();
  text = text.replace(/^mailto:/i, "").trim();
  if (text.includes("@")) {
    const email = normalizeEmail(text);
    if (emailSchema.safeParse(email).success) return { kind: "email", value: email };
    throw new DomainError("VALIDATION_ERROR", "That is not a valid e-mail address.");
  }
  const phone = normalizeRwandaMobile(text);
  if (phone.ok) return { kind: "phone", value: phone.e164 };
  throw new DomainError("VALIDATION_ERROR", "That is neither an e-mail address nor a Rwanda mobile number.");
}

function detailWhere(raw: string): { emailHash: string } | { phoneHash: string } {
  const parsed = parseListedDetail(raw);
  return parsed.kind === "email" ? { emailHash: launchContactHash("email", parsed.value) } : { phoneHash: launchContactHash("phone", parsed.value) };
}

export type LaunchListMatch = {
  /** The entry holding the detail (with anything typed together with it in the same sign-up). */
  entries: LaunchListEntry[];
  /** Details typed together with it in another sign-up: possibly the same person, possibly someone sharing a phone. */
  linked: { id: string; entry: LaunchListEntry }[];
};

async function matchDetail(detail: string) {
  const where = detailWhere(detail);
  const rows = await db().launchSignup.findMany({ where });
  const links = [
    "emailHash" in where ? { linkedEmailHash: where.emailHash } : { linkedPhoneHash: where.phoneHash },
    ...rows.flatMap((r) => [
      ...(r.emailHash ? [{ linkedEmailHash: r.emailHash }] : []),
      ...(r.phoneHash ? [{ linkedPhoneHash: r.phoneHash }] : []),
      ...(r.linkedEmailHash ? [{ emailHash: r.linkedEmailHash }] : []),
      ...(r.linkedPhoneHash ? [{ phoneHash: r.linkedPhoneHash }] : []),
    ]),
  ];
  const linked = await db().launchSignup.findMany({ where: { OR: links, id: { notIn: rows.map((r) => r.id) } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return { rows, linked };
}

/** Access request: what is held for one e-mail address or phone number, and what is linked to it (decrypted, for the operator). */
export async function findInLaunchList(detail: string): Promise<LaunchListMatch> {
  const { rows, linked } = await matchDetail(detail);
  return { entries: rows.map(toEntry), linked: linked.map((r) => ({ id: r.id, entry: toEntry(r) })) };
}

/**
 * Withdrawal or erasure for one e-mail address or phone number: deletes the entry holding it
 * (with anything typed together with it in the same sign-up). Details linked to it from another
 * sign-up are returned, not deleted: the operator confirms with the person that they are theirs
 * and then removes them with removeLaunchSignups.
 */
export async function removeFromLaunchList(detail: string): Promise<{ removed: number; linked: LaunchListMatch["linked"] }> {
  const { rows, linked } = await matchDetail(detail);
  const { count } = await db().launchSignup.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  return { removed: count, linked: linked.map((r) => ({ id: r.id, entry: toEntry(r) })) };
}

/** Removes entries the operator confirmed with the person (ids from findInLaunchList or removeFromLaunchList). */
export async function removeLaunchSignups(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { count } = await db().launchSignup.deleteMany({ where: { id: { in: ids } } });
  return count;
}

/** Deletes sign-ups whose latest consent is older than the given number of days. Returns how many were removed. */
export async function purgeLaunchList(olderThanDays: number): Promise<number> {
  const cutoff = new Date(now().getTime() - olderThanDays * 24 * 60 * 60 * 1000);
  const { count } = await db().launchSignup.deleteMany({ where: { consentedAt: { lt: cutoff } } });
  return count;
}

import "server-only";
import { db, transaction } from "@/server/db";
import { DomainError, notFound } from "@/modules/shared/errors";
import { claimIdempotencyKey, completeIdempotencyKey, requestHash } from "@/modules/idempotency/idempotency";
import { audit } from "@/modules/audit/audit";
import type { StaffIdentity } from "./identity";
import type { StaffRole } from "./capabilities";

// Staff membership (A09). Invitations and passwords live in Supabase Auth through a
// controlled procedure; this module manages only roles and activation of established
// members. Every change is versioned, reasoned and audited.

export type StaffMemberView = { id: string; displayName: string; role: StaffRole; isActive: boolean; version: number };

const view = (m: { id: string; displayName: string; role: StaffRole; isActive: boolean; version: number }): StaffMemberView => ({
  id: m.id,
  displayName: m.displayName,
  role: m.role,
  isActive: m.isActive,
  version: m.version,
});

export async function getMe(staff: StaffIdentity): Promise<StaffMemberView> {
  return view(await db().staffMember.findUniqueOrThrow({ where: { id: staff.staffId } }));
}

export async function listMembers(input: { limit?: number; cursor?: string | null }) {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 50);
  const rows = await db().staffMember.findMany({
    orderBy: [{ displayName: "asc" }, { id: "asc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  return { items: rows.slice(0, limit).map(view), nextCursor: rows.length > limit ? rows[limit - 1]!.id : null };
}

export async function setStaffRole(
  actor: StaffIdentity,
  memberId: string,
  input: { expectedVersion: number; role: StaffRole; isActive: boolean; reason: string },
  idempotencyKey: string,
  requestId: string | null,
): Promise<StaffMemberView> {
  if (!input.reason.trim()) throw new DomainError("VALIDATION_ERROR", "Give a reason for this change.", { fieldErrors: [{ field: "reason", message: "Required." }] });
  const id = await transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, {
      scope: `staff:${actor.staffId}:set-role:${memberId}`,
      key: idempotencyKey,
      requestHash: requestHash("setStaffRole", input),
    });
    if (claim.kind === "REPLAY") return claim.resourceId;
    // Serialize all membership changes so "last active admin" cannot race.
    await tx.$queryRaw`SELECT id FROM commerce.staff_members WHERE role = 'ADMIN' AND is_active ORDER BY id FOR UPDATE`;
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM commerce.staff_members WHERE id = ${memberId}::uuid FOR UPDATE`;
    if (rows.length === 0) throw notFound();
    const member = await tx.staffMember.findUniqueOrThrow({ where: { id: memberId } });
    if (member.version !== input.expectedVersion) {
      throw new DomainError("VERSION_CONFLICT", "This staff record changed. Reload and try again.");
    }
    const losesAdmin = member.role === "ADMIN" && member.isActive && (input.role !== "ADMIN" || !input.isActive);
    if (losesAdmin) {
      const activeAdmins = await tx.staffMember.count({ where: { role: "ADMIN", isActive: true } });
      if (activeAdmins <= 1) throw new DomainError("ACTION_NOT_ALLOWED", "There must always be at least one active administrator.");
    }
    const reduced = member.role !== input.role || (member.isActive && !input.isActive);
    const updated = await tx.staffMember.update({
      where: { id: memberId },
      data: {
        role: input.role,
        isActive: input.isActive,
        version: { increment: 1 },
        roleVersion: reduced ? { increment: 1 } : undefined,
      },
    });
    await audit(tx, {
      actor: { type: "STAFF", id: actor.staffId },
      entityType: "staff_member",
      entityId: memberId,
      action: "STAFF_ROLE_CHANGED",
      before: { role: member.role, isActive: member.isActive },
      after: { role: updated.role, isActive: updated.isActive },
      reason: input.reason.trim(),
      requestId,
    });
    await completeIdempotencyKey(tx, claim.recordId, { resourceType: "staff_member", resourceId: memberId, responseStatus: 200 });
    return memberId;
  });
  // Privileges drop on the very next request because every request reads this table;
  // revoking the Supabase refresh tokens is an additional step done with the secret key.
  return view(await db().staffMember.findUniqueOrThrow({ where: { id } }));
}

/** Controlled bootstrap used by `npm run staff:grant` (not reachable over HTTP). */
export async function grantStaffMembership(input: { authUserId: string; email: string; displayName: string; role: StaffRole; reason: string }) {
  return transaction(async (tx) => {
    const existing = await tx.staffMember.findUnique({ where: { authUserId: input.authUserId } });
    const member = existing
      ? await tx.staffMember.update({ where: { id: existing.id }, data: { role: input.role, isActive: true, version: { increment: 1 }, roleVersion: { increment: 1 } } })
      : await tx.staffMember.create({ data: { authUserId: input.authUserId, email: input.email.toLowerCase(), displayName: input.displayName, role: input.role } });
    await audit(tx, {
      actor: { type: "SYSTEM", id: "staff-grant-script" },
      entityType: "staff_member",
      entityId: member.id,
      action: existing ? "STAFF_REGRANTED" : "STAFF_GRANTED",
      after: { role: input.role },
      reason: input.reason,
    });
    return member;
  });
}

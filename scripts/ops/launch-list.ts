// Launch list operations (DR-045), run by the founder or an operator with the environment's
// settings file (.env.staging.local). Personal data: an export is written under .local/,
// readable by this Windows user only, and is never uploaded or committed. People's details are
// typed at a prompt, never on the command line (npm logs and shell history keep command lines).
//   npm run launch-list -- count
//   npm run launch-list -- find                 (asks for an e-mail or number; for an access request)
//   npm run launch-list -- remove               (asks for an e-mail or number; for a removal request)
//   npm run launch-list -- export               -> .local/launch-list-<time>.csv
//   npm run launch-list -- purge --older-than-days 365   (also done automatically by the job runner)
//   npm run launch-list -- purge --all --yes    (after the launch message: deletes the whole list)
import fs from "node:fs";
import path from "node:path";
import { db } from "@/server/db";
import { exportLaunchList, findInLaunchList, purgeLaunchList, removeFromLaunchList, removeLaunchSignups, type LaunchListEntry } from "@/modules/launch/launch-list";
import { arg, promptLine, restrictToCurrentUser } from "../lib/env-file";

/**
 * Quoted CSV cell. E-mail addresses and numbers were validated at sign-up (an address cannot
 * hold a formula; numbers are +2507…), so they are written exactly, ready for a mailing or
 * SMS upload; anything else that could start a spreadsheet formula is defused.
 */
function csvCell(value: string, validated = false): string {
  const safe = !validated && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function describe(entry: LaunchListEntry): string {
  return `e-mail ${entry.email ?? "(none)"}, number ${entry.phone ?? "(none)"}, agreed to notice ${entry.consentVersion} on ${entry.consentedAt.toISOString().slice(0, 10)}, joined ${entry.createdAt.toISOString().slice(0, 10)}`;
}

async function askForDetail(): Promise<string> {
  if (arg("who") !== undefined) throw new Error("type the e-mail address or number at the prompt instead of --who (command lines are logged)");
  const detail = await promptLine("E-mail address or Rwanda mobile number: ");
  if (!detail) throw new Error("nothing was typed");
  return detail;
}

async function main() {
  const command = process.argv[2];
  if (command === "count") {
    console.log(`[launch-list] ${await db().launchSignup.count()} sign-ups`);
  } else if (command === "find") {
    const { entries, linked } = await findInLaunchList(await askForDetail());
    if (entries.length === 0) console.log("[launch-list] not on the list");
    for (const entry of entries) console.log(`[launch-list] listed: ${describe(entry)}`);
    for (const { entry } of linked) console.log(`[launch-list] typed together with it in another sign-up (check with the person that it is theirs): ${describe(entry)}`);
  } else if (command === "remove") {
    const { removed, linked } = await removeFromLaunchList(await askForDetail());
    console.log(removed > 0 ? `[launch-list] removed ${removed} entr${removed === 1 ? "y" : "ies"} (with anything typed together with it in the same sign-up)` : "[launch-list] not on the list");
    if (linked.length > 0) {
      console.log("[launch-list] these details were typed together with it in another sign-up. They may be the same person's, or someone sharing a phone:");
      for (const { entry } of linked) console.log(`  - ${describe(entry)}`);
      const answer = await promptLine("Remove these too? Only if the person confirmed they are theirs. Type yes to remove: ");
      if (answer.toLowerCase() === "yes") console.log(`[launch-list] removed ${await removeLaunchSignups(linked.map((l) => l.id))} more`);
      else console.log("[launch-list] kept");
    }
  } else if (command === "export") {
    const rows = await exportLaunchList();
    const out = path.resolve(".local", `launch-list-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const lines = [
      "email,phone,consent_version,consented_at,joined_at",
      ...rows.map((r) => [csvCell(r.email ?? "", true), csvCell(r.phone ?? "", true), csvCell(r.consentVersion), csvCell(r.consentedAt.toISOString()), csvCell(r.createdAt.toISOString())].join(",")),
    ];
    fs.writeFileSync(out, "", { mode: 0o600 });
    restrictToCurrentUser(out); // before any personal data is in it
    fs.writeFileSync(out, `${lines.join("\n")}\n`);
    console.log(`[launch-list] ${rows.length} sign-ups written to ${out}. Delete the file once the launch message is sent.`);
  } else if (command === "purge" && process.argv.includes("--all")) {
    if (!process.argv.includes("--yes")) throw new Error("this deletes the whole list: add --yes to confirm");
    const { count } = await db().launchSignup.deleteMany({});
    console.log(`[launch-list] deleted all ${count} sign-ups`);
  } else if (command === "purge") {
    const days = Number(arg("older-than-days"));
    if (!Number.isInteger(days) || days < 1) throw new Error("give --older-than-days <whole number>");
    console.log(`[launch-list] deleted ${await purgeLaunchList(days)} sign-ups older than ${days} days`);
  } else {
    throw new Error("usage: launch-list.ts count | find | remove | export | purge --older-than-days <n> | purge --all --yes");
  }
}

main()
  .then(() => db().$disconnect())
  .catch(async (error) => {
    console.error("[launch-list] failed:", error instanceof Error ? error.message : "unknown error");
    await db().$disconnect();
    process.exit(1);
  });

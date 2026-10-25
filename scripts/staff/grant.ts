// Controlled staff bootstrap (handoff Security-and-Operations: "Seed the first administrator
// through a controlled operational procedure, not a public route").
//
// 1. An administrator creates or invites the person in Supabase Auth (dashboard:
//    Authentication -> Users), with public sign-ups disabled.
// 2. Run, with the person's Supabase user UID:
//    npm run staff:grant -- --auth-user-id <uuid> --email <email> --name "<display name>" --role ADMIN --reason "<why>"
// The membership row is what grants access; Supabase metadata never does.
import { grantStaffMembership } from "@/modules/staff/members";
import { db } from "@/server/db";
import { serverEnv } from "@/server/env";

// A value runs until the next --flag: npm on Windows PowerShell drops the quotes around
// multi-word values such as a display name or reason.
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const words: string[] = [];
  for (const word of process.argv.slice(i + 1)) {
    if (word.startsWith("--")) break;
    words.push(word);
  }
  return words.length ? words.join(" ") : undefined;
}

async function main() {
  const authUserId = arg("auth-user-id");
  const email = arg("email");
  const displayName = arg("name");
  const role = arg("role");
  const reason = arg("reason");
  if (!authUserId || !/^[0-9a-f-]{36}$/i.test(authUserId) || !email || !displayName || !role || !reason) {
    console.error('usage: npm run staff:grant -- --auth-user-id <uuid> --email <email> --name "<name>" --role ADMIN|OPERATIONS|FINANCE|SUPPORT --reason "<why>"');
    process.exit(1);
  }
  if (!["ADMIN", "OPERATIONS", "FINANCE", "SUPPORT"].includes(role)) {
    console.error("role must be ADMIN, OPERATIONS, FINANCE or SUPPORT");
    process.exit(1);
  }
  const member = await grantStaffMembership({
    authUserId: authUserId.toLowerCase(),
    email,
    displayName,
    role: role as "ADMIN" | "OPERATIONS" | "FINANCE" | "SUPPORT",
    reason,
  });
  console.log(`[staff] ${member.displayName} is ${member.role} (active) in ${serverEnv().APP_ENV}. Two-step verification is required at first sign-in.`);
}

main()
  .then(() => db().$disconnect())
  .catch(async (error) => {
    console.error("[staff] failed:", error instanceof Error ? error.message : error);
    await db().$disconnect();
    process.exit(1);
  });

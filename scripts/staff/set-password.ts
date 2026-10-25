// Controlled staff password set, run by an operator (Phase 1 has no self-service reset page).
//
//   npm run staff:set-password -- --email <staff email> --reason "<why>"
//
// The new password is typed into a hidden prompt in an interactive terminal. It is never
// accepted from arguments or a pipe, so it stays out of shell history, process lists and
// logs, and it is never stored by BeautyBOX: Supabase Auth keeps only its hash. Works only
// for an active staff member already granted with `npm run staff:grant`. The change is
// audited (without the password). Uses the server-only SUPABASE_SECRET_KEY.
import type { ReadStream } from "node:tty";
import { createClient } from "@supabase/supabase-js";
import { passwordProblem, STAFF_PASSWORD_MAX_BYTES, STAFF_PASSWORD_MIN } from "@/lib/staff-password";
import { audit } from "@/modules/audit/audit";
import { db, transaction } from "@/server/db";
import { serverEnv } from "@/server/env";

// A value runs until the next --flag: npm on Windows PowerShell drops the quotes around
// multi-word values, so "--reason first password" arrives as separate words.
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

function hiddenPrompt(question: string): Promise<string> {
  const stdin = process.stdin as ReadStream;
  process.stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const done = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        // An empty Enter is ignored: the terminal can deliver the newline that started the
        // command, which would otherwise end the prompt before anything is typed.
        if ((ch === "\r" || ch === "\n") && value === "") continue;
        if (ch === "\r" || ch === "\n") return (done(), resolve(value));
        if (ch === "\u0003") return (done(), reject(new Error("cancelled")));
        if (ch === "\b" || ch === "\u007f") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const reason = arg("reason")?.trim();
  if (!email || !reason) {
    console.error('usage: npm run staff:set-password -- --email <staff email> --reason "<why>"');
    process.exit(1);
  }
  if (!process.stdin.isTTY) {
    console.error("[staff] run this in an interactive terminal: the password is typed at a hidden prompt, never piped or passed as an argument.");
    process.exit(1);
  }
  const env = serverEnv();
  if (env.STAFF_AUTH_PROVIDER !== "supabase" || !env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    console.error("[staff] needs STAFF_AUTH_PROVIDER=supabase, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in the environment file.");
    process.exit(1);
  }

  const member = await db().staffMember.findUnique({ where: { email } });
  if (!member || !member.isActive) {
    console.error(`[staff] ${email} is not an active staff member. Grant the role first with npm run staff:grant.`);
    process.exit(1);
  }

  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: found, error: lookupError } = await supabase.auth.admin.getUserById(member.authUserId);
  if (lookupError || found.user?.email?.toLowerCase() !== email) {
    console.error("[staff] the Supabase Auth user for this staff member was not found or has a different email; nothing changed.");
    process.exit(1);
  }

  console.log(`[staff] New password for ${member.displayName} (${email}, ${member.role}) in ${env.APP_ENV}, Supabase project ${new URL(env.NEXT_PUBLIC_SUPABASE_URL).host}.`);
  console.log(`[staff] Typing is hidden. Use at least ${STAFF_PASSWORD_MIN} characters (at most ${STAFF_PASSWORD_MAX_BYTES} bytes); a password manager's generated password is best.`);
  // Problems are retried inside the prompt, so the operator is never dropped back to the
  // shell mid-procedure (where a typed password would run as a command and enter history).
  let password = "";
  let repeat = "";
  for (let attempt = 1; ; attempt++) {
    password = await hiddenPrompt("New password: ");
    repeat = await hiddenPrompt("Repeat it:    ");
    const problem = passwordProblem(password, repeat);
    if (!problem) break;
    if (attempt === 3) {
      console.error(`[staff] ${problem} Nothing changed. Run the command again when ready; type passwords only at its prompt, never at the shell prompt.`);
      process.exit(1);
    }
    console.error(`[staff] ${problem} Try again (attempt ${attempt + 1} of 3).`);
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(member.authUserId, { password });
  password = "";
  repeat = "";
  if (updateError) {
    // Supabase explains policy failures (for example a weak or leaked password) without echoing it.
    console.error(`[staff] Supabase refused the change: ${updateError.message}`);
    process.exit(1);
  }

  await transaction((tx) =>
    audit(tx, {
      actor: { type: "SYSTEM", id: "staff-set-password-script" },
      entityType: "staff_member",
      entityId: member.id,
      action: "STAFF_PASSWORD_SET",
      reason,
    }),
  );
  console.log(`[staff] Password updated. Sign in at ${env.APP_ORIGIN}/staff/sign-in; two-step verification setup follows if none is enrolled.`);
}

main()
  .then(() => db().$disconnect())
  .catch(async (error) => {
    console.error("[staff] failed:", error instanceof Error ? error.message : "unknown error");
    await db().$disconnect();
    process.exit(1);
  });

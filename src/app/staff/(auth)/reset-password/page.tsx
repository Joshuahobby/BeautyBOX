"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { TextField } from "@/components/ui/TextField";
import { LINK_PROBLEM_TEXT, linkProblemFromCode, passwordProblem, readResetLink, STAFF_PASSWORD_MIN, type LinkProblem } from "@/lib/staff-password";
import { staffAuthClient } from "@/lib/supabase-browser";
import styles from "@/components/staff/Staff.module.css";

// Self-service staff password reset, step 2 (DR-040). The emailed link brings a one-time
// code; the Supabase browser client exchanges it for a session as the page loads (PKCE, so
// only in the browser that asked for the link). The page continues only when THIS visit
// exchanged a code: it never offers to change the password of a session that was already
// signed in here (for example another staff member's on a shared computer). For an account
// with a verified authenticator, Supabase itself refuses a password change below aal2, so the
// page asks for the code first; mailbox access alone cannot change that account's password.
// An account that has not enrolled an authenticator yet is protected by its mailbox only.
// Supabase ends the account's other sessions when the password changes; a page already open
// elsewhere keeps working until its access token expires (one hour by default).

type Stage =
  | { kind: "loading" }
  | { kind: "linkProblem"; problem: LinkProblem }
  | { kind: "code"; factorId: string; email: string }
  | { kind: "choose"; twoStepDone: boolean; email: string }
  | { kind: "error"; message: string };

const UNAVAILABLE = "Password reset is unavailable right now. Try again shortly, or ask the BeautyBOX administrator.";

async function runSetup(href: string): Promise<Stage> {
  const link = readResetLink(href);
  if (link.problem) return { kind: "linkProblem", problem: link.problem };
  if (!link.hasCode) return { kind: "linkProblem", problem: "missing" };
  try {
    const auth = staffAuthClient().auth;
    // initialize() is where the client exchanged the link's code; it reports a failed exchange.
    const { error: exchangeError } = await auth.initialize();
    if (exchangeError) {
      const code = (exchangeError as { code?: string; details?: { code?: string } }).details?.code ?? (exchangeError as { code?: string }).code;
      return { kind: "linkProblem", problem: linkProblemFromCode(code) };
    }
    // auth-js removes `code` from the address only after exchanging it. If it is still there,
    // this browser holds no code verifier (the link was requested elsewhere) and any session
    // present belongs to an earlier sign-in, which must not be used here.
    if (new URL(window.location.href).searchParams.has("code")) return { kind: "linkProblem", problem: "otherBrowser" };
    const { data: user } = await auth.getUser();
    if (!user.user) return { kind: "linkProblem", problem: "invalid" };
    const email = user.user.email ?? "";
    const { data: factors, error: listError } = await auth.mfa.listFactors();
    if (listError) throw listError;
    const { data: aal, error: aalError } = await auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalError) throw aalError;
    const verified = (factors?.totp as { id: string; status: string }[] | undefined)?.find((f) => f.status === "verified");
    if (verified && aal?.currentLevel !== "aal2") return { kind: "code", factorId: verified.id, email };
    return { kind: "choose", twoStepDone: aal?.currentLevel === "aal2", email };
  } catch (error) {
    const detail = error as { code?: string; name?: string } | null;
    console.error("[staff reset] setup failed:", detail?.code ?? detail?.name ?? "unknown");
    return { kind: "error", message: UNAVAILABLE };
  }
}

// One setup per page load (React runs effects twice in development).
let setupInFlight: Promise<Stage> | null = null;
function setupOnce(href: string): Promise<Stage> {
  setupInFlight ??= runSetup(href).finally(() => {
    setupInFlight = null;
  });
  return setupInFlight;
}

export default function StaffResetPasswordPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // Read the link before the Supabase client is created: it consumes and removes the code.
    const href = window.location.href;
    void setupOnce(href).then((next) => {
      // Never leave the one-time code or Supabase's error text in the address bar or history.
      window.history.replaceState(window.history.state, "", window.location.pathname);
      if (active) setStage(next);
    });
    return () => {
      active = false;
    };
  }, []);

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    if (stage.kind !== "code") return;
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: verifyError } = await staffAuthClient().auth.mfa.challengeAndVerify({ factorId: stage.factorId, code: code.trim() });
    setBusy(false);
    if (verifyError) {
      setError("That code did not work. Check the time on your phone and try the newest code.");
      return;
    }
    setCode("");
    setStage({ kind: "choose", twoStepDone: true, email: stage.email });
  }

  async function choosePassword(event: React.FormEvent) {
    event.preventDefault();
    if (stage.kind !== "choose") return;
    const problem = passwordProblem(password, repeat);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const auth = staffAuthClient().auth;
      const { error: updateError } = await auth.updateUser({ password });
      if (updateError) {
        const reasons = (updateError as { reasons?: string[] }).reasons;
        setError(
          updateError.code === "same_password"
            ? "That is already your password. Choose a new one."
            : updateError.code === "weak_password"
              ? `Choose a stronger password${reasons?.length ? ` (${reasons.join(", ")})` : ""}.`
              : updateError.code === "insufficient_aal"
                ? "Two-step verification is needed first. Reload this page and enter your authenticator code."
                : UNAVAILABLE,
        );
        return;
      }
      setPassword("");
      setRepeat("");
      // Supabase already ends the other sessions on a password change; this repeats it
      // explicitly in case that server behaviour changes.
      await auth.signOut({ scope: "others" });
      router.replace(stage.twoStepDone ? "/staff" : "/staff/mfa");
      router.refresh();
    } catch {
      setError(UNAVAILABLE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.authPage}>
      <div className={styles.authCard}>
        <h1 className="page-title">Choose a new password</h1>
        {stage.kind === "loading" ? <p role="status">Checking your reset link</p> : null}
        {stage.kind === "error" ? (
          <Notice tone="danger" role="alert" title={stage.message} actions={<Button variant="secondary" onClick={() => window.location.reload()}>Try again</Button>} />
        ) : null}
        {stage.kind === "linkProblem" ? (
          <Notice tone="warning" role="alert" title={LINK_PROBLEM_TEXT[stage.problem]} actions={<ButtonLink href="/staff/forgot-password" variant="secondary">Request a new link</ButtonLink>}>
            <p>Reset links work once, for a short time, in the browser that requested them.</p>
          </Notice>
        ) : null}
        {stage.kind === "code" ? (
          <form onSubmit={verifyCode} className="stack-3" noValidate>
            <p className="label-text muted">Account: {stage.email}</p>
            <p>Your account uses two-step verification. Enter the 6-digit code from your authenticator app before choosing a new password.</p>
            <TextField
              id="reset-mfa-code"
              label="Verification code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              error={error}
            />
            <Button type="submit" full busy={busy} busyLabel="Verifying">
              Verify
            </Button>
            <p className="label-text muted">Lost your authenticator app? Ask the BeautyBOX administrator to reset your two-step verification.</p>
          </form>
        ) : null}
        {stage.kind === "choose" ? (
          <form onSubmit={choosePassword} className="stack-3" noValidate>
            <p className="label-text muted">Account: {stage.email}</p>
            {error ? <Notice tone="danger" title={error} role="alert" /> : null}
            <TextField
              id="reset-new-password"
              label="New password"
              type="password"
              autoComplete="new-password"
              minLength={STAFF_PASSWORD_MIN}
              help={`At least ${STAFF_PASSWORD_MIN} characters. A password manager's generated password is best.`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <TextField id="reset-repeat-password" label="Repeat new password" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
            <Button type="submit" full busy={busy} busyLabel="Saving">
              Save new password
            </Button>
            <p className="label-text muted">Saving signs this account out on other devices. A page already open there can keep working for up to an hour.</p>
          </form>
        ) : null}
        <p className="label-text">
          <Link href="/staff/sign-in">Back to sign in</Link>
        </p>
      </div>
    </main>
  );
}

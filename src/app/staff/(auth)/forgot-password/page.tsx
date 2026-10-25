"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { TextField } from "@/components/ui/TextField";
import { staffAuthClient } from "@/lib/supabase-browser";
import styles from "@/components/staff/Staff.module.css";

// Self-service staff password reset, step 1 (DR-040): Supabase emails a one-time link that
// opens /staff/reset-password. The page answers the same whether or not the address belongs
// to a staff account, including when Supabase's per-address email limit applies (that
// limit only exists for real accounts). Supabase's public /recover endpoint can still hint
// at which addresses exist (timing, its per-address limit), which is why public sign-ups
// stay off and CAPTCHA is on the release checklist.
export default function StaffForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError("Enter the email address of your staff account.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: resetError } = await staffAuthClient().auth.resetPasswordForEmail(address, {
        redirectTo: `${window.location.origin}/staff/reset-password`,
      });
      // The network-wide limit is the same for every address, so it can be shown as it is.
      if (resetError?.code === "over_request_rate_limit") {
        setError("Too many requests from this network. Wait a few minutes, then try again.");
        return;
      }
      // Any other rate limit is per address and so only hits real accounts: answer as sent.
      if (resetError && resetError.status !== 429) throw resetError;
      setSent(true);
    } catch {
      setError("Password reset is unavailable right now. Try again shortly, or ask the BeautyBOX administrator.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.authPage}>
      <form className={styles.authCard} onSubmit={submit} noValidate>
        <h1 className="page-title">Reset your password</h1>
        {sent ? (
          <Notice
            role="status"
            title="Check your email"
            actions={
              <Button variant="secondary" type="button" onClick={() => setSent(false)}>
                Send another link
              </Button>
            }
          >
            <p>
              If {email.trim()} belongs to a staff account, a reset link is on its way. Open it in this browser: it works once and expires soon. Nothing after a few minutes? Check spam, wait a little
              longer before asking for another link, or ask the BeautyBOX administrator.
            </p>
          </Notice>
        ) : (
          <>
            <p className="muted label-text">Enter the email address of your staff account. We will email you a link to choose a new password.</p>
            {error ? <Notice tone="danger" title={error} role="alert" /> : null}
            <TextField id="reset-email" label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button type="submit" full busy={busy} busyLabel="Sending">
              Email me a reset link
            </Button>
          </>
        )}
        <p className="label-text">
          <Link href="/staff/sign-in">Back to sign in</Link>
        </p>
      </form>
    </main>
  );
}

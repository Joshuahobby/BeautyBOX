"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { TextField } from "@/components/ui/TextField";
import { staffAuthClient } from "@/lib/supabase-browser";
import styles from "@/components/staff/Staff.module.css";

// A10 staff sign-in. Individual accounts only (invited through the controlled Supabase
// procedure); there is no public sign-up. Two-step verification follows on /staff/mfa.
export default function StaffSignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: signInError } = await staffAuthClient().auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) {
        // Same message for unknown email and wrong password.
        setError("The email or password is incorrect, or this account is not active.");
        return;
      }
      router.replace("/staff/mfa");
      router.refresh();
    } catch {
      setError("Staff sign-in is unavailable right now. Try again shortly.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.authPage}>
      <form className={styles.authCard} onSubmit={submit} noValidate>
        <h1 className="page-title">Staff sign in</h1>
        <p className="muted label-text">Use your own BeautyBOX staff account. Shared accounts are not allowed.</p>
        {error ? <Notice tone="danger" title={error} role="alert" /> : null}
        <TextField id="staff-email" label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField id="staff-password" label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" full busy={busy} busyLabel="Signing in">
          Sign in
        </Button>
        <p className="label-text">
          <Link href="/staff/forgot-password">Forgotten your password?</Link>
        </p>
        <p className="label-text muted">Lost your authenticator app? Ask the BeautyBOX administrator to reset your two-step verification.</p>
      </form>
    </main>
  );
}

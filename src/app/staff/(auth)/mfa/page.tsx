"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { TextField } from "@/components/ui/TextField";
import { staffAuthClient } from "@/lib/supabase-browser";
import styles from "@/components/staff/Staff.module.css";

type Stage =
  | { kind: "loading" }
  | { kind: "signedOut" }
  | { kind: "enroll"; factorId: string; qr: string; secret: string }
  | { kind: "verify"; factorId: string }
  | { kind: "error"; message: string };

type Setup = Stage | { kind: "alreadyVerified" };

const UNAVAILABLE = "Two-step verification is unavailable right now. Try again shortly.";

async function runSetup(): Promise<Setup> {
  try {
    const auth = staffAuthClient().auth;
    const { data: user } = await auth.getUser();
    if (!user.user) return { kind: "signedOut" };
    const { data: aal } = await auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === "aal2") return { kind: "alreadyVerified" };
    const { data: factors, error: listError } = await auth.mfa.listFactors();
    if (listError) throw listError;
    const verified = (factors?.totp as { id: string; status: string }[] | undefined)?.find((f) => f.status === "verified");
    if (verified) return { kind: "verify", factorId: verified.id };
    // Remove abandoned, never-verified enrolments before starting a new one.
    for (const f of (factors?.all ?? []) as { id: string; status: string }[]) {
      if (f.status === "verified") continue;
      const { error: unenrollError } = await auth.mfa.unenroll({ factorId: f.id });
      if (unenrollError && unenrollError.code !== "mfa_factor_not_found") throw unenrollError;
    }
    // Supabase requires a unique factor name per user, so each enrolment gets its own.
    const friendlyName = `BeautyBOX staff ${new Date().toISOString().slice(0, 10)} ${crypto.randomUUID().slice(0, 8)}`;
    const { data, error: enrollError } = await auth.mfa.enroll({ factorType: "totp", friendlyName });
    if (enrollError || !data) throw enrollError ?? new Error("enroll failed");
    return { kind: "enroll", factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
  } catch (error) {
    // Error codes only (never tokens or secrets), so a failure can be diagnosed from the console.
    const detail = error as { code?: string; name?: string } | null;
    console.error("[staff mfa] setup failed:", detail?.code ?? detail?.name ?? "unknown");
    return { kind: "error", message: UNAVAILABLE };
  }
}

// One setup at a time per page load. React runs effects twice in development, and two
// concurrent enrolments collided on Supabase's unique factor name (seen 2026-10-23).
let setupInFlight: Promise<Setup> | null = null;
function setupOnce(): Promise<Setup> {
  setupInFlight ??= runSetup().finally(() => {
    setupInFlight = null;
  });
  return setupInFlight;
}

// Two-step verification (TOTP) is required for every staff account. The server checks
// the session's assurance level (aal2) on every staff request; this page only gets the
// session to aal2.
export default function StaffMfaPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void setupOnce().then((result) => {
      if (!active) return;
      if (result.kind === "alreadyVerified") {
        router.replace("/staff");
        router.refresh();
        return;
      }
      setStage(result);
    });
    return () => {
      active = false;
    };
  }, [router]);

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (stage.kind !== "enroll" && stage.kind !== "verify") return;
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
    router.replace("/staff");
    router.refresh();
  }

  return (
    <main className={styles.authPage}>
      <div className={styles.authCard}>
        <h1 className="page-title">Two-step verification</h1>
        {stage.kind === "loading" ? <p role="status">Loading</p> : null}
        {stage.kind === "error" ? (
          <Notice tone="danger" title={stage.message} actions={<Button variant="secondary" onClick={() => window.location.reload()}>Try again</Button>} />
        ) : null}
        {stage.kind === "signedOut" ? (
          <Notice title="Sign in first." actions={<Button variant="secondary" onClick={() => router.replace("/staff/sign-in")}>Go to sign in</Button>} />
        ) : null}
        {stage.kind === "enroll" ? (
          <div className="stack-3">
            <p>Scan this code with an authenticator app (for example Google Authenticator or Microsoft Authenticator), then enter the 6-digit code it shows.</p>
            <img src={stage.qr} alt="QR code for your authenticator app" className={styles.qr} />
            <p className="label-text">
              Cannot scan? Enter this key manually: <code>{stage.secret}</code>
            </p>
          </div>
        ) : null}
        {stage.kind === "enroll" || stage.kind === "verify" ? (
          <form onSubmit={verify} className="stack-3" noValidate>
            {stage.kind === "verify" ? <p>Enter the 6-digit code from your authenticator app.</p> : null}
            <TextField
              id="mfa-code"
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
          </form>
        ) : null}
      </div>
    </main>
  );
}

"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { TextField } from "@/components/ui/TextField";
import { api, ApiError } from "@/lib/api-client";
import { messages } from "@/messages";
import styles from "../Launch.module.css";

type Errors = { email?: string; phone?: string; consent?: string; form?: string };

/** Launch list sign-up (DR-045): an e-mail address and/or a mobile number, and explicit consent. */
export function LaunchListForm({ removalNote }: { removalNote: string }) {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const doneRef = useRef<HTMLDivElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next: Errors = {};
    if (!email.trim() && !phone.trim()) next.email = messages.launch.contactRequired;
    if (!consent) next.consent = "Tick the box to agree before joining.";
    setErrors(next);
    if (next.email || next.consent) return;
    setBusy(true);
    try {
      await api("/launch-list", { method: "POST", body: { email: email.trim() || null, phone: phone.trim() || null, consent } });
      setDone(true);
      requestAnimationFrame(() => doneRef.current?.focus());
    } catch (error) {
      if (error instanceof ApiError) {
        const field = Object.fromEntries(error.fieldErrors.map((f) => [f.field, f.message]));
        const known = field.email || field.phone || field.consent;
        setErrors({ email: field.email, phone: field.phone, consent: field.consent, form: known ? undefined : error.status === 429 ? messages.errors.rateLimited : error.message });
      } else {
        setErrors({ form: messages.errors.generic });
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div ref={doneRef} tabIndex={-1} className={styles.done}>
        <Notice tone="success" title={messages.launch.joined} role="status">
          {removalNote}
        </Notice>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      {errors.form ? <Notice tone="danger" title={errors.form} role="alert" /> : null}
      <TextField
        label={messages.launch.emailLabel}
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        optional
        optionalText={messages.a11y.optional}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors.email}
        maxLength={254}
      />
      <TextField
        label={messages.launch.phoneLabel}
        help={messages.launch.phoneHelp}
        type="tel"
        name="phone"
        autoComplete="tel"
        inputMode="tel"
        optional
        optionalText={messages.a11y.optional}
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        error={errors.phone}
        maxLength={40}
      />
      <div>
        <label className={styles.consent}>
          <input type="checkbox" name="consent" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-invalid={errors.consent ? true : undefined} aria-describedby={errors.consent ? "consent-error" : undefined} />
          <span>
            {messages.launch.consentBefore}
            <Link href="/launch-privacy">{messages.launch.consentLink}</Link>
            {messages.launch.consentAfter}
          </span>
        </label>
        {errors.consent ? (
          <p id="consent-error" className={styles.fieldError}>
            {errors.consent}
          </p>
        ) : null}
      </div>
      <Button type="submit" busy={busy} busyLabel={messages.launch.submitting}>
        {messages.launch.submit}
      </Button>
    </form>
  );
}

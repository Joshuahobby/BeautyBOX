"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { TextField } from "@/components/ui/TextField";
import { api, ApiError } from "@/lib/api-client";
import { messages } from "@/messages";
import styles from "../Launch.module.css";

export function AccessForm({ next }: { next: string }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field?: string; form?: string }>({});

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!code.trim()) {
      setError({ field: messages.access.wrong });
      return;
    }
    setBusy(true);
    setError({});
    try {
      const result = await api<{ next: string }>("/site-access", { method: "POST", body: { code, next } });
      // A full navigation, so the server renders the page with the new cookie.
      window.location.assign(result.next);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setError({ field: messages.access.wrong });
      else if (e instanceof ApiError && e.status === 429) setError({ form: messages.errors.rateLimited });
      else setError({ form: e instanceof ApiError ? e.message : messages.errors.generic });
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      {error.form ? <Notice tone="danger" title={error.form} role="alert" /> : null}
      <TextField
        label={messages.access.codeLabel}
        type="password"
        name="code"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        error={error.field}
        maxLength={200}
      />
      <Button type="submit" busy={busy} busyLabel={messages.access.submitting}>
        {messages.access.submit}
      </Button>
    </form>
  );
}

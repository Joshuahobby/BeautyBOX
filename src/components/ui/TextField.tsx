import { AlertCircle } from "lucide-react";
import { useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import styles from "./Field.module.css";

type FieldProps = {
  label: string;
  help?: string;
  error?: string | null;
  optional?: boolean;
  optionalText?: string;
};

/** Persistent label, connected help and error text (UX-CONTRACT forms). */
export function TextField({
  label,
  help,
  error,
  optional,
  optionalText = "optional",
  id,
  ...input
}: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const generated = useId();
  const inputId = id ?? generated;
  const helpId = help ? `${inputId}-help` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={styles.label}>
        {label} {optional ? <span className={styles.optional}>({optionalText})</span> : null}
      </label>
      <input
        id={inputId}
        className={styles.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={[errorId, helpId].filter(Boolean).join(" ") || undefined}
        required={!optional}
        {...input}
      />
      {error ? (
        <p id={errorId} className={styles.error}>
          <AlertCircle size={16} strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      ) : null}
      {help ? (
        <p id={helpId} className={styles.help}>
          {help}
        </p>
      ) : null}
    </div>
  );
}

export function TextAreaField({
  label,
  help,
  error,
  optional,
  optionalText = "optional",
  id,
  ...input
}: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const generated = useId();
  const inputId = id ?? generated;
  const helpId = help ? `${inputId}-help` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={styles.label}>
        {label} {optional ? <span className={styles.optional}>({optionalText})</span> : null}
      </label>
      <textarea
        id={inputId}
        className={styles.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={[errorId, helpId].filter(Boolean).join(" ") || undefined}
        {...input}
      />
      {error ? (
        <p id={errorId} className={styles.error}>
          <AlertCircle size={16} strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      ) : null}
      {help ? (
        <p id={helpId} className={styles.help}>
          {help}
        </p>
      ) : null}
    </div>
  );
}

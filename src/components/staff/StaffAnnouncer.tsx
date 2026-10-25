"use client";

import { useEffect, useState } from "react";
import styles from "./Staff.module.css";

const EVENT = "staff:announce";

/** Announce the result of a staff action (works after the triggering control unmounts). */
export function announceStaff(message: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: message }));
}

/**
 * Page-level live region in the staff shell: success messages are both visible and
 * announced, so a screen-reader user knows a dialog action was recorded (RF-30).
 */
export function StaffAnnouncer() {
  const [message, setMessage] = useState("");
  useEffect(() => {
    let timer: number | undefined;
    const onAnnounce = (event: Event) => {
      const text = (event as CustomEvent<string>).detail;
      // Clear first so the same text is announced again.
      setMessage("");
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setMessage(text), 30);
    };
    window.addEventListener(EVENT, onAnnounce);
    return () => {
      window.removeEventListener(EVENT, onAnnounce);
      window.clearTimeout(timer);
    };
  }, []);
  return (
    <p role="status" aria-live="polite" className={`label-text u-m-0 ${styles.announcer}`}>
      {message}
    </p>
  );
}

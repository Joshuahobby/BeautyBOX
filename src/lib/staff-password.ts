// Staff password rules and reset-link reading, shared by the self-service reset pages and
// unit tests. Browser-safe: no secrets, no network.

export const STAFF_PASSWORD_MIN = 12; // characters
export const STAFF_PASSWORD_MAX_BYTES = 72; // Supabase's bcrypt limit is in UTF-8 bytes

/** A reason the new password cannot be used, or null when it is acceptable. */
export function passwordProblem(password: string, repeat: string): string | null {
  if ([...password].length < STAFF_PASSWORD_MIN) return `Use at least ${STAFF_PASSWORD_MIN} characters.`;
  if (new TextEncoder().encode(password).length > STAFF_PASSWORD_MAX_BYTES)
    return `That password is too long: at most ${STAFF_PASSWORD_MAX_BYTES} bytes (accented and non-Latin characters count as more than one).`;
  if (password !== repeat) return "The two passwords do not match.";
  return null;
}

export type LinkProblem = "expired" | "invalid" | "otherBrowser" | "missing";

const EXPIRED_CODES = new Set(["otp_expired", "flow_state_expired"]);

/** Maps a Supabase auth error code (from the link or the code exchange) to what the person can do. */
export function linkProblemFromCode(code: string | null | undefined): LinkProblem {
  return code && EXPIRED_CODES.has(code) ? "expired" : "invalid";
}

/**
 * Reads what a reset link brought with it. Supabase reports a failed link (expired, already
 * used) as error parameters in the query or the fragment; a working link carries `code`.
 */
export function readResetLink(href: string): { hasCode: boolean; problem: LinkProblem | null } {
  const url = new URL(href);
  const params = new URLSearchParams(url.search);
  for (const [key, value] of new URLSearchParams(url.hash.replace(/^#/, ""))) params.set(key, value);
  const failed = params.has("error") || params.has("error_code") || params.has("error_description");
  return { hasCode: params.has("code"), problem: failed ? linkProblemFromCode(params.get("error_code")) : null };
}

export const LINK_PROBLEM_TEXT: Record<LinkProblem, string> = {
  expired: "This reset link has expired or was already used.",
  invalid: "This reset link could not be used.",
  otherBrowser: "Open the reset link in the same browser you used to request it, or request a new link here.",
  missing: "This page opens from the link in a password reset email.",
};

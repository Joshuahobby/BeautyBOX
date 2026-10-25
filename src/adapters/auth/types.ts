// Staff identity provider contract. It only proves WHO is signed in and at which
// assurance level; what they may do is decided from the server-owned staff table.

export type VerifiedStaffClaims = {
  authUserId: string;
  aal: "aal1" | "aal2";
  sessionId: string | null;
};

export type CookieAccess = {
  getAll(): { name: string; value: string }[];
  /** Absent in contexts that cannot write cookies (e.g. server components). */
  setAll?(cookies: { name: string; value: string; options?: Record<string, unknown> }[]): void;
};

export interface StaffIdentityVerifier {
  readonly provider: "SUPABASE" | "TEST";
  verify(input: { cookies: CookieAccess; headers: Headers }): Promise<VerifiedStaffClaims | null>;
}

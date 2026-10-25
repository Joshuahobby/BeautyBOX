import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { CookieAccess, StaffIdentityVerifier, VerifiedStaffClaims } from "./types";

// Supabase Auth for invited staff only (ADR-02). The JWT in the Supabase SSR cookies is
// verified with getClaims() (signature checked against the project's signing keys),
// never trusted from getSession(). Supabase SSR cookies are the transport for the
// contract's logical "StaffSession" (API-Notes "Authentication transport").

export class SupabaseStaffVerifier implements StaffIdentityVerifier {
  readonly provider = "SUPABASE" as const;

  constructor(
    private readonly url: string,
    private readonly publishableKey: string,
  ) {}

  async verify(input: { cookies: CookieAccess }): Promise<VerifiedStaffClaims | null> {
    const supabase = createServerClient(this.url, this.publishableKey, {
      cookies: {
        getAll: () => input.cookies.getAll(),
        setAll: (cookies) => {
          // Token refresh writes rotated cookies where the context allows it.
          input.cookies.setAll?.(cookies.map((c) => ({ name: c.name, value: c.value, options: c.options as Record<string, unknown> })));
        },
      },
    });
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims) return null;
    const claims = data.claims as { sub?: string; aal?: string; session_id?: string };
    if (!claims.sub || !/^[0-9a-f-]{36}$/i.test(claims.sub)) return null;
    return {
      authUserId: claims.sub,
      aal: claims.aal === "aal2" ? "aal2" : "aal1",
      sessionId: claims.session_id ?? null,
    };
  }
}

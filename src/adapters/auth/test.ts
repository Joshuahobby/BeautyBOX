import "server-only";
import type { StaffIdentityVerifier, VerifiedStaffClaims } from "./types";

/**
 * TEST-ONLY identity: `x-test-staff: <authUserId>:<aal1|aal2>`. The registry refuses to
 * construct it unless APP_ENV=test, so it can never authenticate anyone in local
 * development, staging or production.
 */
export class TestStaffVerifier implements StaffIdentityVerifier {
  readonly provider = "TEST" as const;

  async verify(input: { headers: Headers }): Promise<VerifiedStaffClaims | null> {
    const raw = input.headers.get("x-test-staff");
    const match = raw ? /^([0-9a-f-]{36}):(aal1|aal2)$/i.exec(raw) : null;
    if (!match) return null;
    return { authUserId: match[1]!.toLowerCase(), aal: match[2] as "aal1" | "aal2", sessionId: null };
  }
}

import "server-only";
import { db } from "@/server/db";
import { serverEnv } from "@/server/env";
import type { CookieAccess, StaffIdentityVerifier } from "@/adapters/auth/types";
import { SupabaseStaffVerifier } from "@/adapters/auth/supabase";
import { TestStaffVerifier } from "@/adapters/auth/test";
import { DomainError } from "@/modules/shared/errors";
import { audit } from "@/modules/audit/audit";
import { can, type Capability, type StaffRole } from "./capabilities";

// Every protected staff request: verified identity -> MFA (aal2) -> ACTIVE row in our own
// staff table -> capability. A JWT that is still valid does not keep a disabled member in
// (T16): the table is read on every request. Denials are audited without secrets.

export type StaffIdentity = {
  staffId: string;
  authUserId: string;
  role: StaffRole;
  displayName: string;
  email: string;
  roleVersion: number;
};

let verifierOverride: StaffIdentityVerifier | undefined;

export function staffVerifier(): StaffIdentityVerifier | null {
  if (verifierOverride) return verifierOverride;
  const env = serverEnv();
  if (env.STAFF_AUTH_PROVIDER === "supabase") {
    return new SupabaseStaffVerifier(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
  }
  if (env.STAFF_AUTH_PROVIDER === "test" && env.APP_ENV === "test") return new TestStaffVerifier();
  return null;
}

export function setStaffVerifierForTests(verifier: StaffIdentityVerifier | undefined) {
  verifierOverride = verifier;
}

export type StaffAuthState =
  | { kind: "SIGNED_OUT" }
  | { kind: "MFA_REQUIRED"; authUserId: string }
  | { kind: "NOT_STAFF"; authUserId: string }
  | { kind: "DISABLED"; authUserId: string }
  | { kind: "OK"; staff: StaffIdentity };

/** Resolve the caller without throwing (used by staff pages to choose sign-in/MFA screens). */
export async function resolveStaff(input: { cookies: CookieAccess; headers: Headers }): Promise<StaffAuthState> {
  const verifier = staffVerifier();
  if (!verifier) return { kind: "SIGNED_OUT" };
  const claims = await verifier.verify(input);
  if (!claims) return { kind: "SIGNED_OUT" };
  if (claims.aal !== "aal2") return { kind: "MFA_REQUIRED", authUserId: claims.authUserId };
  const member = await db().staffMember.findUnique({ where: { authUserId: claims.authUserId } });
  if (!member) return { kind: "NOT_STAFF", authUserId: claims.authUserId };
  if (!member.isActive) return { kind: "DISABLED", authUserId: claims.authUserId };
  return {
    kind: "OK",
    staff: {
      staffId: member.id,
      authUserId: member.authUserId,
      role: member.role,
      displayName: member.displayName,
      email: member.email,
      roleVersion: member.roleVersion,
    },
  };
}

export async function requireStaff(
  input: { cookies: CookieAccess; headers: Headers; requestId?: string | null },
  capability?: Capability,
): Promise<StaffIdentity> {
  const state = await resolveStaff(input);
  switch (state.kind) {
    case "SIGNED_OUT":
      throw new DomainError("UNAUTHORIZED", "Sign in with your staff account to continue.");
    case "MFA_REQUIRED":
      throw new DomainError("FORBIDDEN", "Complete two-step verification to continue.");
    case "NOT_STAFF":
    case "DISABLED":
      await db().$transaction(async (tx) =>
        audit(tx, {
          actor: { type: "STAFF", id: null },
          entityType: "staff_access",
          entityId: state.authUserId,
          action: state.kind === "DISABLED" ? "DISABLED_STAFF_DENIED" : "NON_STAFF_DENIED",
          requestId: input.requestId ?? null,
        }),
      );
      throw new DomainError("FORBIDDEN", "This account does not have staff access.");
    case "OK":
      if (capability && !can(state.staff.role, capability)) {
        await db().$transaction(async (tx) =>
          audit(tx, {
            actor: { type: "STAFF", id: state.staff.staffId },
            entityType: "staff_access",
            entityId: state.staff.staffId,
            action: "CAPABILITY_DENIED",
            after: { capability, role: state.staff.role },
            requestId: input.requestId ?? null,
          }),
        );
        throw new DomainError("FORBIDDEN", "Your role does not allow this action.");
      }
      return state.staff;
  }
}

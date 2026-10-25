import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveStaff, type StaffAuthState, type StaffIdentity } from "@/modules/staff/identity";
import { can, type Capability } from "@/modules/staff/capabilities";

/** Staff state for server components (layouts/pages under /staff). Read on every request. */
export const currentStaffState = cache(async (): Promise<StaffAuthState> => {
  const jar = await cookies();
  return resolveStaff({
    cookies: { getAll: () => jar.getAll().map((c) => ({ name: c.name, value: c.value })) },
    headers: await headers(),
  });
});

export type PageAccess = { kind: "OK"; staff: StaffIdentity } | { kind: "NONE" } | { kind: "FORBIDDEN"; staff: StaffIdentity };

/**
 * Authorization for a staff PAGE that reads data. Layouts render in parallel with pages
 * and are skipped on client navigations, so every page re-checks identity, MFA, active
 * membership and its capability before touching data (RF-12). NONE: render nothing (the
 * layout explains the missing access); FORBIDDEN: show the page's own notice.
 */
export async function staffPageAccess(capability: Capability): Promise<PageAccess> {
  const state = await currentStaffState();
  if (state.kind === "SIGNED_OUT") redirect("/staff/sign-in");
  if (state.kind === "MFA_REQUIRED") redirect("/staff/mfa");
  if (state.kind !== "OK") return { kind: "NONE" };
  return can(state.staff.role, capability) ? { kind: "OK", staff: state.staff } : { kind: "FORBIDDEN", staff: state.staff };
}

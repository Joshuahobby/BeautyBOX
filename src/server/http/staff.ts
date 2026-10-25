import "server-only";
import type { NextRequest } from "next/server";
import { requireStaff, type StaffIdentity } from "@/modules/staff/identity";
import type { Capability } from "@/modules/staff/capabilities";

/** Staff identity for a route handler: verified session -> MFA -> active member -> capability. */
export function staffFrom(request: NextRequest, capability: Capability | undefined, requestId: string): Promise<StaffIdentity> {
  return requireStaff(
    {
      cookies: { getAll: () => request.cookies.getAll().map((c) => ({ name: c.name, value: c.value })) },
      headers: request.headers,
      requestId,
    },
    capability,
  );
}

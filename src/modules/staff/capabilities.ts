// Staff capabilities (handoff Security-and-Operations "Access boundaries" and the v1.0
// decisions addendum). Roles come only from the server-owned staff_members table, never
// from client-editable auth metadata. ADMIN may do everything, with individual attribution.

export type StaffRole = "ADMIN" | "OPERATIONS" | "FINANCE" | "SUPPORT";

export type Capability =
  | "orders.read"
  | "orders.readContact" // recipient phone/destination: fulfilment and support needs only
  | "fulfillment.write" // prepare, assign rider, handover, delivery attempts
  | "orders.cancel" // staff-confirmed cancellation decision
  | "cancellation.request"
  | "catalog.read"
  | "catalog.write"
  | "catalog.publish"
  | "stock.adjust"
  | "stock.import"
  | "payments.read"
  | "payments.reconcile"
  | "refunds.request"
  | "refunds.approve"
  | "suppliers.read"
  | "suppliers.write"
  | "suppliers.settle"
  | "access.reissue" // reissue a private order link after support verification
  | "settings.read"
  | "settings.write"
  | "staff.manage"
  | "audit.read";

const MATRIX: Record<StaffRole, readonly Capability[]> = {
  ADMIN: [
    "orders.read", "orders.readContact", "fulfillment.write", "orders.cancel", "cancellation.request",
    "catalog.read", "catalog.write", "catalog.publish", "stock.adjust", "stock.import",
    "payments.read", "payments.reconcile", "refunds.request", "refunds.approve",
    "suppliers.read", "suppliers.write", "suppliers.settle", "access.reissue",
    "settings.read", "settings.write", "staff.manage", "audit.read",
  ],
  OPERATIONS: [
    "orders.read", "orders.readContact", "fulfillment.write", "orders.cancel", "cancellation.request",
    "catalog.read", "catalog.write", "catalog.publish", "stock.adjust", "stock.import",
    "refunds.request", "suppliers.read", "access.reissue",
  ],
  FINANCE: [
    "orders.read", "payments.read", "payments.reconcile", "refunds.request", "refunds.approve",
    "suppliers.read", "suppliers.settle", "settings.read", "audit.read", "access.reissue",
  ],
  SUPPORT: ["orders.read", "orders.readContact", "cancellation.request", "refunds.request", "access.reissue"],
};

export function can(role: StaffRole, capability: Capability): boolean {
  return MATRIX[role].includes(capability);
}

export function capabilitiesOf(role: StaffRole): readonly Capability[] {
  return MATRIX[role];
}

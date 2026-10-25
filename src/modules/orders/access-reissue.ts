import "server-only";
import { db, transaction } from "@/server/db";
import { DomainError, notFound } from "@/modules/shared/errors";
import { claimIdempotencyKey, completeIdempotencyKey, requestHash } from "@/modules/idempotency/idempotency";
import { audit } from "@/modules/audit/audit";
import { can } from "@/modules/staff/capabilities";
import type { StaffIdentity } from "@/modules/staff/identity";
import { createNotificationIntent } from "@/modules/notifications/intents";
import { operationView, type OperationView } from "@/modules/operations/operations";
import { hasVerifiedCollection, revokeOrderAccess } from "./private-links";

/**
 * Support reissue of private order access (contract reissueOrderAccess, U13E). After the
 * customer is verified outside the system (case reference recorded), every outstanding
 * link and order-scoped session is revoked and a fresh link is queued by SMS to the
 * order's contact number. Staff never see the raw token.
 */
export async function reissueOrderAccess(
  staff: StaffIdentity,
  orderId: string,
  input: { expectedVersion: number; verificationCaseReference: string; reason: string },
  idempotencyKey: string,
  requestId: string | null,
): Promise<OperationView> {
  if (!can(staff.role, "access.reissue")) throw new DomainError("FORBIDDEN", "Your role does not allow reissuing order links.");
  const caseReference = input.verificationCaseReference.trim();
  const reason = input.reason.trim();
  if (!caseReference) throw new DomainError("VALIDATION_ERROR", "Enter the verification case reference.", { fieldErrors: [{ field: "verificationCaseReference", message: "Required." }] });
  if (!reason) throw new DomainError("VALIDATION_ERROR", "Give a reason.", { fieldErrors: [{ field: "reason", message: "Required." }] });
  const operationId = await transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, { scope: `staff:${staff.staffId}:access-reissue:${orderId}`, key: idempotencyKey, requestHash: requestHash("reissueOrderAccess", input) });
    if (claim.kind === "REPLAY") return claim.resourceId;
    const ref = await tx.order.findUnique({ where: { id: orderId }, select: { checkoutId: true } });
    if (!ref) throw notFound();
    await tx.$queryRaw`SELECT id FROM commerce.checkouts WHERE id = ${ref.checkoutId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM commerce.orders WHERE id = ${orderId}::uuid FOR UPDATE`;
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.version !== input.expectedVersion) throw new DomainError("VERSION_CONFLICT", "This order changed since you opened it. Reload to see its current state.");
    // Any verified money (paid, or collected after a cancellation or review) gives the
    // customer something to follow (RF-18).
    if (!(await hasVerifiedCollection(tx, order))) throw new DomainError("ACTION_NOT_ALLOWED", "Private links are issued only for orders with a verified payment.");
    const revoked = await revokeOrderAccess(tx, orderId);
    const op = await tx.operation.create({
      data: { orderId, type: "ACCESS_REISSUE", reason, requestedByStaffId: staff.staffId, caseReference },
    });
    await createNotificationIntent(tx, { orderId, event: "ACCESS_LINK", intentKey: op.id, operationId: op.id });
    await audit(tx, {
      actor: { type: "STAFF", id: staff.staffId },
      entityType: "order",
      entityId: orderId,
      action: "ORDER_ACCESS_REISSUED",
      after: { revokedLinks: revoked.links, revokedSessions: revoked.sessions, guestSessionCutOff: revoked.guestSession, caseReference },
      reason,
      requestId,
    });
    await completeIdempotencyKey(tx, claim.recordId, { resourceType: "operation", resourceId: op.id, responseStatus: 202 });
    return op.id;
  });
  return operationView(await db().operation.findUniqueOrThrow({ where: { id: operationId } }));
}


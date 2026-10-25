import "server-only";
import type { Tx } from "@/server/db";
import { enqueueJob } from "@/modules/jobs/outbox";

export type NotificationEvent = "ORDER_CONFIRMED" | "ORDER_ON_HOLD" | "ORDER_DISPATCHED" | "DELIVERY_PROBLEM" | "REFUND_CONFIRMED" | "ACCESS_LINK";

export const TEMPLATE_VERSION = 1;

/**
 * Durable notification intent written with the business change (outbox). Delivery is
 * attempted later; failure never changes order or payment state (T19). `intentKey`
 * separates repeatable events of one order (each refund, failed delivery attempt or
 * access reissue); once-per-order events leave it empty, so duplicates collapse.
 */
export async function createNotificationIntent(
  tx: Tx,
  input: { orderId: string; event: NotificationEvent; intentKey?: string; operationId?: string | null },
): Promise<void> {
  const templateId = `sms.${input.event.toLowerCase()}`;
  const intentKey = input.intentKey ?? "";
  const notification = await tx.notification.upsert({
    where: {
      orderId_event_templateId_templateVersion_intentKey: {
        orderId: input.orderId,
        event: input.event,
        templateId,
        templateVersion: TEMPLATE_VERSION,
        intentKey,
      },
    },
    create: {
      orderId: input.orderId,
      event: input.event,
      templateId,
      templateVersion: TEMPLATE_VERSION,
      intentKey,
      operationId: input.operationId ?? null,
    },
    update: {},
  });
  await enqueueJob(tx, {
    type: "NOTIFICATION_SEND",
    uniqueIntentKey: `notify:${notification.id}`,
    entityId: notification.id,
  });
}

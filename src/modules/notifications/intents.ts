import "server-only";
import type { Tx } from "@/server/db";
import { enqueueJob } from "@/modules/jobs/outbox";
import { emailAdapter } from "@/adapters/registry";

export type NotificationEvent = "ORDER_CONFIRMED" | "ORDER_ON_HOLD" | "ORDER_DISPATCHED" | "DELIVERY_PROBLEM" | "REFUND_CONFIRMED" | "ACCESS_LINK";

export type NotificationChannel = "email" | "sms";

export const TEMPLATE_VERSION = 1;

/** The channel a template id belongs to (`email.order_confirmed`, `sms.order_confirmed`). */
export function channelOf(templateId: string): NotificationChannel {
  return templateId.startsWith("email.") ? "email" : "sms";
}

/**
 * Durable notification intent written with the business change (outbox). Delivery is
 * attempted later; failure never changes order or payment state (T19). `intentKey`
 * separates repeatable events of one order (each refund, failed delivery attempt or
 * access reissue); once-per-order events leave it empty, so duplicates collapse.
 *
 * One message per event, on one channel (DR-059): e-mail when the order has an address
 * and e-mail is switched on (the launch channel, DR-057), otherwise SMS as before. The
 * channel is fixed when the intent is written, so a later settings change never sends
 * the same event twice.
 */
export async function createNotificationIntent(
  tx: Tx,
  input: { orderId: string; event: NotificationEvent; intentKey?: string; operationId?: string | null },
): Promise<void> {
  const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId }, select: { recipientEmail: true } });
  const channel: NotificationChannel = order.recipientEmail && emailAdapter().provider !== "DISABLED" ? "email" : "sms";
  const templateId = `${channel}.${input.event.toLowerCase()}`;
  const intentKey = input.intentKey ?? "";
  // Look up the event on either channel first, so a retried business change never adds a
  // second message on the other channel.
  const existing = await tx.notification.findFirst({
    where: { orderId: input.orderId, event: input.event, templateVersion: TEMPLATE_VERSION, intentKey },
  });
  const notification =
    existing ??
    (await tx.notification.upsert({
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
    }));
  await enqueueJob(tx, {
    type: "NOTIFICATION_SEND",
    uniqueIntentKey: `notify:${notification.id}`,
    entityId: notification.id,
  });
}

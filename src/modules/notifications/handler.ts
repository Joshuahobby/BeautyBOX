import "server-only";
import { db, transaction } from "@/server/db";
import { smsAdapter } from "@/adapters/registry";
import { formatRwf } from "@/modules/shared/money";
import { serverEnv } from "@/server/env";
import { backoffSeconds, type ClaimedJob, type JobOutcome } from "@/modules/jobs/outbox";
import { currentSettings } from "@/modules/settings/settings";
import { issuePrivateLink, privateLinkUrl } from "@/modules/orders/private-links";
import { resolveOperations } from "@/modules/operations/operations";

// Transactional SMS delivery (I11). Failure is recorded and alerted; it never changes
// order or payment state (T19), and the order stays visible on the site. A definite
// provider failure is retried a few times (nothing was sent), then left for staff.
// An unknown outcome is NOT retried: a duplicate message is worse than a follow-up.
// Templates follow business/Policy-and-Copy-Drafts.md (drafts until approved, B09).

const SEND_IN_PROGRESS = "SEND_IN_PROGRESS";
const UNKNOWN_OUTCOME = "We could not confirm the SMS was sent. Check with the customer before sending another link.";
const MAX_SEND_ATTEMPTS = 3;

type TemplateInput = { reference: string; amount: string; link: string | null; help: string; contact: string | null };

const TEMPLATES: Record<string, { needsLink: boolean; text: (v: TemplateInput) => string }> = {
  ORDER_CONFIRMED: { needsLink: true, text: (v) => `BeautyBOX: Payment received for order ${v.reference}, ${v.amount}. View your order: ${v.link}.${v.help}` },
  ORDER_DISPATCHED: { needsLink: true, text: (v) => `BeautyBOX: Order ${v.reference} has been handed to our delivery partner. View status: ${v.link}.${v.help}` },
  ORDER_ON_HOLD: { needsLink: false, text: (v) => `BeautyBOX: We need to contact you about order ${v.reference}.${v.contact ? ` Please contact ${v.contact}.` : ""}` },
  DELIVERY_PROBLEM: { needsLink: false, text: (v) => `BeautyBOX: We need to contact you about order ${v.reference}.${v.contact ? ` Please contact ${v.contact}.` : ""}` },
  REFUND_CONFIRMED: { needsLink: false, text: (v) => `BeautyBOX: Your refund of ${v.amount} for order ${v.reference} is confirmed.${v.help}` },
  // Not in the copy drafts: a reviewed wording is needed before launch (see PROGRESS).
  ACCESS_LINK: { needsLink: true, text: (v) => `BeautyBOX: Your new private link for order ${v.reference}: ${v.link}. It works once and expires in 7 days.${v.help}` },
};

function supportContactText(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as { phone?: unknown; email?: unknown };
  if (typeof c.phone === "string" && c.phone) return c.phone;
  if (typeof c.email === "string" && c.email) return c.email;
  return null;
}

export async function handleNotificationSend(job: ClaimedJob): Promise<JobOutcome> {
  const notification = await db().notification.findUnique({ where: { id: job.entityId }, include: { order: true } });
  if (!notification) return { kind: "DONE" };
  if (notification.state === "UNKNOWN" && notification.lastErrorCode === SEND_IN_PROGRESS) {
    // A previous worker claimed this message and never recorded the outcome (crash, lost
    // lease, exception): the SMS may have gone out. Never resend blindly (T17).
    await db().notification.update({ where: { id: notification.id }, data: { lastErrorCode: "SEND_OUTCOME_UNKNOWN" } });
    if (notification.operationId) await resolveOperations(db(), { id: notification.operationId }, "FAILED", UNKNOWN_OUTCOME);
    return { kind: "NEEDS_REVIEW", errorCode: "SEND_OUTCOME_UNKNOWN" };
  }
  if (notification.state !== "PENDING") return { kind: "DONE" };

  const adapter = smsAdapter();
  const template = TEMPLATES[notification.event];
  const settings = await currentSettings();
  const suppressedBecause =
    adapter.provider === "DISABLED"
      ? "SMS_NOT_ENABLED"
      : !settings.notificationsEnabled
        ? "NOTIFICATIONS_SWITCHED_OFF"
        : !template
          ? "NO_TEMPLATE"
          : serverEnv().APP_ENV === "production" && adapter.provider !== "AFRICASTALKING"
            ? "SMS_NOT_ENABLED"
            : null;
  if (suppressedBecause || !template) {
    await db().notification.update({ where: { id: notification.id }, data: { state: "SUPPRESSED", lastErrorCode: suppressedBecause ?? "NO_TEMPLATE" } });
    if (notification.operationId) {
      await resolveOperations(db(), { id: notification.operationId }, "FAILED", "SMS is switched off, so the link was not sent.");
    }
    return { kind: "DONE" };
  }

  // Amount shown: the order total, or the confirmed refund for refund messages.
  let amountRwf = Number(notification.order.totalRwf);
  if (notification.event === "REFUND_CONFIRMED" && notification.intentKey) {
    const refund = await db().refund.findUnique({ where: { id: notification.intentKey } });
    if (refund) amountRwf = Number(refund.amountRwf);
  }
  // The raw link token exists only in this message; only its hash is stored.
  const link = template.needsLink
    ? privateLinkUrl((await transaction((tx) => issuePrivateLink(tx, notification.orderId, { reason: `Sent with SMS ${notification.event}` }))).token)
    : null;
  const contact = supportContactText(settings.supportContact);
  const text = template.text({
    reference: notification.order.reference,
    amount: formatRwf(amountRwf),
    link,
    contact,
    help: contact ? ` Help: ${contact}.` : "",
  });

  // Claim before the external call so a recovered lease can tell a possible send happened.
  const claimed = await db().notification.updateMany({
    where: { id: notification.id, state: "PENDING" },
    data: { state: "UNKNOWN", lastErrorCode: SEND_IN_PROGRESS },
  });
  if (claimed.count !== 1) return { kind: "DONE" };
  // Sent to the order's contact (recipient) number only, never to the payer number.
  const result = await adapter.sendTransactional({ messageIntentId: notification.id, recipientE164: notification.order.recipientPhone, text });

  if (result.kind === "ACCEPTED") {
    await db().notification.update({ where: { id: notification.id }, data: { state: "ACCEPTED", providerMessageId: result.providerMessageId, lastErrorCode: null } });
    if (notification.operationId) {
      await resolveOperations(db(), { id: notification.operationId }, "SUCCEEDED", "A new private link was sent by SMS to the order's contact number.");
    }
    return { kind: "DONE" };
  }
  if (result.kind === "FAILED") {
    if (job.attempts < MAX_SEND_ATTEMPTS) {
      // Definitely not sent: safe to try again later.
      await db().notification.update({ where: { id: notification.id }, data: { state: "PENDING", lastErrorCode: result.code } });
      return { kind: "RETRY", afterSeconds: backoffSeconds(job.attempts, 30, 600), errorCode: `SMS_${result.code}` };
    }
    await db().notification.update({ where: { id: notification.id }, data: { state: "FAILED", lastErrorCode: result.code } });
    if (notification.operationId) {
      await resolveOperations(db(), { id: notification.operationId }, "FAILED", "The SMS could not be delivered to the provider. Check the contact number with the customer.");
    }
    return { kind: "NEEDS_REVIEW", errorCode: `SMS_FAILED_${result.code}` };
  }
  await db().notification.update({ where: { id: notification.id }, data: { state: "UNKNOWN", lastErrorCode: "SEND_OUTCOME_UNKNOWN" } });
  if (notification.operationId) await resolveOperations(db(), { id: notification.operationId }, "FAILED", UNKNOWN_OUTCOME);
  return { kind: "NEEDS_REVIEW", errorCode: "SEND_OUTCOME_UNKNOWN" };
}

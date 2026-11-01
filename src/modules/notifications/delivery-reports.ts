import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { now } from "@/modules/shared/clock";

// SMS delivery reports (I11, DR-048). After Africa's Talking accepts a message, it reports what
// the mobile network said about handset delivery. Africa's Talking does not sign these reports,
// so they are trusted only as far as they matter: the route needs the secret address, a report
// must name the provider's message id AND the number that message went to, and all it changes
// is what staff see about that message. It never changes the order, the payment or the
// message's send state, and never sends anything again.

export const DELIVERY_STATUSES = ["Sent", "Submitted", "Buffered", "Success", "Failed", "Rejected", "AbsentSubscriber", "Expired"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Did not reach the phone. AbsentSubscriber (phone off or out of coverage) can still be followed by delivery. */
export const NOT_DELIVERED: readonly DeliveryStatus[] = ["Failed", "Rejected", "Expired", "AbsentSubscriber"];

// Reports can arrive out of order: a later report replaces an earlier one only if it says more.
const RANK: Record<DeliveryStatus, number> = { Sent: 1, Submitted: 2, Buffered: 3, AbsentSubscriber: 4, Success: 5, Failed: 5, Rejected: 5, Expired: 5 };

/** Messages staff should look at: not sent, outcome unknown, or reported as not delivered to the phone. */
export const smsProblemWhere: Prisma.NotificationWhereInput = {
  OR: [{ state: { in: ["FAILED", "UNKNOWN"] } }, { deliveryStatus: { in: [...NOT_DELIVERED] } }],
};

export type DeliveryReport = { providerMessageId: string; status: DeliveryStatus; phoneNumber: string; failureReason: string | null };
export type DeliveryReportOutcome = "RECORDED" | "NOT_NEWER" | "UNMATCHED";

const digits = (v: string) => v.replace(/\D/g, "");

/** Reads Africa's Talking's form fields (id, status, phoneNumber, failureReason); null when it is not a delivery report. */
export function parseDeliveryReport(form: URLSearchParams): DeliveryReport | null {
  const id = form.get("id") ?? "";
  const status = form.get("status") ?? "";
  const phoneNumber = form.get("phoneNumber") ?? "";
  const failureReason = form.get("failureReason");
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(id) || id === "None") return null;
  if (!(DELIVERY_STATUSES as readonly string[]).includes(status)) return null;
  if (!/^\+?[0-9]{8,15}$/.test(phoneNumber)) return null;
  return {
    providerMessageId: id,
    status: status as DeliveryStatus,
    phoneNumber,
    failureReason: failureReason && /^[A-Za-z]{1,64}$/.test(failureReason) ? failureReason : null,
  };
}

export async function recordDeliveryReport(report: DeliveryReport): Promise<DeliveryReportOutcome> {
  // A message the provider accepted, or one whose outcome was unknown but carried an id.
  const notification = await db().notification.findFirst({
    where: { providerMessageId: report.providerMessageId, state: { in: ["ACCEPTED", "UNKNOWN"] } },
    include: { order: { select: { recipientPhone: true } } },
  });
  if (!notification || digits(notification.order.recipientPhone) !== digits(report.phoneNumber)) return "UNMATCHED";
  const lessInformed = DELIVERY_STATUSES.filter((s) => RANK[s] < RANK[report.status]);
  const replaceable = lessInformed.length > 0 ? Prisma.sql`delivery_status IS NULL OR delivery_status IN (${Prisma.join(lessInformed)})` : Prisma.sql`delivery_status IS NULL`;
  // One conditional statement, so two reports arriving together cannot overwrite a final one.
  // Written in SQL so updated_at keeps the time of the send outcome: the ops alerts count failed
  // and unknown sends by it, and a report must not restart their window.
  const updated = await db().$executeRaw`
    UPDATE commerce.notifications
       SET delivery_status = ${report.status},
           delivery_failure_reason = ${NOT_DELIVERED.includes(report.status) ? report.failureReason : null},
           delivery_reported_at = ${now()}
     WHERE id = ${notification.id}::uuid AND (${replaceable})`;
  return updated === 1 ? "RECORDED" : "NOT_NEWER";
}

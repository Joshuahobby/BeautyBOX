// Plain-language labels for staff screens (enum values stay in the API).

export const ORDER_STATE_LABEL: Record<string, string> = {
  AWAITING_PAYMENT: "Awaiting payment",
  PAID: "Paid, to prepare",
  PREPARING: "Preparing",
  ON_HOLD: "On hold",
  DISPATCHED: "With rider",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

export const EXCEPTION_LABEL: Record<string, string> = {
  PAYMENT_MISMATCH: "Payment amount or currency did not match. Finance must review.",
  PAYMENT_NEEDS_REVIEW: "Payment needs finance review.",
  PAYMENT_UNKNOWN: "Payment outcome not yet known.",
  HOLD_STOCK_UNAVAILABLE: "Paid, but stock could not be allocated. Do not dispatch.",
  HOLD_PAYMENT_REVIEW: "On hold for payment review.",
  HOLD_MANUAL: "Put on hold by staff.",
  REFUND_CASE_OPEN: "A refund case is open.",
  REFUND_AMOUNT_MISMATCH: "The provider confirmed a refund for a different amount. Finance must review it.",
  REFUND_NEEDS_REVIEW: "The provider's records for a refund differ from ours. Finance must check the payment with the provider before refunding again.",
  CANCELLATION_REQUESTED: "The customer asked to cancel. Decide before handover.",
  SMS_FAILED: "An SMS to the customer could not be sent.",
  SMS_OUTCOME_UNKNOWN: "An SMS may or may not have been sent. Check before contacting the customer again.",
  SMS_NOT_DELIVERED_TO_PHONE: "The network reported that an SMS did not reach the customer's phone. Check the contact number with the customer.",
};

/** What the SMS provider later reported about handset delivery (DR-048). */
const SMS_DELIVERY_LABEL: Record<string, string> = {
  Sent: "with the network",
  Submitted: "with the network",
  Buffered: "queued by the network",
  Success: "delivered to the phone",
  Failed: "not delivered to the phone",
  Rejected: "rejected by the network",
  Expired: "discarded by the network",
  AbsentSubscriber: "phone unreachable (off or out of coverage)",
};

export function smsDeliveryLabel(status: string, failureReason: string | null): string {
  const reason = failureReason ? ` (${failureReason.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()})` : "";
  return `${SMS_DELIVERY_LABEL[status] ?? status}${reason}`;
}

export const humanize = (value: string) => value.toLowerCase().replaceAll("_", " ");

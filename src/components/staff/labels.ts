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
  SMS_FAILED: "A message (e-mail or SMS) to the customer could not be sent.",
  SMS_OUTCOME_UNKNOWN: "A message (e-mail or SMS) may or may not have been sent. Check before contacting the customer again.",
};

export const humanize = (value: string) => value.toLowerCase().replaceAll("_", " ");

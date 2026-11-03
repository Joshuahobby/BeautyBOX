-- Additive only; the build before this one keeps working against it (DR-037).

-- DR-048: what the SMS provider later reports about handset delivery of a message it accepted
-- (Africa's Talking delivery reports). For staff only: it never changes the order, the payment
-- or the message's send state, and never causes a message to be sent again.
ALTER TABLE "commerce"."notifications"
  ADD COLUMN "delivery_status" TEXT,
  ADD COLUMN "delivery_failure_reason" TEXT,
  ADD COLUMN "delivery_reported_at" TIMESTAMPTZ(3),
  ADD CONSTRAINT "notifications_delivery_status_known" CHECK (
    "delivery_status" IS NULL OR "delivery_status" IN ('Sent', 'Submitted', 'Buffered', 'Success', 'Failed', 'Rejected', 'AbsentSubscriber', 'Expired')
  ),
  ADD CONSTRAINT "notifications_delivery_failure_reason_format" CHECK (
    "delivery_failure_reason" IS NULL OR "delivery_failure_reason" ~ '^[A-Za-z]{1,64}$'
  );

-- Delivery reports name the provider's message id.
CREATE INDEX "notifications_provider_message_id" ON "commerce"."notifications" ("provider_message_id") WHERE "provider_message_id" IS NOT NULL;

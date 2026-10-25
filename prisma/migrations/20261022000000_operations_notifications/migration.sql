-- I09-I11: durable operations for customer cancellation requests and staff
-- reconcile / access-reissue requests; repeatable notifications; manual holds.
-- Generated with `prisma migrate diff`, then edited to RENAME customer_operations
-- (keeping its rows) instead of dropping and recreating it.

-- AlterEnum
ALTER TYPE "commerce"."HoldReason" ADD VALUE 'MANUAL';
ALTER TYPE "commerce"."OperationType" ADD VALUE 'PAYMENT_RECONCILE';
ALTER TYPE "commerce"."OperationType" ADD VALUE 'REFUND_RECONCILE';
ALTER TYPE "commerce"."OperationType" ADD VALUE 'ACCESS_REISSUE';

-- Rename customer_operations -> operations (rows, grants and ownership are kept)
ALTER TABLE "commerce"."customer_operations" RENAME TO "operations";
ALTER TABLE "commerce"."operations" RENAME CONSTRAINT "customer_operations_pkey" TO "operations_pkey";
ALTER TABLE "commerce"."operations" RENAME CONSTRAINT "customer_operations_order_id_fkey" TO "operations_order_id_fkey";
ALTER INDEX "commerce"."customer_operations_order_id_idx" RENAME TO "operations_order_id_idx";
ALTER TABLE "commerce"."operations"
  ADD COLUMN "subject_id" UUID,
  ADD COLUMN "requested_by_staff_id" UUID,
  ADD COLUMN "case_reference" TEXT;
CREATE INDEX "operations_subject_id_idx" ON "commerce"."operations"("subject_id");

-- A resolved operation records when; a pending one has no resolution time.
ALTER TABLE "commerce"."operations"
  ADD CONSTRAINT "operations_resolution" CHECK ((state = 'PENDING') = (resolved_at IS NULL));
-- At most one open cancellation request per order (a repeat request returns it).
CREATE UNIQUE INDEX "operations_one_pending_cancellation" ON "commerce"."operations"("order_id")
  WHERE type = 'CANCELLATION_REQUEST' AND state = 'PENDING';
-- At most one open reconcile request per attempt or refund.
CREATE UNIQUE INDEX "operations_one_pending_per_subject" ON "commerce"."operations"("type", "subject_id")
  WHERE state = 'PENDING' AND subject_id IS NOT NULL;

-- Notifications: repeatable events and the operation they report to
DROP INDEX "commerce"."notifications_order_id_event_template_id_template_version_key";
ALTER TABLE "commerce"."notifications"
  ADD COLUMN "intent_key" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "operation_id" UUID;
CREATE UNIQUE INDEX "notifications_order_id_event_template_id_template_version_i_key"
  ON "commerce"."notifications"("order_id", "event", "template_id", "template_version", "intent_key");
ALTER TABLE "commerce"."notifications" ADD CONSTRAINT "notifications_operation_id_fkey"
  FOREIGN KEY ("operation_id") REFERENCES "commerce"."operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Review fixes (docs/REVIEW-FINDINGS.md RF-09..RF-31):
-- * supplier obligations of a sale cancelled before handover become VOID (nothing owed);
-- * a support access reissue can cut off the browser session that placed the order;
-- * a refund the provider confirmed for a different amount keeps that amount as evidence.

-- AlterEnum
ALTER TYPE "commerce"."SettlementState" ADD VALUE 'VOID';

-- AlterTable
ALTER TABLE "commerce"."orders" ADD COLUMN "guest_access_revoked_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "commerce"."refunds" ADD COLUMN "provider_amount_rwf" BIGINT;
ALTER TABLE "commerce"."refunds" ADD CONSTRAINT "refunds_provider_amount_positive" CHECK (provider_amount_rwf IS NULL OR provider_amount_rwf >= 0);

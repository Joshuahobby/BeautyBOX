-- DR-043: when finance records that a refund recorded as failed was in fact paid out (for
-- example through a refund made outside the app), the provider reference it saw is kept on
-- the refund. Additive and nullable: earlier builds never read it.
ALTER TABLE "commerce"."refunds" ADD COLUMN "resolution_reference" TEXT;

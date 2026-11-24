-- Additive only; the build before this one keeps working against it (DR-037).

-- DR-059: order e-mail replaces SMS at launch (DR-057). The customer's e-mail address is
-- collected with the recipient at checkout and copied onto the order, where the job runner
-- reads it to send the confirmation and private-link messages. Nullable: orders and
-- checkouts made before this build have none.
ALTER TABLE "commerce"."checkouts" ADD COLUMN "recipient_email" TEXT;
ALTER TABLE "commerce"."orders" ADD COLUMN "recipient_email" TEXT;

-- DR-045 (RF-91): a sign-up that adds a new detail next to one already on the list keeps that
-- detail on a row of its own (it may be a shared phone), and records on the new row the keyed
-- hash of the detail it was typed with. A removal or access request for either detail then shows
-- the other to the operator, who confirms with the person before removing it too.
ALTER TABLE "commerce"."launch_signups"
    ADD COLUMN "linked_email_hash" TEXT,
    ADD COLUMN "linked_phone_hash" TEXT;

CREATE INDEX "launch_signups_linked_email_hash_idx" ON "commerce"."launch_signups"("linked_email_hash");
CREATE INDEX "launch_signups_linked_phone_hash_idx" ON "commerce"."launch_signups"("linked_phone_hash");

-- The job runner's clean-up deletes by these columns on every run.
CREATE INDEX "launch_signups_consented_at_idx" ON "commerce"."launch_signups"("consented_at");
CREATE INDEX "rate_limit_buckets_window_start_idx" ON "commerce"."rate_limit_buckets"("window_start");

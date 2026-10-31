-- Additive only; the build before this one keeps working against it (DR-037).

-- DR-046: when the raw upload behind an upload intent was deleted from storage. Set by the
-- job runner once no upload URL can still write to it.
ALTER TABLE "commerce"."media_uploads" ADD COLUMN "staging_cleared_at" TIMESTAMPTZ(3);
CREATE INDEX "media_uploads_staging_uncleared" ON "commerce"."media_uploads" ("expires_at") WHERE "staging_cleared_at" IS NULL;

-- DR-047: the invariant trigger functions run with a fixed, empty search_path (Supabase
-- security advisor 0011), so a schema or temporary object named like one they use can never
-- change what they do. Every table and type in them is already schema-qualified, so their
-- behaviour is unchanged.
ALTER FUNCTION "commerce".forbid_mutation() SET search_path = '';
ALTER FUNCTION "commerce".guard_attempt_success() SET search_path = '';
ALTER FUNCTION "commerce".enforce_refund_budget() SET search_path = '';
ALTER FUNCTION "commerce".guard_production_publication() SET search_path = '';
ALTER FUNCTION "commerce".guard_profile_demo() SET search_path = '';

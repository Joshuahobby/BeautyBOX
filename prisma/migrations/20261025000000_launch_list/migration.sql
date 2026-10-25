-- DR-045: the launch list. Real personal data collected with consent before launch: an e-mail
-- address, a Rwanda mobile number, or both. Each is stored encrypted (AES-256-GCM, application
-- key) and found again only through a keyed hash. Withdrawal deletes the row. Additive: earlier
-- builds never read it.
CREATE TABLE "commerce"."launch_signups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email_hash" TEXT,
    "email_encrypted" TEXT,
    "phone_hash" TEXT,
    "phone_encrypted" TEXT,
    "consent_version" TEXT NOT NULL,
    "consented_at" TIMESTAMPTZ(3) NOT NULL,
    "source_host" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "launch_signups_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "launch_signups_contact_present" CHECK ("email_hash" IS NOT NULL OR "phone_hash" IS NOT NULL),
    CONSTRAINT "launch_signups_email_pair" CHECK (("email_hash" IS NULL) = ("email_encrypted" IS NULL)),
    CONSTRAINT "launch_signups_phone_pair" CHECK (("phone_hash" IS NULL) = ("phone_encrypted" IS NULL))
);

CREATE UNIQUE INDEX "launch_signups_email_hash_key" ON "commerce"."launch_signups"("email_hash");
CREATE UNIQUE INDEX "launch_signups_phone_hash_key" ON "commerce"."launch_signups"("phone_hash");

-- The runtime role gets SELECT/INSERT/UPDATE through default privileges; it also deletes rows
-- when someone asks to be removed (scripts/ops/launch-list.ts).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'beautybox_runtime') THEN
    GRANT DELETE ON "commerce"."launch_signups" TO beautybox_runtime;
  END IF;
END $$;

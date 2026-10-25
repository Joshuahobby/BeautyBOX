-- Simulated payment provider state for LOCAL and TEST databases only.
-- Never applied by production migrations; the fake adapter is rejected in production
-- configuration (src/server/env.ts). Run by scripts/db/apply-devsim.mjs.
CREATE SCHEMA IF NOT EXISTS devsim;

CREATE TABLE IF NOT EXISTS devsim.deposits (
  deposit_id   uuid PRIMARY KEY,
  amount       text        NOT NULL,
  currency     text        NOT NULL,
  provider     text        NOT NULL,
  msisdn_hash  text        NOT NULL,
  scenario     text        NOT NULL,
  created_at   timestamptz NOT NULL,
  settles_at   timestamptz,
  final_status text,
  failure_code text,
  transaction_id text
);

CREATE TABLE IF NOT EXISTS devsim.refunds (
  refund_id    uuid PRIMARY KEY,
  deposit_id   uuid        NOT NULL REFERENCES devsim.deposits (deposit_id),
  amount       text        NOT NULL,
  currency     text        NOT NULL,
  created_at   timestamptz NOT NULL,
  settles_at   timestamptz NOT NULL,
  final_status text,
  failure_code text
);

CREATE TABLE IF NOT EXISTS devsim.settings (
  id               int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled_methods  text[] NOT NULL DEFAULT ARRAY['MTN_MOMO_RWA', 'AIRTEL_RWA']
);
INSERT INTO devsim.settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Simulated handset inbox for the fake SMS adapter: lets a local reviewer open the
-- private links that real messages would carry. Never exists outside LOCAL/TEST.
CREATE TABLE IF NOT EXISTS devsim.sms_messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_intent_id uuid        NOT NULL,
  recipient         text        NOT NULL,
  body              text        NOT NULL,
  outcome           text        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

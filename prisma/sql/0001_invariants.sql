
-- =====================================================================
-- Reviewed invariants that Prisma's schema language cannot express.
-- Source of truth for this block: prisma/sql/0001_invariants.sql
-- (appended to the generated init migration; covered by integration tests).
-- =====================================================================

-- ---------------------------------------------------------------- value checks
ALTER TABLE "commerce"."variants" ADD CONSTRAINT variants_price_positive CHECK (price_rwf > 0);
ALTER TABLE "commerce"."inventory_lots"
  ADD CONSTRAINT lots_nonnegative CHECK (quantity_on_hand >= 0 AND reserved_qty >= 0 AND committed_qty >= 0),
  ADD CONSTRAINT lots_capacity CHECK (quantity_on_hand >= reserved_qty + committed_qty),
  ADD CONSTRAINT lots_cost_nonnegative CHECK (cost_basis_rwf IS NULL OR cost_basis_rwf >= 0),
  ADD CONSTRAINT lots_supplier_matches_ownership CHECK (ownership = 'OWNED' OR supplier_id IS NOT NULL);
ALTER TABLE "commerce"."cart_lines"
  ADD CONSTRAINT cart_lines_quantity CHECK (quantity BETWEEN 1 AND 99),
  ADD CONSTRAINT cart_lines_seen_price CHECK (seen_price_rwf > 0);
ALTER TABLE "commerce"."order_lines"
  ADD CONSTRAINT order_lines_quantity CHECK (quantity > 0),
  ADD CONSTRAINT order_lines_price CHECK (unit_price_rwf > 0),
  ADD CONSTRAINT order_lines_total CHECK (line_total_rwf = unit_price_rwf * quantity);
ALTER TABLE "commerce"."orders"
  ADD CONSTRAINT orders_amounts CHECK (products_rwf > 0 AND delivery_rwf >= 0 AND total_rwf = products_rwf + delivery_rwf),
  ADD CONSTRAINT orders_currency CHECK (currency = 'RWF'),
  ADD CONSTRAINT orders_destination CHECK (destination_lat BETWEEN -90 AND 90 AND destination_lng BETWEEN -180 AND 180);
ALTER TABLE "commerce"."payment_attempts"
  ADD CONSTRAINT attempts_amount CHECK (amount_rwf > 0),
  ADD CONSTRAINT attempts_currency CHECK (currency = 'RWF');
ALTER TABLE "commerce"."payment_receipts" ADD CONSTRAINT receipts_amount CHECK (verified_amount_rwf > 0);
ALTER TABLE "commerce"."refunds" ADD CONSTRAINT refunds_amount CHECK (amount_rwf > 0);
ALTER TABLE "commerce"."reservation_lines" ADD CONSTRAINT reservation_lines_quantity CHECK (quantity > 0);
ALTER TABLE "commerce"."allocations" ADD CONSTRAINT allocations_quantity CHECK (quantity > 0);
ALTER TABLE "commerce"."delivery_quotes" ADD CONSTRAINT quotes_amount CHECK (amount_rwf >= 0);
ALTER TABLE "commerce"."tariffs"
  ADD CONSTRAINT tariffs_values CHECK (base_rwf >= 0 AND extra_rwf_per_km >= 0 AND rounding_rwf > 0
    AND included_metres >= 0 AND max_distance_metres > 0);
ALTER TABLE "commerce"."settings_versions"
  ADD CONSTRAINT settings_ttls CHECK (quote_ttl_seconds BETWEEN 60 AND 86400 AND reservation_ttl_seconds BETWEEN 60 AND 86400);
ALTER TABLE "commerce"."categories" ADD CONSTRAINT categories_not_self_parent CHECK (parent_id IS NULL OR parent_id <> id);
ALTER TABLE "commerce"."dispatch_locations"
  ADD CONSTRAINT locations_coordinates CHECK (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180);
ALTER TABLE "commerce"."checkouts"
  ADD CONSTRAINT checkouts_coordinates CHECK (destination_lat IS NULL OR (destination_lat BETWEEN -90 AND 90 AND destination_lng BETWEEN -180 AND 180));
ALTER TABLE "commerce"."deployment_profile" ADD CONSTRAINT deployment_profile_singleton CHECK (id = 1);
ALTER TABLE "commerce"."supplier_obligations"
  ADD CONSTRAINT obligations_valued CHECK ((basis = 'UNVALUED' AND amount_rwf IS NULL) OR (basis = 'AGREEMENT_COST' AND amount_rwf IS NOT NULL AND amount_rwf >= 0));

-- ---------------------------------------------------------------- single-active and in-flight uniqueness
-- One unresolved payment attempt per order: different idempotency keys cannot bypass it (T03).
CREATE UNIQUE INDEX payment_attempts_one_unresolved_per_order
  ON "commerce"."payment_attempts" (order_id) WHERE state IN ('CREATED', 'PENDING');
-- One active stock reservation per order.
CREATE UNIQUE INDEX reservations_one_active_per_order
  ON "commerce"."reservations" (order_id) WHERE state = 'ACTIVE';
-- At most one external refund in progress per original deposit (pawaPay rule, T11/T12).
CREATE UNIQUE INDEX refunds_one_in_flight_per_receipt
  ON "commerce"."refunds" (receipt_id) WHERE state IN ('SUBMITTED', 'PENDING');
CREATE UNIQUE INDEX carts_one_active_per_session
  ON "commerce"."carts" (guest_session_id) WHERE state = 'ACTIVE';
CREATE UNIQUE INDEX checkouts_one_open_per_cart
  ON "commerce"."checkouts" (cart_id) WHERE state IN ('EDITING', 'REVIEWED', 'PAYMENT_PENDING');
CREATE UNIQUE INDEX quotes_one_valid_per_checkout
  ON "commerce"."delivery_quotes" (checkout_id) WHERE state = 'VALID';
CREATE UNIQUE INDEX sellers_one_active ON "commerce"."sellers" ((true)) WHERE is_active;
CREATE UNIQUE INDEX dispatch_locations_one_active ON "commerce"."dispatch_locations" ((true)) WHERE is_active;
CREATE UNIQUE INDEX receipts_one_applied_per_order
  ON "commerce"."payment_receipts" (order_id) WHERE disposition = 'APPLIED';

-- Due-work indexes for workers and finance queues.
CREATE INDEX outbox_due ON "commerce"."outbox_jobs" (due_at) WHERE state IN ('READY', 'RETRY_DUE');
CREATE INDEX outbox_leased ON "commerce"."outbox_jobs" (lease_until) WHERE state = 'LEASED';
CREATE INDEX attempts_unresolved ON "commerce"."payment_attempts" (next_check_at) WHERE state IN ('CREATED', 'PENDING');

-- Catalog search (title/brand) without a separate search service.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE INDEX products_search_trgm ON "commerce"."products"
  USING gin ((lower(title) || ' ' || lower(brand)) extensions.gin_trgm_ops);

-- ---------------------------------------------------------------- append-only / immutable records
CREATE OR REPLACE FUNCTION "commerce".forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;

CREATE TRIGGER inventory_movements_append_only BEFORE UPDATE OR DELETE ON "commerce"."inventory_movements"
  FOR EACH ROW EXECUTE FUNCTION "commerce".forbid_mutation();
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON "commerce"."audit_events"
  FOR EACH ROW EXECUTE FUNCTION "commerce".forbid_mutation();
CREATE TRIGGER payment_receipts_immutable BEFORE UPDATE OR DELETE ON "commerce"."payment_receipts"
  FOR EACH ROW EXECUTE FUNCTION "commerce".forbid_mutation();
CREATE TRIGGER order_lines_immutable BEFORE UPDATE OR DELETE ON "commerce"."order_lines"
  FOR EACH ROW EXECUTE FUNCTION "commerce".forbid_mutation();
CREATE TRIGGER tariffs_immutable BEFORE UPDATE OR DELETE ON "commerce"."tariffs"
  FOR EACH ROW EXECUTE FUNCTION "commerce".forbid_mutation();
CREATE TRIGGER settings_versions_immutable BEFORE UPDATE OR DELETE ON "commerce"."settings_versions"
  FOR EACH ROW EXECUTE FUNCTION "commerce".forbid_mutation();

-- A verified success is never downgraded (FSD PAY-04).
CREATE OR REPLACE FUNCTION "commerce".guard_attempt_success() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'SUCCEEDED' AND NEW.state <> 'SUCCEEDED' THEN
    RAISE EXCEPTION 'verified payment success cannot be downgraded' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.amount_rwf <> NEW.amount_rwf OR OLD.provider_deposit_id <> NEW.provider_deposit_id OR OLD.order_id <> NEW.order_id THEN
    RAISE EXCEPTION 'payment attempt identity and amount are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_attempts_guard BEFORE UPDATE ON "commerce"."payment_attempts"
  FOR EACH ROW EXECUTE FUNCTION "commerce".guard_attempt_success();

-- ---------------------------------------------------------------- refund budget (defence in depth for T11)
-- Approved, queued, submitted, pending and succeeded refunds can never exceed the
-- verified collection. The receipt row lock serializes concurrent approvals.
CREATE OR REPLACE FUNCTION "commerce".enforce_refund_budget() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  collected bigint;
  reserved bigint;
BEGIN
  SELECT verified_amount_rwf INTO collected FROM "commerce"."payment_receipts" WHERE id = NEW.receipt_id FOR UPDATE;
  SELECT COALESCE(SUM(amount_rwf), 0) INTO reserved FROM "commerce"."refunds"
   WHERE receipt_id = NEW.receipt_id AND state IN ('APPROVED', 'QUEUED', 'SUBMITTED', 'PENDING', 'SUCCEEDED');
  IF reserved > collected THEN
    RAISE EXCEPTION 'refund budget exceeded for receipt %', NEW.receipt_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER refunds_budget AFTER INSERT OR UPDATE ON "commerce"."refunds"
  FOR EACH ROW EXECUTE FUNCTION "commerce".enforce_refund_budget();

-- ---------------------------------------------------------------- demo data never publishes in production (T23)
CREATE OR REPLACE FUNCTION "commerce".guard_production_publication() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  env "commerce"."DeploymentEnvironment";
BEGIN
  SELECT environment INTO env FROM "commerce"."deployment_profile" WHERE id = 1;
  IF NEW.publish_state = 'PUBLISHED' AND NEW.data_origin <> 'VERIFIED' AND (env IS NULL OR env = 'PRODUCTION') THEN
    RAISE EXCEPTION 'only verified products can be published in this environment' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER products_production_publication BEFORE INSERT OR UPDATE ON "commerce"."products"
  FOR EACH ROW EXECUTE FUNCTION "commerce".guard_production_publication();

CREATE OR REPLACE FUNCTION "commerce".guard_profile_demo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.environment = 'PRODUCTION' AND NEW.demo_data_allowed THEN
    RAISE EXCEPTION 'production cannot allow demo data' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deployment_profile_guard BEFORE INSERT OR UPDATE ON "commerce"."deployment_profile"
  FOR EACH ROW EXECUTE FUNCTION "commerce".guard_profile_demo();

-- ---------------------------------------------------------------- runtime privileges
-- Runtime may delete only ephemeral rows; financial and audit history is never deleted.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'beautybox_runtime') THEN
    GRANT DELETE ON "commerce"."cart_lines", "commerce"."rate_limit_buckets" TO beautybox_runtime;
    REVOKE UPDATE ON "commerce"."inventory_movements", "commerce"."audit_events", "commerce"."payment_receipts",
                     "commerce"."order_lines", "commerce"."tariffs", "commerce"."settings_versions" FROM beautybox_runtime;
    -- Row locks (SELECT ... FOR UPDATE) need UPDATE privilege on at least one column; the
    -- immutability trigger still rejects every actual update of a receipt.
    GRANT UPDATE (id) ON "commerce"."payment_receipts" TO beautybox_runtime;
  END IF;
END $$;

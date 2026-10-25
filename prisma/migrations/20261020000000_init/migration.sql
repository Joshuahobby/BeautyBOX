-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "commerce";

-- CreateEnum
CREATE TYPE "commerce"."DataOrigin" AS ENUM ('REFERENCE_DEMO', 'SYNTHETIC_DEMO', 'VERIFIED');

-- CreateEnum
CREATE TYPE "commerce"."ApprovalState" AS ENUM ('DEMO', 'PROPOSED', 'APPROVED');

-- CreateEnum
CREATE TYPE "commerce"."PublishState" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "commerce"."MediaReviewState" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "commerce"."ParcelClass" AS ENUM ('STANDARD', 'BULKY', 'SPECIAL_HANDLING');

-- CreateEnum
CREATE TYPE "commerce"."LotOwnership" AS ENUM ('OWNED', 'CONSIGNED');

-- CreateEnum
CREATE TYPE "commerce"."LotReviewState" AS ENUM ('COUNTED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "commerce"."MovementType" AS ENUM ('RECEIPT', 'ADJUSTMENT', 'RESERVE', 'RELEASE', 'COMMIT', 'UNCOMMIT', 'SHIP', 'RETURN_ACCEPTED');

-- CreateEnum
CREATE TYPE "commerce"."ActorType" AS ENUM ('STAFF', 'SYSTEM', 'CUSTOMER', 'PROVIDER');

-- CreateEnum
CREATE TYPE "commerce"."CartState" AS ENUM ('ACTIVE', 'CONVERTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "commerce"."CheckoutState" AS ENUM ('EDITING', 'REVIEWED', 'PAYMENT_PENDING', 'CONVERTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "commerce"."QuoteState" AS ENUM ('VALID', 'SUPERSEDED', 'USED');

-- CreateEnum
CREATE TYPE "commerce"."OrderState" AS ENUM ('AWAITING_PAYMENT', 'PAID', 'PREPARING', 'ON_HOLD', 'DISPATCHED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "commerce"."OrderPaymentState" AS ENUM ('UNPAID', 'PENDING', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "commerce"."HoldReason" AS ENUM ('STOCK_UNAVAILABLE', 'PAYMENT_REVIEW');

-- CreateEnum
CREATE TYPE "commerce"."ReservationState" AS ENUM ('ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "commerce"."AllocationState" AS ENUM ('COMMITTED', 'SHIPPED', 'RELEASED');

-- CreateEnum
CREATE TYPE "commerce"."PaymentProvider" AS ENUM ('PAWAPAY', 'FAKE');

-- CreateEnum
CREATE TYPE "commerce"."PaymentMethod" AS ENUM ('MTN_MOMO_RWA', 'AIRTEL_RWA');

-- CreateEnum
CREATE TYPE "commerce"."AttemptState" AS ENUM ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "commerce"."VerificationFlag" AS ENUM ('UNKNOWN', 'MISMATCH', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "commerce"."ReceiptDisposition" AS ENUM ('APPLIED', 'OVERPAYMENT', 'AFTER_CANCELLATION', 'REVIEW');

-- CreateEnum
CREATE TYPE "commerce"."RefundCaseSource" AS ENUM ('STAFF_REQUEST', 'OVERPAYMENT', 'CANCELLATION', 'STOCK_HOLD', 'PAYMENT_REVIEW');

-- CreateEnum
CREATE TYPE "commerce"."RefundCaseState" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "commerce"."RefundState" AS ENUM ('REQUESTED', 'APPROVED', 'QUEUED', 'SUBMITTED', 'PENDING', 'SUCCEEDED', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "commerce"."DeliveryState" AS ENUM ('UNASSIGNED', 'ASSIGNED', 'COLLECTED', 'DELIVERED', 'FAILED_ATTEMPT', 'RETURNED');

-- CreateEnum
CREATE TYPE "commerce"."DeliveryOutcome" AS ENUM ('DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "commerce"."ObligationBasis" AS ENUM ('AGREEMENT_COST', 'UNVALUED');

-- CreateEnum
CREATE TYPE "commerce"."SettlementState" AS ENUM ('UNVALUED', 'OPEN', 'SETTLED');

-- CreateEnum
CREATE TYPE "commerce"."StaffRole" AS ENUM ('ADMIN', 'OPERATIONS', 'FINANCE', 'SUPPORT');

-- CreateEnum
CREATE TYPE "commerce"."JobType" AS ENUM ('PAYMENT_INITIATE', 'PAYMENT_CHECK', 'PROVIDER_EVENT_APPLY', 'RESERVATION_EXPIRY', 'REFUND_SUBMIT', 'REFUND_CHECK', 'NOTIFICATION_SEND');

-- CreateEnum
CREATE TYPE "commerce"."JobState" AS ENUM ('READY', 'LEASED', 'SUCCEEDED', 'RETRY_DUE', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "commerce"."SignatureStatus" AS ENUM ('VERIFIED', 'INVALID', 'UNKNOWN_KEY', 'SIMULATED');

-- CreateEnum
CREATE TYPE "commerce"."OperationType" AS ENUM ('CANCELLATION_REQUEST');

-- CreateEnum
CREATE TYPE "commerce"."OperationState" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "commerce"."NotificationState" AS ENUM ('PENDING', 'ACCEPTED', 'FAILED', 'UNKNOWN', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "commerce"."DeploymentEnvironment" AS ENUM ('LOCAL', 'TEST', 'STAGING', 'PRODUCTION');

-- CreateTable
CREATE TABLE "commerce"."deployment_profile" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "environment" "commerce"."DeploymentEnvironment" NOT NULL,
    "demo_data_allowed" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deployment_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."sellers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sellers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."suppliers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "agreement_reference" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "data_origin" "commerce"."DataOrigin" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."dispatch_locations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "seller_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "address_text" TEXT NOT NULL,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(9,6) NOT NULL,
    "hours" JSONB,
    "parcel_rules" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "approval_state" "commerce"."ApprovalState" NOT NULL,
    "data_origin" "commerce"."DataOrigin" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispatch_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."tariffs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version" INTEGER NOT NULL,
    "base_rwf" BIGINT NOT NULL,
    "included_metres" INTEGER NOT NULL,
    "extra_rwf_per_km" BIGINT NOT NULL,
    "rounding_rwf" BIGINT NOT NULL,
    "max_distance_metres" INTEGER NOT NULL,
    "coverage_rules" JSONB NOT NULL,
    "approval_state" "commerce"."ApprovalState" NOT NULL,
    "data_origin" "commerce"."DataOrigin" NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_staff_id" UUID,
    "effective_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."settings_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version" INTEGER NOT NULL,
    "checkout_enabled" BOOLEAN NOT NULL,
    "live_payments_enabled" BOOLEAN NOT NULL,
    "notifications_enabled" BOOLEAN NOT NULL,
    "quote_ttl_seconds" INTEGER NOT NULL,
    "reservation_ttl_seconds" INTEGER NOT NULL,
    "payment_method_allowlist" "commerce"."PaymentMethod"[],
    "active_tariff_id" UUID NOT NULL,
    "active_location_id" UUID NOT NULL,
    "support_contact" JSONB,
    "delivery_promise" TEXT,
    "policies_approved" BOOLEAN NOT NULL DEFAULT false,
    "data_origin" "commerce"."DataOrigin" NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_staff_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "parent_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_published" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "seller_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "pack_size" TEXT,
    "option_label" TEXT,
    "publish_state" "commerce"."PublishState" NOT NULL DEFAULT 'DRAFT',
    "data_origin" "commerce"."DataOrigin" NOT NULL,
    "content_version" INTEGER NOT NULL DEFAULT 1,
    "content_reviewed_at" TIMESTAMPTZ(3),
    "content_reviewed_by" UUID,
    "published_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."product_media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "storage_key" TEXT NOT NULL,
    "alt" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "review_state" "commerce"."MediaReviewState" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."variants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "attributes" JSONB NOT NULL,
    "price_rwf" BIGINT NOT NULL,
    "price_version" INTEGER NOT NULL DEFAULT 1,
    "parcel_class" "commerce"."ParcelClass" NOT NULL DEFAULT 'STANDARD',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."inventory_lots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "variant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "supplier_id" UUID,
    "ownership" "commerce"."LotOwnership" NOT NULL,
    "agreement_reference" TEXT,
    "batch_reference" TEXT NOT NULL,
    "quantity_on_hand" INTEGER NOT NULL,
    "reserved_qty" INTEGER NOT NULL DEFAULT 0,
    "committed_qty" INTEGER NOT NULL DEFAULT 0,
    "expiry_date" DATE,
    "cost_basis_rwf" BIGINT,
    "review_state" "commerce"."LotReviewState" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "data_origin" "commerce"."DataOrigin" NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "inventory_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."inventory_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lot_id" UUID NOT NULL,
    "type" "commerce"."MovementType" NOT NULL,
    "on_hand_delta" INTEGER NOT NULL,
    "reserved_delta" INTEGER NOT NULL,
    "committed_delta" INTEGER NOT NULL,
    "order_id" UUID,
    "reservation_id" UUID,
    "reason" TEXT NOT NULL,
    "actor_type" "commerce"."ActorType" NOT NULL,
    "actor_id" TEXT,
    "dedupe_key" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."guest_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."carts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "guest_session_id" UUID NOT NULL,
    "state" "commerce"."CartState" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."cart_lines" (
    "cart_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "seen_price_rwf" BIGINT NOT NULL,
    "added_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_lines_pkey" PRIMARY KEY ("cart_id","variant_id")
);

-- CreateTable
CREATE TABLE "commerce"."checkouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cart_id" UUID NOT NULL,
    "guest_session_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "state" "commerce"."CheckoutState" NOT NULL DEFAULT 'EDITING',
    "recipient_name" TEXT,
    "recipient_phone" TEXT,
    "landmark" TEXT,
    "instructions" TEXT,
    "destination_lat" DECIMAL(9,6),
    "destination_lng" DECIMAL(9,6),
    "destination_confirmed_at" TIMESTAMPTZ(3),
    "current_quote_id" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."delivery_quotes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "checkout_id" UUID NOT NULL,
    "checkout_revision" INTEGER NOT NULL,
    "basket_fingerprint" TEXT NOT NULL,
    "origin_location_id" UUID NOT NULL,
    "origin_version" INTEGER NOT NULL,
    "origin_lat" DECIMAL(9,6) NOT NULL,
    "origin_lng" DECIMAL(9,6) NOT NULL,
    "destination_lat" DECIMAL(9,6) NOT NULL,
    "destination_lng" DECIMAL(9,6) NOT NULL,
    "distance_metres" INTEGER,
    "amount_rwf" BIGINT NOT NULL,
    "tariff_id" UUID NOT NULL,
    "tariff_version" INTEGER NOT NULL,
    "route_provider" TEXT NOT NULL,
    "provider_evidence_ref" TEXT,
    "state" "commerce"."QuoteState" NOT NULL DEFAULT 'VALID',
    "valid_until" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference" TEXT NOT NULL,
    "seller_id" UUID NOT NULL,
    "checkout_id" UUID NOT NULL,
    "guest_session_id" UUID NOT NULL,
    "state" "commerce"."OrderState" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "payment_state" "commerce"."OrderPaymentState" NOT NULL DEFAULT 'PENDING',
    "hold_reason" "commerce"."HoldReason",
    "snapshot_revision" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "recipient_name" TEXT NOT NULL,
    "recipient_phone" TEXT NOT NULL,
    "landmark" TEXT,
    "instructions" TEXT,
    "destination_lat" DECIMAL(9,6) NOT NULL,
    "destination_lng" DECIMAL(9,6) NOT NULL,
    "origin_location_id" UUID NOT NULL,
    "origin_version" INTEGER NOT NULL,
    "origin_label" TEXT NOT NULL,
    "origin_lat" DECIMAL(9,6) NOT NULL,
    "origin_lng" DECIMAL(9,6) NOT NULL,
    "delivery_quote_id" UUID NOT NULL,
    "tariff_version" INTEGER NOT NULL,
    "distance_metres" INTEGER,
    "products_rwf" BIGINT NOT NULL,
    "delivery_rwf" BIGINT NOT NULL,
    "total_rwf" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "data_origin" "commerce"."DataOrigin" NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancellation_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."order_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "snapshot_revision" INTEGER NOT NULL,
    "variant_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "attributes" JSONB NOT NULL,
    "unit_price_rwf" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "line_total_rwf" BIGINT NOT NULL,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "checkout_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "payment_attempt_id" UUID NOT NULL,
    "state" "commerce"."ReservationState" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."reservation_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reservation_id" UUID NOT NULL,
    "order_line_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "reservation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_line_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "state" "commerce"."AllocationState" NOT NULL DEFAULT 'COMMITTED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."payment_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "provider" "commerce"."PaymentProvider" NOT NULL,
    "provider_deposit_id" UUID NOT NULL,
    "order_snapshot_revision" INTEGER NOT NULL,
    "amount_rwf" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "method" "commerce"."PaymentMethod" NOT NULL,
    "payer_phone_encrypted" TEXT NOT NULL,
    "payer_phone_masked" TEXT NOT NULL,
    "state" "commerce"."AttemptState" NOT NULL DEFAULT 'CREATED',
    "verification_flag" "commerce"."VerificationFlag",
    "provider_status" TEXT,
    "failure_code" TEXT,
    "initiation_accepted_at" TIMESTAMPTZ(3),
    "next_check_at" TIMESTAMPTZ(3),
    "checked_at" TIMESTAMPTZ(3),
    "check_count" INTEGER NOT NULL DEFAULT 0,
    "resolved_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."payment_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attempt_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider_transaction_id" TEXT,
    "verified_amount_rwf" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "disposition" "commerce"."ReceiptDisposition" NOT NULL,
    "evidence_ref" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."refund_cases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "receipt_id" UUID,
    "source" "commerce"."RefundCaseSource" NOT NULL,
    "state" "commerce"."RefundCaseState" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL,
    "requested_by_staff_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "refund_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."refunds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "amount_rwf" BIGINT NOT NULL,
    "state" "commerce"."RefundState" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "requested_by_staff_id" UUID,
    "approved_by_staff_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "provider_refund_id" UUID,
    "submitted_at" TIMESTAMPTZ(3),
    "verified_at" TIMESTAMPTZ(3),
    "failure_code" TEXT,
    "verification_flag" "commerce"."VerificationFlag",
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."fulfillments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "state" "commerce"."DeliveryState" NOT NULL DEFAULT 'UNASSIGNED',
    "rider_reference" TEXT,
    "rider_contact" TEXT,
    "assigned_at" TIMESTAMPTZ(3),
    "collected_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "promised_window_start" TIMESTAMPTZ(3),
    "promised_window_end" TIMESTAMPTZ(3),
    "handover_evidence_key" TEXT,
    "rider_cost_rwf" BIGINT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fulfillments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."delivery_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "outcome" "commerce"."DeliveryOutcome" NOT NULL,
    "reason" TEXT,
    "evidence_key" TEXT,
    "goods_custody" TEXT,
    "recorded_by_staff_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."supplier_obligations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "allocation_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "basis" "commerce"."ObligationBasis" NOT NULL,
    "amount_rwf" BIGINT,
    "settlement_state" "commerce"."SettlementState" NOT NULL,
    "manual_reference" TEXT,
    "settled_by_staff_id" UUID,
    "settled_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."staff_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "auth_user_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "role" "commerce"."StaffRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "role_version" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."private_order_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "issued_by_staff_id" UUID,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "private_order_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."order_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "session_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."customer_operations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "type" "commerce"."OperationType" NOT NULL,
    "state" "commerce"."OperationState" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "outcome" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "customer_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "template_version" INTEGER NOT NULL,
    "state" "commerce"."NotificationState" NOT NULL DEFAULT 'PENDING',
    "provider_message_id" TEXT,
    "last_error_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."idempotency_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."outbox_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "unique_intent_key" TEXT NOT NULL,
    "type" "commerce"."JobType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "state" "commerce"."JobState" NOT NULL DEFAULT 'READY',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 50,
    "due_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_until" TIMESTAMPTZ(3),
    "lease_owner" TEXT,
    "last_error_code" TEXT,
    "last_error_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."provider_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_hash" TEXT NOT NULL,
    "provider" "commerce"."PaymentProvider" NOT NULL,
    "kind" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "claimed_status" TEXT,
    "signature_status" "commerce"."SignatureStatus" NOT NULL,
    "encrypted_evidence" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMPTZ(3),
    "outcome" TEXT,

    CONSTRAINT "provider_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_type" "commerce"."ActorType" NOT NULL,
    "actor_id" TEXT,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before_summary" JSONB,
    "after_summary" JSONB,
    "reason" TEXT,
    "request_id" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "tariffs_version_key" ON "commerce"."tariffs"("version");

-- CreateIndex
CREATE UNIQUE INDEX "settings_versions_version_key" ON "commerce"."settings_versions"("version");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "commerce"."categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "commerce"."products"("slug");

-- CreateIndex
CREATE INDEX "products_publish_state_category_id_idx" ON "commerce"."products"("publish_state", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_media_storage_key_key" ON "commerce"."product_media"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "variants_sku_key" ON "commerce"."variants"("sku");

-- CreateIndex
CREATE INDEX "variants_product_id_idx" ON "commerce"."variants"("product_id");

-- CreateIndex
CREATE INDEX "inventory_lots_variant_id_location_id_expiry_date_idx" ON "commerce"."inventory_lots"("variant_id", "location_id", "expiry_date");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_lots_variant_id_batch_reference_key" ON "commerce"."inventory_lots"("variant_id", "batch_reference");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movements_dedupe_key_key" ON "commerce"."inventory_movements"("dedupe_key");

-- CreateIndex
CREATE INDEX "inventory_movements_lot_id_occurred_at_idx" ON "commerce"."inventory_movements"("lot_id", "occurred_at");

-- CreateIndex
CREATE INDEX "inventory_movements_order_id_idx" ON "commerce"."inventory_movements"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "guest_sessions_token_hash_key" ON "commerce"."guest_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "carts_guest_session_id_state_idx" ON "commerce"."carts"("guest_session_id", "state");

-- CreateIndex
CREATE INDEX "checkouts_cart_id_idx" ON "commerce"."checkouts"("cart_id");

-- CreateIndex
CREATE INDEX "delivery_quotes_checkout_id_state_idx" ON "commerce"."delivery_quotes"("checkout_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "orders_reference_key" ON "commerce"."orders"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "orders_checkout_id_key" ON "commerce"."orders"("checkout_id");

-- CreateIndex
CREATE INDEX "orders_state_created_at_idx" ON "commerce"."orders"("state", "created_at");

-- CreateIndex
CREATE INDEX "orders_payment_state_created_at_idx" ON "commerce"."orders"("payment_state", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_lines_order_id_snapshot_revision_variant_id_key" ON "commerce"."order_lines"("order_id", "snapshot_revision", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_payment_attempt_id_key" ON "commerce"."reservations"("payment_attempt_id");

-- CreateIndex
CREATE INDEX "reservations_state_expires_at_idx" ON "commerce"."reservations"("state", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "reservation_lines_reservation_id_lot_id_order_line_id_key" ON "commerce"."reservation_lines"("reservation_id", "lot_id", "order_line_id");

-- CreateIndex
CREATE INDEX "allocations_order_line_id_idx" ON "commerce"."allocations"("order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_provider_deposit_id_key" ON "commerce"."payment_attempts"("provider_deposit_id");

-- CreateIndex
CREATE INDEX "payment_attempts_state_next_check_at_idx" ON "commerce"."payment_attempts"("state", "next_check_at");

-- CreateIndex
CREATE INDEX "payment_attempts_order_id_idx" ON "commerce"."payment_attempts"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_receipts_attempt_id_key" ON "commerce"."payment_receipts"("attempt_id");

-- CreateIndex
CREATE INDEX "payment_receipts_order_id_idx" ON "commerce"."payment_receipts"("order_id");

-- CreateIndex
CREATE INDEX "refund_cases_state_created_at_idx" ON "commerce"."refund_cases"("state", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_provider_refund_id_key" ON "commerce"."refunds"("provider_refund_id");

-- CreateIndex
CREATE INDEX "refunds_receipt_id_state_idx" ON "commerce"."refunds"("receipt_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "fulfillments_order_id_key" ON "commerce"."fulfillments"("order_id");

-- CreateIndex
CREATE INDEX "delivery_attempts_order_id_idx" ON "commerce"."delivery_attempts"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_obligations_allocation_id_key" ON "commerce"."supplier_obligations"("allocation_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_members_auth_user_id_key" ON "commerce"."staff_members"("auth_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_members_email_key" ON "commerce"."staff_members"("email");

-- CreateIndex
CREATE UNIQUE INDEX "private_order_links_token_hash_key" ON "commerce"."private_order_links"("token_hash");

-- CreateIndex
CREATE INDEX "private_order_links_order_id_idx" ON "commerce"."private_order_links"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_sessions_session_hash_key" ON "commerce"."order_sessions"("session_hash");

-- CreateIndex
CREATE INDEX "customer_operations_order_id_idx" ON "commerce"."customer_operations"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_order_id_event_template_id_template_version_key" ON "commerce"."notifications"("order_id", "event", "template_id", "template_version");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_scope_key_hash_key" ON "commerce"."idempotency_records"("scope", "key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_jobs_unique_intent_key_key" ON "commerce"."outbox_jobs"("unique_intent_key");

-- CreateIndex
CREATE INDEX "outbox_jobs_state_due_at_idx" ON "commerce"."outbox_jobs"("state", "due_at");

-- CreateIndex
CREATE INDEX "outbox_jobs_entity_id_idx" ON "commerce"."outbox_jobs"("entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_events_event_hash_key" ON "commerce"."provider_events"("event_hash");

-- CreateIndex
CREATE INDEX "provider_events_reference_idx" ON "commerce"."provider_events"("reference");

-- CreateIndex
CREATE INDEX "audit_events_entity_type_entity_id_occurred_at_idx" ON "commerce"."audit_events"("entity_type", "entity_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "commerce"."dispatch_locations" ADD CONSTRAINT "dispatch_locations_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "commerce"."sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "commerce"."categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "commerce"."sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "commerce"."categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."product_media" ADD CONSTRAINT "product_media_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "commerce"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."product_media" ADD CONSTRAINT "product_media_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "commerce"."variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."variants" ADD CONSTRAINT "variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "commerce"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."inventory_lots" ADD CONSTRAINT "inventory_lots_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "commerce"."variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."inventory_lots" ADD CONSTRAINT "inventory_lots_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "commerce"."dispatch_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."inventory_lots" ADD CONSTRAINT "inventory_lots_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "commerce"."suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."inventory_movements" ADD CONSTRAINT "inventory_movements_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "commerce"."inventory_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."carts" ADD CONSTRAINT "carts_guest_session_id_fkey" FOREIGN KEY ("guest_session_id") REFERENCES "commerce"."guest_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."cart_lines" ADD CONSTRAINT "cart_lines_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "commerce"."carts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."cart_lines" ADD CONSTRAINT "cart_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "commerce"."variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."checkouts" ADD CONSTRAINT "checkouts_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "commerce"."carts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."checkouts" ADD CONSTRAINT "checkouts_guest_session_id_fkey" FOREIGN KEY ("guest_session_id") REFERENCES "commerce"."guest_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."delivery_quotes" ADD CONSTRAINT "delivery_quotes_checkout_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "commerce"."checkouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."delivery_quotes" ADD CONSTRAINT "delivery_quotes_origin_location_id_fkey" FOREIGN KEY ("origin_location_id") REFERENCES "commerce"."dispatch_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."delivery_quotes" ADD CONSTRAINT "delivery_quotes_tariff_id_fkey" FOREIGN KEY ("tariff_id") REFERENCES "commerce"."tariffs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "commerce"."sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_checkout_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "commerce"."checkouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_guest_session_id_fkey" FOREIGN KEY ("guest_session_id") REFERENCES "commerce"."guest_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."order_lines" ADD CONSTRAINT "order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."order_lines" ADD CONSTRAINT "order_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "commerce"."variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."reservations" ADD CONSTRAINT "reservations_checkout_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "commerce"."checkouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."reservations" ADD CONSTRAINT "reservations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."reservations" ADD CONSTRAINT "reservations_payment_attempt_id_fkey" FOREIGN KEY ("payment_attempt_id") REFERENCES "commerce"."payment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."reservation_lines" ADD CONSTRAINT "reservation_lines_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "commerce"."reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."reservation_lines" ADD CONSTRAINT "reservation_lines_order_line_id_fkey" FOREIGN KEY ("order_line_id") REFERENCES "commerce"."order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."reservation_lines" ADD CONSTRAINT "reservation_lines_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "commerce"."inventory_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."allocations" ADD CONSTRAINT "allocations_order_line_id_fkey" FOREIGN KEY ("order_line_id") REFERENCES "commerce"."order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."allocations" ADD CONSTRAINT "allocations_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "commerce"."inventory_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."payment_attempts" ADD CONSTRAINT "payment_attempts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."payment_receipts" ADD CONSTRAINT "payment_receipts_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "commerce"."payment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."payment_receipts" ADD CONSTRAINT "payment_receipts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."refund_cases" ADD CONSTRAINT "refund_cases_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."refunds" ADD CONSTRAINT "refunds_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "commerce"."refund_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."refunds" ADD CONSTRAINT "refunds_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "commerce"."payment_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."fulfillments" ADD CONSTRAINT "fulfillments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."delivery_attempts" ADD CONSTRAINT "delivery_attempts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."supplier_obligations" ADD CONSTRAINT "supplier_obligations_allocation_id_fkey" FOREIGN KEY ("allocation_id") REFERENCES "commerce"."allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."supplier_obligations" ADD CONSTRAINT "supplier_obligations_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "commerce"."suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."private_order_links" ADD CONSTRAINT "private_order_links_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."order_sessions" ADD CONSTRAINT "order_sessions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."customer_operations" ADD CONSTRAINT "customer_operations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."notifications" ADD CONSTRAINT "notifications_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


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

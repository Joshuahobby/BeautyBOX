-- CreateEnum
CREATE TYPE "commerce"."ImportPreviewState" AS ENUM ('INVALID', 'READY', 'APPLIED');

-- CreateEnum
CREATE TYPE "commerce"."MediaPurpose" AS ENUM ('PRODUCT_PHOTO', 'PRIVATE_EVIDENCE');

-- CreateEnum
CREATE TYPE "commerce"."MediaUploadState" AS ENUM ('INTENT', 'FINALIZED', 'REJECTED');

-- AlterTable
ALTER TABLE "commerce"."inventory_lots" ADD COLUMN     "counted_at" TIMESTAMPTZ(3),
ADD COLUMN     "counted_by_staff_id" UUID,
ADD COLUMN     "import_preview_id" UUID;

-- AlterTable
ALTER TABLE "commerce"."products" ADD COLUMN     "image_rights_confirmed_at" TIMESTAMPTZ(3),
ADD COLUMN     "image_rights_confirmed_by" UUID;

-- CreateTable
CREATE TABLE "commerce"."inventory_import_previews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rows" JSONB NOT NULL,
    "source_hash" TEXT NOT NULL,
    "state" "commerce"."ImportPreviewState" NOT NULL,
    "errors" JSONB NOT NULL,
    "row_count" INTEGER NOT NULL,
    "valid_rows" INTEGER NOT NULL,
    "created_by_staff_id" UUID NOT NULL,
    "applied_by_staff_id" UUID,
    "applied_at" TIMESTAMPTZ(3),
    "apply_reason" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_import_previews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."media_uploads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purpose" "commerce"."MediaPurpose" NOT NULL,
    "declared_mime_type" TEXT NOT NULL,
    "declared_bytes" INTEGER NOT NULL,
    "staging_key" TEXT NOT NULL,
    "storage_key" TEXT,
    "state" "commerce"."MediaUploadState" NOT NULL DEFAULT 'INTENT',
    "width" INTEGER,
    "height" INTEGER,
    "alt" TEXT,
    "reject_reason" TEXT,
    "created_by_staff_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalized_at" TIMESTAMPTZ(3),

    CONSTRAINT "media_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_uploads_staging_key_key" ON "commerce"."media_uploads"("staging_key");

-- CreateIndex
CREATE UNIQUE INDEX "media_uploads_storage_key_key" ON "commerce"."media_uploads"("storage_key");


-- Reviewed additions (I08)
ALTER TABLE "commerce"."media_uploads" ADD CONSTRAINT media_uploads_size CHECK (declared_bytes BETWEEN 1 AND 10000000);
ALTER TABLE "commerce"."inventory_import_previews" ADD CONSTRAINT import_previews_rows CHECK (row_count BETWEEN 0 AND 1000 AND valid_rows BETWEEN 0 AND row_count);

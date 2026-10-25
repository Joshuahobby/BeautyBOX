-- DR-041: background job that keeps the public product-photo bucket in step with each
-- photo's review state (copy when approved, remove otherwise). Additive: an enum value
-- that earlier builds never read.
ALTER TYPE "commerce"."JobType" ADD VALUE 'MEDIA_PUBLIC_SYNC';

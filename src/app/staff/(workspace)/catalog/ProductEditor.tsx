"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { TextAreaField, TextField } from "@/components/ui/TextField";
import {
  api,
  ApiError,
  isDefiniteRejection,
  newIdempotencyKey,
} from "@/lib/api-client";
import { productDraftInput } from "@/server/http/staff-schemas";
import type { StaffProductView } from "@/modules/catalog/admin";
import styles from "@/components/staff/Staff.module.css";
import { uploadStaffPhoto } from "@/lib/staff-photo-upload";

type Category = {
  id: string;
  slug: string;
  title: string;
  parentId: string | null;
};
type VariantRow = {
  id: string | null;
  sku: string;
  shade: string;
  size: string;
  priceRwf: string;
  isActive: boolean;
};
type MediaRow = {
  storageKey: string;
  alt: string;
  variantId: string | null;
  url: string;
  reviewState: string;
};

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const uploadPhoto = uploadStaffPhoto;

const ERROR_TEXT: Record<string, string> = {
  SYNTHETIC_RECORD:
    "This is a demo/reference record and can never be published.",
  CONTENT_NOT_REVIEWED:
    "Confirm the content was reviewed against the packaging.",
  DESCRIPTION_MISSING: "Add a verified description.",
  IMAGE_RIGHTS_NOT_CONFIRMED:
    "Confirm BeautyBOX has the right to use the photos.",
  NO_APPROVED_PHOTO: "Add at least one reviewed product photo.",
  NO_ACTIVE_VARIANT: "Keep at least one active variant.",
  NO_VERIFIED_STOCK: "Import counted stock held at the shop before publishing.",
  CATEGORY_UNPUBLISHED: "The category is hidden.",
};

/** A04 product form: draft first, explicit review flags, unique SKUs, publication checks from the server. */
export function ProductEditor({
  categories,
  product,
}: {
  categories: Category[];
  product: StaffProductView | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(product?.product.title ?? "");
  const [slug, setSlug] = useState(product?.product.slug ?? "");
  const [brand, setBrand] = useState(product?.product.brand ?? "");
  const [categoryId, setCategoryId] = useState(
    product?.categoryId ?? categories[0]?.id ?? "",
  );
  const [description, setDescription] = useState(
    product?.product.description ?? "",
  );
  const [contentReviewed, setContentReviewed] = useState(
    product?.contentReviewed ?? false,
  );
  const [imageRights, setImageRights] = useState(
    product?.imageRightsConfirmed ?? false,
  );
  const [variants, setVariants] = useState<VariantRow[]>(
    product?.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      shade: v.attributes.shade ?? "",
      size: v.attributes.size ?? "",
      priceRwf: String(v.priceRwf),
      isActive: v.isActive,
    })) ?? [
      { id: null, sku: "", shade: "", size: "", priceRwf: "", isActive: true },
    ],
  );
  const [media, setMedia] = useState<MediaRow[]>(
    (product?.media ?? [])
      .filter((m) => m.reviewState !== "REJECTED")
      .map(({ storageKey, alt, variantId, url, reviewState }) => ({
        storageKey,
        alt,
        variantId,
        url,
        reviewState,
      })),
  );
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoAlt, setPhotoAlt] = useState("");
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: "success" | "danger";
    text: string;
    fields?: string[];
  } | null>(null);
  const intent = useRef<{
    key: string;
    endpoint: string;
    method: "POST" | "PUT";
    body: unknown;
    success: string;
    create: boolean;
    isDraft: boolean;
  } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState(false);
  // Advance only from a confirmed own response. An unrelated route refresh must
  // not pair stale entered fields with somebody else's newer product version.
  const [baseVersion, setBaseVersion] = useState(product?.version ?? 0);
  const [lastSaved, setLastSaved] = useState(product);

  const draft = () => ({
    title,
    slug,
    brand,
    categoryId,
    description,
    variants: variants.map((v) => ({
      id: v.id,
      sku: v.sku.trim().toUpperCase(),
      attributes: Object.fromEntries(
        Object.entries({ shade: v.shade.trim(), size: v.size.trim() }).filter(
          ([, val]) => val,
        ),
      ),
      priceRwf: Number(v.priceRwf),
      isActive: v.isActive,
    })),
    media: media.map(({ storageKey, alt, variantId }, sortOrder) => ({
      storageKey,
      alt: alt.trim(),
      variantId,
      sortOrder,
    })),
    contentReviewed,
    imageRightsConfirmed: imageRights,
    isSynthetic: product?.isSynthetic ?? false,
  });

  // The draft as last saved on the server, in the same shape as draft(): publishing acts
  // on the saved version only, so it is refused while the form differs (RF-28).
  const savedDraft = (p: StaffProductView) => ({
    title: p.product.title,
    slug: p.product.slug,
    brand: p.product.brand,
    categoryId: p.categoryId,
    description: p.product.description,
    variants: p.variants.map((v) => ({
      id: v.id,
      sku: v.sku.trim().toUpperCase(),
      attributes: Object.fromEntries(
        Object.entries({
          shade: (v.attributes.shade ?? "").trim(),
          size: (v.attributes.size ?? "").trim(),
        }).filter(([, val]) => val),
      ),
      priceRwf: v.priceRwf,
      isActive: v.isActive,
    })),
    media: p.media
      .filter((m) => m.reviewState !== "REJECTED")
      .map(({ storageKey, alt, variantId }, sortOrder) => ({
        storageKey,
        alt: alt.trim(),
        variantId,
        sortOrder,
      })),
    contentReviewed: p.contentReviewed,
    imageRightsConfirmed: p.imageRightsConfirmed,
    isSynthetic: p.isSynthetic,
  });
  const dirty = lastSaved
    ? JSON.stringify(draft()) !== JSON.stringify(savedDraft(lastSaved))
    : true;

  function focusField(path: PropertyKey[]) {
    path = path.map(String);
    const id =
      path[0] === "variants"
        ? `v-${path[2] === "priceRwf" ? "price" : String(path[2])}-${String(path[1])}`
        : `p-${path[0] === "categoryId" ? "category" : String(path[0])}`;
    document.getElementById(id)?.focus();
  }

  async function sendIntent() {
    if (busy || !intent.current) return;
    setBusy(true);
    setMessage(null);
    const original = intent.current;
    try {
      const saved = await api<StaffProductView>(original.endpoint, {
        method: original.method,
        idempotencyKey: original.key,
        body: original.body,
      });
      intent.current = null;
      setUncertain(false);
      setMessage({ tone: "success", text: original.success });
      setBaseVersion(saved.version);
      setLastSaved(saved);
      if (original.isDraft) {
        // Next refresh preserves client state. Adopt assigned IDs before another
        // save, otherwise a newly added variant is submitted again as a new SKU.
        setTitle(saved.product.title);
        setSlug(saved.product.slug);
        setBrand(saved.product.brand);
        setCategoryId(saved.categoryId);
        setDescription(saved.product.description);
        setContentReviewed(saved.contentReviewed);
        setImageRights(saved.imageRightsConfirmed);
        setVariants(
          saved.variants.map((v) => ({
            id: v.id,
            sku: v.sku,
            shade: v.attributes.shade ?? "",
            size: v.attributes.size ?? "",
            priceRwf: String(v.priceRwf),
            isActive: v.isActive,
          })),
        );
        setMedia(
          saved.media
            .filter((m) => m.reviewState !== "REJECTED")
            .map(({ storageKey, alt, variantId, url, reviewState }) => ({
              storageKey,
              alt,
              variantId,
              url,
              reviewState,
            })),
        );
      }
      if (original.create) router.replace(`/staff/catalog/${saved.product.id}`);
      router.refresh();
    } catch (e) {
      if (isDefiniteRejection(e)) {
        intent.current = null;
        setUncertain(false);
        setConflict(e.code === "VERSION_CONFLICT");
        if (e.fieldErrors[0])
          focusField(e.fieldErrors[0].field.replace(/^draft\./, "").split("."));
      } else setUncertain(true);
      setMessage({
        tone: "danger",
        text: e instanceof ApiError ? e.message : "Something went wrong.",
        fields:
          e instanceof ApiError
            ? e.fieldErrors.map((f) => `${f.field}: ${f.message}`)
            : [],
      });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (busy || conflict || uncertain) return;
    const payload = draft();
    const parsed = productDraftInput.safeParse(payload);
    if (!parsed.success) {
      setMessage({
        tone: "danger",
        text: "Check the product details. Your entries have been kept.",
        fields: parsed.error.issues.map(
          (i) => `${i.path.join(".")}: ${i.message}`,
        ),
      });
      focusField(parsed.error.issues[0]?.path ?? []);
      return;
    }
    intent.current = {
      key: newIdempotencyKey(),
      endpoint: product
        ? `/staff/products/${product.product.id}`
        : "/staff/products",
      method: product ? "PUT" : "POST",
      body: product
        ? { expectedVersion: baseVersion, draft: payload }
        : payload,
      success: "Saved.",
      create: !product,
      isDraft: true,
    };
    await sendIntent();
  }

  async function publication(state: "PUBLISHED" | "ARCHIVED") {
    if (!product || busy || conflict || uncertain) return;
    intent.current = {
      key: newIdempotencyKey(),
      endpoint: `/staff/products/${product.product.id}/publication`,
      method: "POST",
      body: { expectedVersion: baseVersion, state, reason },
      success: state === "PUBLISHED" ? "Published." : "Archived.",
      create: false,
      isDraft: false,
    };
    await sendIntent();
  }

  const update = (i: number, patch: Partial<VariantRow>) =>
    setVariants((rows) =>
      rows.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    );

  async function addPhoto() {
    if (busy || uncertain || conflict || uploading) return;
    setPhotoError(null);
    if (
      !photo ||
      !PHOTO_TYPES.includes(photo.type) ||
      photo.size > 10_000_000
    ) {
      setPhotoError(
        !photo
          ? "Choose a JPEG, PNG or WebP photo."
          : !PHOTO_TYPES.includes(photo.type)
            ? "Use a JPEG, PNG or WebP photo."
            : "Photos must be 10 MB or smaller.",
      );
      fileInput.current?.focus();
      return;
    }
    if (!photoAlt.trim()) {
      setPhotoError("Describe the photo for people who cannot see it.");
      document.getElementById("m-alt-new")?.focus();
      return;
    }
    setUploading(true);
    try {
      const result = await uploadPhoto(photo, photoAlt.trim());
      if ("rejected" in result) {
        setPhotoError(result.rejected);
      } else {
        setMedia((rows) => [
          ...rows,
          {
            storageKey: result.storageKey,
            alt: photoAlt.trim(),
            variantId: null,
            url: result.url,
            reviewState: "PENDING",
          },
        ]);
        setPhoto(null);
        setPhotoAlt("");
        if (fileInput.current) fileInput.current.value = "";
      }
    } catch (e) {
      setPhotoError(
        e instanceof ApiError ? e.message : "The photo could not be uploaded.",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={styles.stack}>
      <p>
        <Link href="/staff/catalog">Back to catalog</Link>
      </p>
      <h1 className="page-title">
        {product ? product.product.title || "Product" : "New product draft"}
      </h1>
      {product ? (
        <Notice
          tone={product.publicationErrors.length ? "warning" : "success"}
          title={`Status: ${product.publishState.toLowerCase()}`}
        >
          {product.publicationErrors.length ? (
            <ul className="u-m-0 u-indent">
              {product.publicationErrors.map((e) => (
                <li key={e}>{ERROR_TEXT[e] ?? e}</li>
              ))}
            </ul>
          ) : (
            <p>All publication checks pass.</p>
          )}
        </Notice>
      ) : null}
      {message ? (
        <Notice
          tone={message.tone}
          title={message.text}
          role={message.tone === "danger" ? "alert" : "status"}
        >
          {message.fields?.length ? (
            <ul className="u-m-0 u-indent">
              {message.fields.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : null}
        </Notice>
      ) : null}
      {uncertain ? (
        <Notice tone="warning" title="Outcome not confirmed" role="status">
          <p>
            Your original product request is kept and editing is locked until
            its outcome is confirmed.
          </p>
          <Button onClick={() => void sendIntent()} busy={busy}>
            Check product outcome
          </Button>
        </Notice>
      ) : null}
      {conflict ? (
        <Notice
          tone="warning"
          title="This record changed. Reload before making another change."
        >
          <Button onClick={() => window.location.reload()}>
            Reload the record
          </Button>
        </Notice>
      ) : null}
      <div className={styles.formGrid}>
        <fieldset
          disabled={busy || uploading || uncertain || conflict}
          className={`${styles.formGrid} ${styles.editorFields}`}
        >
          <legend className="visually-hidden">Product details</legend>
          <TextField
            id="p-title"
            label="Product name"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <TextField
            id="p-slug"
            label="Web address (slug)"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            help="Lowercase letters, numbers and hyphens."
          />
          <TextField
            id="p-brand"
            label="Brand"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
          />
          <div className="stack-2">
            <label htmlFor="p-category" className="label-text u-w-500">
              Category
            </label>
            <select
              id="p-category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={styles.selectField}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.parentId ? `  ${c.title}` : c.title}
                </option>
              ))}
            </select>
          </div>
          <TextAreaField
            id="p-description"
            label="Verified description"
            rows={6}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            help="From the packaging or authorised manufacturer information. No medical or treatment claims."
          />
          <fieldset className={styles.fieldsetPanel}>
            <legend className="u-w-600">
              Variants (each with its own SKU and price)
            </legend>
            <div className={styles.stack}>
              {variants.map((v, i) => (
                <fieldset
                  key={v.id ?? `new-${i}`}
                  className={`${styles.row} u-items-end u-fieldset-bare`}
                >
                  <legend className="visually-hidden">{`Variant ${i + 1}${v.sku ? ` (${v.sku})` : ""}`}</legend>
                  <TextField
                    id={`v-sku-${i}`}
                    label="SKU"
                    value={v.sku}
                    onChange={(e) => update(i, { sku: e.target.value })}
                  />
                  <TextField
                    id={`v-shade-${i}`}
                    label="Shade"
                    optional
                    value={v.shade}
                    onChange={(e) => update(i, { shade: e.target.value })}
                  />
                  <TextField
                    id={`v-size-${i}`}
                    label="Size"
                    optional
                    value={v.size}
                    onChange={(e) => update(i, { size: e.target.value })}
                  />
                  <TextField
                    id={`v-price-${i}`}
                    label="Price (RWF)"
                    inputMode="numeric"
                    value={v.priceRwf}
                    onChange={(e) =>
                      update(i, { priceRwf: e.target.value.replace(/\D/g, "") })
                    }
                  />
                  <label className={`${styles.row} ${styles.minHeight48}`}>
                    <input
                      type="checkbox"
                      checked={v.isActive}
                      onChange={(e) =>
                        update(i, { isActive: e.target.checked })
                      }
                    />{" "}
                    Active
                  </label>
                </fieldset>
              ))}
              <Button
                variant="secondary"
                onClick={() =>
                  setVariants((rows) => [
                    ...rows,
                    {
                      id: null,
                      sku: "",
                      shade: "",
                      size: "",
                      priceRwf: "",
                      isActive: true,
                    },
                  ])
                }
              >
                Add variant
              </Button>
            </div>
          </fieldset>
          <fieldset className={`${styles.stack} ${styles.fieldsetPanel}`}>
            <legend className="u-w-600">Product photos</legend>
            <p className="label-text muted">
              JPEG, PNG or WebP, at least 300 × 300 pixels, up to 10 MB. Each
              photo is checked and re-saved without its metadata. Photos become
              public only after you confirm the review and image rights below,
              save, and publish.
            </p>
            {media.length > 0 ? (
              <ul className={`${styles.stack} u-list-bare`}>
                {media.map((m, i) => (
                  <li
                    key={m.storageKey}
                    className={`${styles.row} u-items-end`}
                  >
                    <img
                      src={m.url}
                      alt=""
                      width={96}
                      height={96}
                      loading="lazy"
                      decoding="async"
                      className={styles.photoThumb}
                    />
                    <TextField
                      id={`m-alt-${i}`}
                      label={`Photo ${i + 1} description`}
                      value={m.alt}
                      onChange={(e) =>
                        setMedia((rows) =>
                          rows.map((r, j) =>
                            j === i ? { ...r, alt: e.target.value } : r,
                          ),
                        )
                      }
                    />
                    <span
                      className={`${styles.status} ${m.reviewState === "APPROVED" ? styles.statusOk : styles.statusWarn}`}
                    >
                      {m.reviewState === "APPROVED"
                        ? "Reviewed"
                        : "Awaiting review"}
                    </span>
                    <Button
                      variant="secondary"
                      aria-label={`Remove photo ${i + 1}`}
                      onClick={() =>
                        setMedia((rows) => rows.filter((_, j) => j !== i))
                      }
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                No photos yet. A product cannot be published without at least
                one reviewed photo.
              </p>
            )}
            <div className="stack-2">
              <label htmlFor="m-file" className="label-text u-w-500">
                Choose a photo
              </label>
              <input
                ref={fileInput}
                id="m-file"
                type="file"
                accept={PHOTO_TYPES.join(",")}
                onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
              />
            </div>
            <TextField
              id="m-alt-new"
              label="Describe the photo"
              value={photoAlt}
              onChange={(e) => setPhotoAlt(e.target.value)}
              help="For example: Front of the 150 ml bottle."
            />
            {photoError ? (
              <Notice tone="danger" title={photoError} role="alert" />
            ) : null}
            <div className={styles.row}>
              <Button
                variant="secondary"
                busy={uploading}
                onClick={() => void addPhoto()}
              >
                Upload photo
              </Button>
            </div>
          </fieldset>
          <label className={styles.row}>
            <input
              type="checkbox"
              checked={contentReviewed}
              onChange={(e) => setContentReviewed(e.target.checked)}
            />{" "}
            I reviewed this content against the actual packaging.
          </label>
          <label className={styles.row}>
            <input
              type="checkbox"
              checked={imageRights}
              onChange={(e) => setImageRights(e.target.checked)}
            />{" "}
            BeautyBOX has the right to use these photos.
          </label>
        </fieldset>
        <div className={styles.row}>
          <Button
            onClick={() => void save()}
            busy={busy}
            disabled={uncertain || conflict || uploading}
          >
            Save draft
          </Button>
        </div>
        {product ? (
          <fieldset
            disabled={busy || uncertain || conflict || uploading}
            className={`${styles.formGrid} ${styles.fieldsetPanel}`}
          >
            <legend className="u-w-600">Publication</legend>
            <TextField
              id="p-reason"
              label="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              help="Recorded in the audit trail."
            />
            {dirty ? (
              <p className="label-text" role="status">
                Save your changes before publishing: publishing always uses the
                last saved draft.
              </p>
            ) : null}
            <div className={styles.row}>
              <Button
                onClick={() => void publication("PUBLISHED")}
                disabled={
                  dirty ||
                  !reason.trim() ||
                  product.publicationErrors.length > 0
                }
                busy={busy}
              >
                Publish
              </Button>
              <Button
                variant="secondary"
                onClick={() => void publication("ARCHIVED")}
                disabled={!reason.trim()}
                busy={busy}
              >
                Archive
              </Button>
            </div>
          </fieldset>
        ) : null}
      </div>
    </div>
  );
}

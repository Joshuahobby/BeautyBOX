# Bulk catalogue intake (staff, access-walled staging)

The reusable **Catalog → Bulk import drafts** page accepts one JSON manifest and a multi-file selection of local JPEG/PNG/WebP photos. It validates every row and every active SKU before uploading anything, then uses the existing authenticated, audited staff product and media APIs. Photos are copied into BeautyBOX-controlled storage and decoded/re-encoded without metadata. The product records contain BeautyBOX storage keys; the manifest contains local filenames, **not supplier URLs**. Keep supplier source links only in restricted intake evidence, never in a shopper record or import manifest.

This is a **draft importer**, not an automatic publication or stock importer. Held rows are counted but skipped. The importer hashes each eligible product draft and its selected photo bytes into a browser-local, per-product checkpoint. It records the media-intent idempotency key before requesting an intent and the returned upload ID before uploading bytes or finalizing; a lost finalize response is reconciled by idempotent finalize of that same ID, not by minting a replacement derivative. It saves the finalized BeautyBOX photo storage key before attempting the product create and uses the same recorded create idempotency key on retry. On rerun with unchanged inputs, it skips **only** drafts whose exact server readback matches the recorded owned photo and draft fields; a lost create response can be reconciled against that photo checkpoint. Changes to held or unrelated rows do not invalidate confirmed products. Any uncheckpointed slug, changed photo, published record or SKU collision stops the batch before a new upload. An expired intent with no stored derivative, or an unresolved/uncertain finalize outcome, requires staff investigation. Server finalization reserves a deterministic immutable key before writing. If a validated derivative already exists at that key, even after intent expiry or staging cleanup, recovery finalizes that first immutable copy rather than re-deriving from potentially overwritten staging bytes; this is not automatic cleanup of older unrelated derivatives. Do not clear browser checkpoints or blindly retry. Do not overwrite or delete unrelated products, including demos.

## Manifest v1

```json
{
  "version": 1,
  "products": [
    {
      "slug": "her-majesty-ice-roller",
      "title": "Ice Roller",
      "brand": "Her Majesty Cosmetics",
      "categorySlug": "skincare",
      "description": "Her Majesty Cosmetics Ice Roller.",
      "photoFile": "HM-022.jpg",
      "variants": [{ "sku": "BB-HMC-0001", "attributes": {}, "priceRwf": 17510 }],
      "contentReviewed": false,
      "imageRightsConfirmed": true,
      "hold": true,
      "holdReason": "Product already exists on staging; reconcile existing draft and photo separately"
    }
  ]
}
```

A staff member must verify text against actual packaging or authorised manufacturer material before setting `contentReviewed=true`. `imageRightsConfirmed=true` records the founder's explicit attestation that Her Majesty authorized copying and hosting its website photos; it does **not** turn website copies into BeautyBOX-original photography. Product drafts with unreviewed text keep photos pending and cannot be published. For future suppliers, leave rights false until independently attested. Prices are proposed integer RWF retail amounts, not supplier unit cost or profit.

## Her Majesty intake snapshot, 26 November 2026

- Private working folder: `../catalog-imports/her-majesty-2026-11-26/` (outside Git). `manifest.json` and `photos/` are the import inputs; `stock-plan.json` is a *proposal*, not an import file. Do not commit the photos or raw scrape to this application repo.
- Generator: `python scripts/catalog/prepare-her-majesty.py --review ../BeautyBOX-OS/ops/her-majesty-source-review.csv --allocation ../BeautyBOX-OS/ops/her-majesty-founder-release-allocation.csv --output ../catalog-imports/her-majesty-2026-11-26 --rights-attested --hold-existing-slug her-majesty-ice-roller`. The earlier `--download` option copies photographs from the supplier site; the rights flag must be supplied only when permission is attested. Redirects are refused and review IDs are filename-validated. Confirm each existing staging slug before using the repeatable hold flag; it is not automatic matching. Paths depend on the worktree location. This generator is supplier-specific; the staff importer and manifest format are reusable.
- Source audit: 43 products, 103 provisional options; 43 local photos downloaded; 35 originally eligible as **drafts** and eight held for source/selector, image/product match, packaging label or handling conflicts. Hosted catalogue readback shows an existing reviewed Ice Roller draft (`BB-HMC-0001`, 17,510 RWF, approved photo) with a different description; the regenerated batch therefore has **34 new eligible drafts and nine held entries** (eight original + existing Ice Roller). The unverified shade labels are *not* supplier SKUs. `BB-HMC-*` are proposed BeautyBOX internal identifiers, not manufacturer SKUs; proposed 3%-uplift retail prices are not supplier cost or approved final shelf prices. The generator assigns proposed named-shade SKUs from a stable review-ID-and-shade digest, rejecting duplicate or blank labels for multi-option products so CSV row reorder or insertion cannot remap an existing named shade. Unlabelled single-option variants retain their unsuffixed base SKU; adding a shade to such a product requires explicit allocation reconciliation instead of guessing what the original unit represented. This regenerated the earlier positional **proposals** before any bulk import; it is still **not** a manufacturer or packaging-confirmed SKU mapping. These mappings need a final exact on-shelf match before counted-stock import or publication.
- The existing staging supplier is a separate record. Ice Roller is held rather than overwritten or treated as a matching import journal entry. Reconcile its description/photo and current reviewed state separately.

## Safe sequence

1. Keep access wall and checkout switches unchanged. Review manifest and photographs; correct held rows and packaging descriptions in one batch. Never silently replace a held option with a guessed shade.
2. Choose `manifest.json` and all local photos in the staff bulk importer; check its whole-batch preflight, then import eligible drafts. Read back exact product, variant SKU/price, private photo storage key, draft state and no supplier URL. Resume only after readback if interrupted.
3. Confirm actual packaging/content and rights, updating review flags through the audited product editor. No bulk stock apply while content is unreviewed. Supplier-site availability is not BeautyBOX on-hand stock.
4. When each active SKU matches the founder's staged allocation, prepare the existing **Stock → Import counted stock** eight-column CSV (`docs/STOCK-IMPORT.md`), preview all eligible lines, apply only once with one reason, and read back lots by variant/SKU. Consigned unit cost stays blank until a supplier cost basis is agreed.
5. Publish only products whose server checks pass (content, approved photo, valid category and sellable verified variant stock). Verify access-walled shopper pages. Back up and identify demo references, then separately unpublish only confirmed demo products after replacements are verified. Public go-live, payments and production remain separate.

The staff importer processes drafts in sequence to respect server audit/idempotency and surface the first uncertain outcome. One staff action replaces repeated per-product form work; it is not a single atomic database transaction across the catalogue. If a partial batch exists, rerun from the same inputs after comparing server state.

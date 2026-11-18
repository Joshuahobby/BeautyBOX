import "server-only";
import { db, transaction, type Tx } from "@/server/db";
import { canonicalJson, sha256Hex } from "@/server/crypto";
import { addSeconds, now } from "@/modules/shared/clock";
import { DomainError, notFound } from "@/modules/shared/errors";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  requestHash,
} from "@/modules/idempotency/idempotency";
import { audit } from "@/modules/audit/audit";
import { currentSettings, kigaliToday } from "@/modules/settings/settings";
import type { StaffIdentity } from "@/modules/staff/identity";
import { applyLotDelta } from "./stock";
import { isCalendarDate } from "@/lib/calendar-date";

// Staff stock administration (A04, CAT-05/06, T18, T23). Every quantity change goes
// through the append-only ledger with actor, reason and reference. Imports create lots
// for existing reviewed SKUs only, from a fresh READY preview whose rows are unchanged.

export type StockLotView = {
  id: string;
  variantId: string;
  locationId: string;
  supplierId: string | null;
  ownership: "OWNED" | "CONSIGNED";
  onHand: number;
  reserved: number;
  committed: number;
  available: number;
  expiryDate: string | null;
  version: number;
  // Additions (CC-09): context for the stock screen
  sku: string;
  productTitle: string;
  batchReference: string;
  isSynthetic: boolean;
};

const lotView = (l: {
  id: string;
  variantId: string;
  locationId: string;
  supplierId: string | null;
  ownership: "OWNED" | "CONSIGNED";
  quantityOnHand: number;
  reservedQty: number;
  committedQty: number;
  expiryDate: Date | null;
  version: number;
  batchReference: string;
  dataOrigin: string;
  variant: { sku: string; product: { title: string } };
}): StockLotView => ({
  id: l.id,
  variantId: l.variantId,
  locationId: l.locationId,
  supplierId: l.supplierId,
  ownership: l.ownership,
  onHand: l.quantityOnHand,
  reserved: l.reservedQty,
  committed: l.committedQty,
  available: Math.max(0, l.quantityOnHand - l.reservedQty - l.committedQty),
  expiryDate: l.expiryDate ? l.expiryDate.toISOString().slice(0, 10) : null,
  version: l.version,
  sku: l.variant.sku,
  productTitle: l.variant.product.title,
  batchReference: l.batchReference,
  isSynthetic: l.dataOrigin !== "VERIFIED",
});

const LOT_INCLUDE = {
  variant: { select: { sku: true, product: { select: { title: true } } } },
} as const;

export async function listStockLots(input: {
  limit?: number;
  cursor?: string | null;
  sku?: string;
}) {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 50);
  const rows = await db().inventoryLot.findMany({
    where: input.sku
      ? { variant: { sku: { contains: input.sku.toUpperCase() } } }
      : undefined,
    include: LOT_INCLUDE,
    orderBy: [{ variant: { sku: "asc" } }, { id: "asc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  return {
    items: rows.slice(0, limit).map(lotView),
    nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
  };
}

export async function adjustStock(
  staff: StaffIdentity,
  input: {
    lotId: string;
    expectedVersion: number;
    quantityDelta: number;
    reason: string;
    reference: string;
  },
  idempotencyKey: string,
  requestId: string | null,
): Promise<StockLotView> {
  const reason = input.reason.trim();
  const reference = input.reference.trim();
  const fieldErrors: { field: string; message: string }[] = [];
  if (
    !Number.isSafeInteger(input.quantityDelta) ||
    input.quantityDelta === 0 ||
    Math.abs(input.quantityDelta) > 1_000_000
  ) {
    fieldErrors.push({
      field: "quantityDelta",
      message: "Enter a whole, non-zero change.",
    });
  }
  if (reason.length < 3)
    fieldErrors.push({
      field: "reason",
      message: "Explain why the stock changed.",
    });
  if (reference.length < 1 || reference.length > 120)
    fieldErrors.push({
      field: "reference",
      message: "Enter the count sheet, sale or incident reference.",
    });
  if (fieldErrors.length)
    throw new DomainError("VALIDATION_ERROR", "Check the adjustment.", {
      fieldErrors,
    });

  await transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, {
      scope: `staff:${staff.staffId}:stock-adjust`,
      key: idempotencyKey,
      requestHash: requestHash("adjustStock", input),
    });
    if (claim.kind === "REPLAY") return;
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM commerce.inventory_lots WHERE id = ${input.lotId}::uuid FOR UPDATE`;
    if (rows.length === 0) throw notFound();
    const lot = await tx.inventoryLot.findUniqueOrThrow({
      where: { id: input.lotId },
    });
    if (lot.version !== input.expectedVersion)
      throw new DomainError(
        "VERSION_CONFLICT",
        "Stock for this lot changed. Reload to see the current figures.",
      );
    if (
      lot.quantityOnHand + input.quantityDelta <
      lot.reservedQty + lot.committedQty
    ) {
      // T18: an offline sale or write-off cannot consume units promised to customers.
      throw new DomainError(
        "ACTION_NOT_ALLOWED",
        `This would leave ${lot.quantityOnHand + input.quantityDelta} on hand, but ${lot.reservedQty + lot.committedQty} are reserved or committed to orders. Resolve those orders first.`,
      );
    }
    await applyLotDelta(
      tx,
      lot.id,
      { onHand: input.quantityDelta, reserved: 0, committed: 0 },
      {
        type: "ADJUSTMENT",
        reason: `${reason} [ref: ${reference}]`,
        actor: { type: "STAFF", id: staff.staffId },
        dedupeKey: `adjust:${lot.id}:${reference}`,
      },
    );
    await audit(tx, {
      actor: { type: "STAFF", id: staff.staffId },
      entityType: "inventory_lot",
      entityId: lot.id,
      action: "STOCK_ADJUSTED",
      before: { onHand: lot.quantityOnHand },
      after: {
        onHand: lot.quantityOnHand + input.quantityDelta,
        delta: input.quantityDelta,
        reference,
      },
      reason,
      requestId,
    });
    await completeIdempotencyKey(tx, claim.recordId, {
      resourceType: "inventory_lot",
      resourceId: lot.id,
      responseStatus: 200,
    });
  }).catch((error) => {
    if (error instanceof Error && /dedupe_key/.test(error.message)) {
      throw new DomainError(
        "ACTION_NOT_ALLOWED",
        "An adjustment with this reference was already recorded for this lot.",
      );
    }
    throw error;
  });
  return lotView(
    await db().inventoryLot.findUniqueOrThrow({
      where: { id: input.lotId },
      include: LOT_INCLUDE,
    }),
  );
}

// ---------------------------------------------------------------- import previews

export type ImportRow = {
  sku: string;
  quantityOnHand: number;
  ownership: "OWNED" | "CONSIGNED";
  supplierId: string | null;
  agreementReference: string | null;
  batchReference: string;
  expiryDate: string | null;
  unitCostRwf: number | null;
};

export type ImportPreviewView = {
  id: string;
  rowCount: number;
  validRows: number;
  errors: { row: number; field: string; message: string }[];
  state: "INVALID" | "READY" | "APPLIED";
  sourceHash: string;
  expiresAt: string;
};

export const MAX_IMPORT_ROWS = 1000;
const PREVIEW_TTL_SECONDS = 30 * 60;

async function validateRows(
  client: Tx | ReturnType<typeof db>,
  rows: ImportRow[],
) {
  const errors: { row: number; field: string; message: string }[] = [];
  const today = kigaliToday(now());
  const seen = new Set<string>();
  const valid = new Set<number>();
  for (const [index, row] of rows.entries()) {
    const n = index + 1;
    const before = errors.length;
    const sku = row.sku.trim().toUpperCase();
    const variant = await client.variant.findUnique({
      where: { sku },
      include: { product: true },
    });
    if (!variant)
      errors.push({
        row: n,
        field: "sku",
        message: "Unknown SKU. Create and review the product first.",
      });
    else {
      if (variant.product.dataOrigin !== "VERIFIED")
        errors.push({
          row: n,
          field: "sku",
          message: "Reference or synthetic SKUs cannot receive real stock.",
        });
      if (!variant.product.contentReviewedAt)
        errors.push({
          row: n,
          field: "sku",
          message: "Product content must be reviewed before stock is imported.",
        });
      if (!variant.isActive)
        errors.push({ row: n, field: "sku", message: "Variant is inactive." });
    }
    if (
      !Number.isSafeInteger(row.quantityOnHand) ||
      row.quantityOnHand < 0 ||
      row.quantityOnHand > 2_147_483_647
    )
      errors.push({
        row: n,
        field: "quantityOnHand",
        message:
          "Counted quantity must be a whole number from 0 to 2,147,483,647.",
      });
    const batch = row.batchReference.trim();
    if (!batch || batch.length > 80)
      errors.push({
        row: n,
        field: "batchReference",
        message: "Enter the batch or lot reference.",
      });
    const identity = `${sku}::${batch}`;
    if (seen.has(identity))
      errors.push({
        row: n,
        field: "batchReference",
        message: "Duplicate SKU and batch in this file.",
      });
    seen.add(identity);
    if (variant && batch) {
      const existing = await client.inventoryLot.findUnique({
        where: {
          variantId_batchReference: {
            variantId: variant.id,
            batchReference: batch,
          },
        },
      });
      if (existing)
        errors.push({
          row: n,
          field: "batchReference",
          message:
            "This lot already exists. Use a stock adjustment to change it.",
        });
    }
    if (row.ownership === "CONSIGNED") {
      if (!row.supplierId)
        errors.push({
          row: n,
          field: "supplierId",
          message: "Consigned stock needs its supplier.",
        });
      else {
        const supplier = await client.supplier.findUnique({
          where: { id: row.supplierId },
        });
        if (!supplier || !supplier.isActive)
          errors.push({
            row: n,
            field: "supplierId",
            message: "Unknown or inactive supplier.",
          });
      }
      if (!row.agreementReference?.trim())
        errors.push({
          row: n,
          field: "agreementReference",
          message: "Consigned stock needs its agreement reference.",
        });
    } else if (row.supplierId) {
      errors.push({
        row: n,
        field: "supplierId",
        message: "Stock owned by BeautyBOX has no supplier.",
      });
    }
    if (row.expiryDate !== null) {
      if (!isCalendarDate(row.expiryDate)) {
        errors.push({
          row: n,
          field: "expiryDate",
          message: "Use YYYY-MM-DD.",
        });
      } else if (row.expiryDate <= today) {
        errors.push({
          row: n,
          field: "expiryDate",
          message: "Expired stock cannot be imported as sellable.",
        });
      }
    }
    if (
      row.unitCostRwf !== null &&
      (!Number.isSafeInteger(row.unitCostRwf) || row.unitCostRwf < 0)
    ) {
      errors.push({
        row: n,
        field: "unitCostRwf",
        message: "Unit cost must be a whole RWF amount.",
      });
    }
    if (errors.length === before) valid.add(n);
  }
  return { errors, validRows: valid.size };
}

const previewView = (p: {
  id: string;
  rowCount: number;
  validRows: number;
  errors: unknown;
  state: ImportPreviewView["state"];
  sourceHash: string;
  expiresAt: Date;
}): ImportPreviewView => ({
  id: p.id,
  rowCount: p.rowCount,
  validRows: p.validRows,
  errors: p.errors as ImportPreviewView["errors"],
  state: p.state,
  sourceHash: p.sourceHash,
  expiresAt: p.expiresAt.toISOString(),
});

export async function previewStockImport(
  staff: StaffIdentity,
  rows: ImportRow[],
  idempotencyKey: string,
  requestId: string | null,
): Promise<ImportPreviewView> {
  if (rows.length === 0 || rows.length > MAX_IMPORT_ROWS) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `Import between 1 and ${MAX_IMPORT_ROWS} rows.`,
      { fieldErrors: [{ field: "rows", message: "Row count out of range." }] },
    );
  }
  const id = await transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, {
      scope: `staff:${staff.staffId}:import-preview`,
      key: idempotencyKey,
      requestHash: requestHash("previewStockImport", rows),
    });
    if (claim.kind === "REPLAY") return claim.resourceId;
    const { errors, validRows } = await validateRows(tx, rows);
    const preview = await tx.inventoryImportPreview.create({
      data: {
        rows: rows as unknown as object,
        sourceHash: sha256Hex(canonicalJson(rows)),
        state: errors.length === 0 ? "READY" : "INVALID",
        errors,
        rowCount: rows.length,
        validRows,
        createdByStaffId: staff.staffId,
        expiresAt: addSeconds(now(), PREVIEW_TTL_SECONDS),
      },
    });
    await audit(tx, {
      actor: { type: "STAFF", id: staff.staffId },
      entityType: "import_preview",
      entityId: preview.id,
      action: "STOCK_IMPORT_PREVIEWED",
      after: { rows: rows.length, errors: errors.length },
      requestId,
    });
    await completeIdempotencyKey(tx, claim.recordId, {
      resourceType: "import_preview",
      resourceId: preview.id,
      responseStatus: 201,
    });
    return preview.id;
  });
  return previewView(
    await db().inventoryImportPreview.findUniqueOrThrow({ where: { id } }),
  );
}

export async function applyStockImport(
  staff: StaffIdentity,
  previewId: string,
  input: { sourceHash: string; reason: string },
  idempotencyKey: string,
  requestId: string | null,
): Promise<ImportPreviewView> {
  if (!input.reason.trim())
    throw new DomainError("VALIDATION_ERROR", "Give a reason.", {
      fieldErrors: [{ field: "reason", message: "Required." }],
    });
  await transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, {
      scope: `staff:${staff.staffId}:import-apply:${previewId}`,
      key: idempotencyKey,
      requestHash: requestHash("applyStockImport", input),
    });
    if (claim.kind === "REPLAY") return;
    const locked = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM commerce.inventory_import_previews WHERE id = ${previewId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw notFound();
    const preview = await tx.inventoryImportPreview.findUniqueOrThrow({
      where: { id: previewId },
    });
    if (preview.state !== "READY")
      throw new DomainError(
        "ACTION_NOT_ALLOWED",
        "Only a ready preview can be applied.",
      );
    if (preview.expiresAt <= now())
      throw new DomainError(
        "ACTION_NOT_ALLOWED",
        "This preview expired. Create a new preview.",
      );
    if (preview.sourceHash !== input.sourceHash)
      throw new DomainError(
        "VERSION_CONFLICT",
        "The import data changed. Create a new preview.",
      );
    const rows = preview.rows as unknown as ImportRow[];
    // Re-validate against current state inside the transaction (SKUs, lots, suppliers).
    const { errors } = await validateRows(tx, rows);
    if (errors.length > 0)
      throw new DomainError(
        "ACTION_NOT_ALLOWED",
        "Stock or catalog changed since the preview. Create a new preview.",
      );
    const settings = await currentSettings(tx);
    const at = now();
    for (const row of rows) {
      const variant = await tx.variant.findUniqueOrThrow({
        where: { sku: row.sku.trim().toUpperCase() },
      });
      const lot = await tx.inventoryLot.create({
        data: {
          variantId: variant.id,
          locationId: settings.activeLocationId,
          supplierId: row.ownership === "CONSIGNED" ? row.supplierId : null,
          ownership: row.ownership,
          agreementReference:
            row.ownership === "CONSIGNED" ? row.agreementReference : null,
          batchReference: row.batchReference.trim(),
          quantityOnHand: 0,
          costBasisRwf:
            row.unitCostRwf === null ? null : BigInt(row.unitCostRwf),
          expiryDate: row.expiryDate
            ? new Date(`${row.expiryDate}T00:00:00Z`)
            : null,
          reviewState: "VERIFIED",
          dataOrigin: "VERIFIED",
          countedByStaffId: staff.staffId,
          countedAt: at,
          importPreviewId: preview.id,
        },
      });
      if (row.quantityOnHand > 0) {
        await applyLotDelta(
          tx,
          lot.id,
          { onHand: row.quantityOnHand, reserved: 0, committed: 0 },
          {
            type: "RECEIPT",
            reason: `Opening count via import ${preview.id}: ${input.reason.trim()}`,
            actor: { type: "STAFF", id: staff.staffId },
          },
        );
      }
    }
    await tx.inventoryImportPreview.update({
      where: { id: previewId },
      data: {
        state: "APPLIED",
        appliedAt: at,
        appliedByStaffId: staff.staffId,
        applyReason: input.reason.trim(),
      },
    });
    await audit(tx, {
      actor: { type: "STAFF", id: staff.staffId },
      entityType: "import_preview",
      entityId: previewId,
      action: "STOCK_IMPORT_APPLIED",
      after: { rows: rows.length },
      reason: input.reason.trim(),
      requestId,
    });
    await completeIdempotencyKey(tx, claim.recordId, {
      resourceType: "import_preview",
      resourceId: previewId,
      responseStatus: 200,
    });
  });
  return previewView(
    await db().inventoryImportPreview.findUniqueOrThrow({
      where: { id: previewId },
    }),
  );
}

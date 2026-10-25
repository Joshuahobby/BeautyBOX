import "server-only";
import type { Tx } from "@/server/db";
import { canonicalJson, sha256Hex } from "@/server/crypto";
import { DomainError } from "@/modules/shared/errors";

// Idempotency keys are claimed atomically with the business intent (handoff
// API-Notes). The claim is an INSERT inside the same transaction as the change:
// a concurrent request with the same key blocks on the unique index until the first
// transaction finishes, then sees the committed record and replays it. If the first
// transaction rolls back, its claim disappears with it. There is no window in which
// a key exists without its effect, or an effect without its key.

export type IdempotencyClaim =
  | { kind: "NEW"; recordId: string }
  | { kind: "REPLAY"; resourceType: string; resourceId: string; responseStatus: number };

const KEY_PATTERN = /^[A-Za-z0-9_\-:.]{16,128}$/;

export function validateIdempotencyKey(key: string | null): string {
  if (!key || !KEY_PATTERN.test(key)) {
    throw new DomainError("VALIDATION_ERROR", "A valid Idempotency-Key header is required.", {
      httpStatus: 400,
      fieldErrors: [{ field: "Idempotency-Key", message: "Send 16-128 URL-safe characters." }],
    });
  }
  return key;
}

export function requestHash(command: string, payload: unknown): string {
  return sha256Hex(`${command}\n${canonicalJson(payload)}`);
}

export async function claimIdempotencyKey(
  tx: Tx,
  input: { scope: string; key: string; requestHash: string },
): Promise<IdempotencyClaim> {
  const keyHash = sha256Hex(input.key);
  const inserted = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO commerce.idempotency_records (scope, key_hash, request_hash)
    VALUES (${input.scope}, ${keyHash}, ${input.requestHash})
    ON CONFLICT (scope, key_hash) DO NOTHING
    RETURNING id`;
  if (inserted.length === 1) return { kind: "NEW", recordId: inserted[0]!.id };

  const existing = await tx.idempotencyRecord.findUnique({
    where: { scope_keyHash: { scope: input.scope, keyHash } },
  });
  if (!existing) {
    // Conflicting row vanished (its transaction rolled back after we waited). Retry the claim once.
    const retry = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO commerce.idempotency_records (scope, key_hash, request_hash)
      VALUES (${input.scope}, ${keyHash}, ${input.requestHash})
      ON CONFLICT (scope, key_hash) DO NOTHING
      RETURNING id`;
    if (retry.length === 1) return { kind: "NEW", recordId: retry[0]!.id };
    throw new DomainError("IDEMPOTENCY_CONFLICT", "This request is already being processed. Please retry.");
  }
  if (existing.requestHash !== input.requestHash) {
    throw new DomainError(
      "IDEMPOTENCY_CONFLICT",
      "This request key was already used for a different request.",
    );
  }
  if (!existing.resourceType || !existing.resourceId || existing.responseStatus == null) {
    throw new DomainError("IDEMPOTENCY_CONFLICT", "This request is already being processed. Please retry.");
  }
  return {
    kind: "REPLAY",
    resourceType: existing.resourceType,
    resourceId: existing.resourceId,
    responseStatus: existing.responseStatus,
  };
}

export async function completeIdempotencyKey(
  tx: Tx,
  recordId: string,
  result: { resourceType: string; resourceId: string; responseStatus: number },
) {
  await tx.idempotencyRecord.update({
    where: { id: recordId },
    data: {
      resourceType: result.resourceType,
      resourceId: result.resourceId,
      responseStatus: result.responseStatus,
    },
  });
}

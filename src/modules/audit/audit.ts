import "server-only";
import type { Tx } from "@/server/db";
import type { ActorType } from "@/generated/prisma/client";
import { now } from "@/modules/shared/clock";

export type Actor = { type: ActorType; id: string | null };

export const SYSTEM_ACTOR: Actor = { type: "SYSTEM", id: null };

/**
 * Append-only audit record written in the same transaction as the change it
 * describes. Summaries must already be redacted: no tokens, PINs, full payer
 * numbers or coordinates.
 */
export async function audit(
  tx: Tx,
  input: {
    actor: Actor;
    entityType: string;
    entityId: string;
    action: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    reason?: string | null;
    requestId?: string | null;
  },
) {
  await tx.auditEvent.create({
    data: {
      actorType: input.actor.type,
      actorId: input.actor.id,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      beforeSummary: (input.before ?? undefined) as object | undefined,
      afterSummary: (input.after ?? undefined) as object | undefined,
      reason: input.reason ?? null,
      requestId: input.requestId ?? null,
      occurredAt: now(),
    },
  });
}

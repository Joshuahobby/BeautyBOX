import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { serverEnv } from "@/server/env";

// One definition of "sellable stock" shared by availability reads and reservation
// locks (handoff Data-and-State-Model "Stock invariant"): active, reviewed,
// unexpired lots at the approved active BeautyBOX location. Demo lots are never
// sellable where the demo catalog is hidden (always in production).

export type StockScope = { locationId: string; todayKigali: string };

export function sellableLotCondition(alias: string, scope: StockScope): Prisma.Sql {
  const l = Prisma.raw(alias);
  const demoClause = serverEnv().DEMO_CATALOG_VISIBLE ? Prisma.empty : Prisma.sql`AND ${l}.data_origin = 'VERIFIED'`;
  return Prisma.sql`${l}.is_active
    AND ${l}.review_state = 'VERIFIED'
    AND ${l}.location_id = ${scope.locationId}::uuid
    AND (${l}.expiry_date IS NULL OR ${l}.expiry_date > ${scope.todayKigali}::date)
    ${demoClause}`;
}

/** Product is visible to the public catalog. */
export function visibleProductCondition(alias: string): Prisma.Sql {
  const p = Prisma.raw(alias);
  const demoClause = serverEnv().DEMO_CATALOG_VISIBLE ? Prisma.empty : Prisma.sql`AND ${p}.data_origin = 'VERIFIED'`;
  return Prisma.sql`${p}.publish_state = 'PUBLISHED' ${demoClause}`;
}

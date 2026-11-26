import { Notice } from "@/components/ui/Notice";
import { staffPageAccess } from "@/server/staff-page";
import { listCategoriesForStaff } from "@/modules/catalog/admin";
import BulkCatalogClient from "./BulkCatalogClient";

export const dynamic = "force-dynamic";
export default async function BulkCatalogPage() {
  const access = await staffPageAccess("catalog.write");
  if (access.kind === "NONE") return null;
  if (access.kind === "FORBIDDEN") return <Notice tone="warning" title="Your role does not include catalogue imports." />;
  return <BulkCatalogClient categories={await listCategoriesForStaff()} />;
}

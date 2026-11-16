import { staffPageAccess } from "@/server/staff-page";
import { Notice } from "@/components/ui/Notice";
import ImportClient from "./ImportClient";

export const dynamic = "force-dynamic";
export default async function StockImportPage() {
  const access = await staffPageAccess("stock.import");
  if (access.kind === "NONE") return null;
  if (access.kind === "FORBIDDEN")
    return (
      <Notice
        tone="warning"
        title="Your role does not include stock imports."
      />
    );
  return <ImportClient />;
}

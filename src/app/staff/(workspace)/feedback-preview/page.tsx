import { notFound } from "next/navigation";
import { staffPageAccess } from "@/server/staff-page";
import { serverEnv } from "@/server/env";
import { testFeedback } from "@/server/test-feedback";
export const dynamic = "force-dynamic";
export default async function Feedback({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (serverEnv().APP_ENV !== "test") notFound();
  const access = await staffPageAccess("orders.read");
  if (access.kind !== "OK") return null;
  await testFeedback(searchParams);
  return (
    <div>
      <h1 className="page-title">Workspace read recovered</h1>
      <p>TEST feedback preview.</p>
    </div>
  );
}

import { testFeedback } from "@/server/test-feedback";
export const dynamic = "force-dynamic";
export default async function Feedback({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await testFeedback(searchParams);
  return (
    <div className="container section">
      <h1 className="page-title">Shop read recovered</h1>
      <p>TEST feedback preview.</p>
    </div>
  );
}

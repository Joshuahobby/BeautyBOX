import "server-only";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { serverEnv } from "./env";

/** TEST-only route read probes. No mutation or external service call. */
export async function testFeedback(
  params: Promise<Record<string, string | undefined>>,
) {
  if (serverEnv().APP_ENV !== "test") notFound();
  const sp = await params;
  const delay = Math.min(5000, Math.max(0, Number(sp.delay) || 0));
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  if (
    sp.fail === "1" &&
    (await cookies()).get("bb-test-read-recovered")?.value !== "1"
  )
    throw new Error("TEST read failure");
}

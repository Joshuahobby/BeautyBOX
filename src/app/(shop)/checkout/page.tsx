import type { Metadata } from "next";
import { serverEnv } from "@/server/env";
import { FAKE_SCENARIOS } from "@/adapters/payments/fake";
import { CheckoutFlow } from "./CheckoutFlow";

export const metadata: Metadata = { title: "Checkout", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function CheckoutPage() {
  const env = serverEnv();
  // Simulator hints only exist where the fake payment provider is configured (never production).
  const demoScenarios =
    env.PAYMENT_PROVIDER === "fake"
      ? [
          { suffix: "any other", label: "Succeeds after a few seconds" },
          ...Object.entries(FAKE_SCENARIOS).map(([suffix, s]) => ({ suffix, label: s.label })),
        ]
      : null;
  return (
    <div className="container page">
      <CheckoutFlow demoScenarios={demoScenarios} />
    </div>
  );
}

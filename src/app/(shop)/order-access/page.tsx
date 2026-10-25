import type { Metadata } from "next";
import { OrderAccess } from "./OrderAccess";

// U13 entry from a private link. Referrer-Policy no-referrer, no-store and noindex are set
// for this path in next.config.ts; the page loads no third-party scripts.
export const metadata: Metadata = { title: "Your order", robots: { index: false, follow: false } };

export default function OrderAccessPage() {
  return (
    <div className="container page u-max-608">
      <OrderAccess />
    </div>
  );
}

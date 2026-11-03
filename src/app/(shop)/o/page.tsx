import type { Metadata } from "next";
import { OrderAccess } from "../order-access/OrderAccess";

// Short private-link page for SMS (DR-049): https://<origin>/o#<token>. Same behaviour as
// /order-access: the token is read from the fragment, removed from the address bar and
// exchanged once. Referrer-Policy no-referrer, no-store and noindex are set for this path in
// next.config.ts; the page loads no third-party scripts.
export const metadata: Metadata = { title: "Your order", robots: { index: false, follow: false } };

export default function ShortOrderAccessPage() {
  return (
    <div className="container page u-max-608">
      <OrderAccess />
    </div>
  );
}

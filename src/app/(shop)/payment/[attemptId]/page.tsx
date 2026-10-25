import type { Metadata } from "next";
import { PaymentStatus } from "./PaymentStatus";

export const metadata: Metadata = { title: "Payment status", robots: { index: false, follow: false } };

export default async function PaymentPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  return (
    <div className="container page u-max-608">
      <PaymentStatus attemptId={attemptId} />
    </div>
  );
}

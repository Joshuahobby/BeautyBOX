// Response shapes of the application API used by browser components. They mirror the
// server projections (docs/api/openapi.json plus documented additions).

export type LineIssue = "UNAVAILABLE" | "INSUFFICIENT_STOCK" | "PRICE_CHANGED" | "SPECIAL_PARCEL";

export type CartLine = {
  variantId: string;
  productSlug: string;
  title: string;
  sku: string;
  attributes: Record<string, string>;
  quantity: number;
  unitPriceRwf: number;
  previousUnitPriceRwf: number | null;
  lineTotalRwf: number;
  availableQuantity: number;
  issues: LineIssue[];
};

export type Cart = {
  id: string;
  version: number;
  lines: CartLine[];
  subtotalRwf: number;
  currency: "RWF";
  expiresAt: string;
  canCheckout: boolean;
  paymentPending: boolean;
  checkoutId: string | null;
};

export type Recipient = { name: string; phone: string; landmark?: string; instructions?: string };
export type Point = { lat: number; lng: number };

export type Checkout = {
  id: string;
  cartId: string;
  revision: number;
  state: "EDITING" | "REVIEWED" | "PAYMENT_PENDING" | "CONVERTED" | "EXPIRED";
  recipient: Recipient | null;
  destination: Point | null;
  destinationConfirmed: boolean;
  quoteId: string | null;
  productsRwf: number;
  deliveryRwf: number | null;
  totalRwf: number | null;
  expiresAt: string;
  quote: { id: string; amountRwf: number; validUntil: string; tariffVersion: number; serviceDescription: string } | null;
  orderId: string | null;
  orderReference: string | null;
  activeAttemptId: string | null;
  lastAttempt: { id: string; state: string } | null;
};

export type Quote = {
  id: string;
  checkoutId: string;
  checkoutRevision: number;
  amountRwf: number;
  currency: "RWF";
  tariffVersion: number;
  validUntil: string;
  serviceDescription: string;
};

export type PaymentMethodCode = "MTN_MOMO_RWA" | "AIRTEL_RWA";

export type PaymentAttempt = {
  id: string;
  orderId: string;
  state: "CREATED" | "PENDING" | "SUCCEEDED" | "FAILED";
  verificationFlag: "UNKNOWN" | "MISMATCH" | "NEEDS_REVIEW" | null;
  amountRwf: number;
  currency: "RWF";
  method: PaymentMethodCode;
  payerPhoneMasked: string;
  statusUrl: string;
  nextCheckAfterSeconds: number;
  orderReference: string;
  orderState: string;
  createdAt: string;
};

export type PlaceSuggestion = { placeId: string; label: string; secondary: string | null };

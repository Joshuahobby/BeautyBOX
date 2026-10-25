import "server-only";
import { paymentAdapter } from "@/adapters/registry";

export function paymentProviderCode(): "PAWAPAY" | "FAKE" {
  return paymentAdapter().provider;
}

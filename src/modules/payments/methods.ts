import "server-only";
import { paymentAdapter } from "@/adapters/registry";
import type { PaymentMethodCode } from "@/adapters/payments/types";
import { currentSettings } from "@/modules/settings/settings";
import { now } from "@/modules/shared/clock";

// Merchant-enabled methods intersected with the approved allowlist (PAY-01, T24).
// Provider additions never widen the product scope. Cached briefly only.

const APPROVED: readonly PaymentMethodCode[] = ["MTN_MOMO_RWA", "AIRTEL_RWA"];
const CACHE_MS = 60_000;
let cache: { at: number; value: { methods: PaymentMethodCode[]; temporarilyUnavailable: boolean } } | undefined;

export async function enabledPaymentMethods(): Promise<{ methods: PaymentMethodCode[]; temporarilyUnavailable: boolean }> {
  const t = now().getTime();
  if (cache && t - cache.at < CACHE_MS) return cache.value;
  const settings = await currentSettings();
  let value: { methods: PaymentMethodCode[]; temporarilyUnavailable: boolean };
  try {
    const provider = await paymentAdapter().getEnabledMethods();
    const methods = APPROVED.filter((m) => settings.paymentMethodAllowlist.includes(m) && provider.methods.includes(m));
    value = { methods, temporarilyUnavailable: !provider.healthy || methods.length === 0 };
  } catch {
    value = { methods: [], temporarilyUnavailable: true };
  }
  cache = { at: t, value };
  return value;
}

export function clearPaymentMethodCache() {
  cache = undefined;
}

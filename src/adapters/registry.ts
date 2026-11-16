import "server-only";
import { serverEnv } from "@/server/env";
import type { PaymentAdapter } from "./payments/types";
import type { PlacesAdapter, RoutingAdapter } from "./routing/types";
import type { SmsAdapter } from "./sms/types";
import { FakePaymentAdapter } from "./payments/fake";
import { PAWAPAY_BASE_URLS, PawapayPaymentAdapter } from "./payments/pawapay";
import { GooglePlacesAdapter, GoogleRoutingAdapter } from "./routing/google";
import { FakePlacesAdapter, FakeRoutingAdapter } from "./routing/fake";
import { DisabledSmsAdapter, FakeSmsAdapter } from "./sms/fake";
import path from "node:path";
import type { MediaStorage } from "./storage/types";
import { LocalMediaStorage } from "./storage/local";
import { SupabaseMediaStorage } from "./storage/supabase";

// Adapter selection is server configuration only; no request can choose a provider.
// Real adapters (pawaPay I07, Google I12, Africa's Talking I11) plug in here behind
// their gates. Selecting one that is not implemented fails closed.

type Overrides = {
  payments?: PaymentAdapter;
  routing?: RoutingAdapter;
  places?: PlacesAdapter;
  sms?: SmsAdapter;
  media?: MediaStorage;
};
let overrides: Overrides = {};
let cache: Required<Overrides> | undefined;

function notImplemented(name: string): never {
  throw new Error(
    `${name} adapter is not available in this build; keep the fake/disabled adapter until its gate passes`,
  );
}

function build(): Required<Overrides> {
  const env = serverEnv();
  return {
    payments:
      env.PAYMENT_PROVIDER === "fake"
        ? new FakePaymentAdapter()
        : new PawapayPaymentAdapter({
            // env validation guarantees the mode/address rules (production only in production).
            baseUrl:
              env.PAWAPAY_BASE_URL ??
              PAWAPAY_BASE_URLS[env.PAWAPAY_MODE ?? "sandbox"],
            apiToken: env.PAWAPAY_API_TOKEN!,
            signing:
              env.PAWAPAY_SIGNING_PRIVATE_KEY && env.PAWAPAY_SIGNING_KEY_ID
                ? {
                    keyId: env.PAWAPAY_SIGNING_KEY_ID,
                    privateKeyPem: env.PAWAPAY_SIGNING_PRIVATE_KEY,
                  }
                : undefined,
          }),
    routing:
      env.ROUTING_PROVIDER === "fake"
        ? new FakeRoutingAdapter()
        : new GoogleRoutingAdapter(
            env.GOOGLE_ROUTES_API_KEY!,
            env.GOOGLE_TWO_WHEELER_COVERAGE_APPROVED,
          ),
    places:
      env.ROUTING_PROVIDER === "fake"
        ? new FakePlacesAdapter()
        : new GooglePlacesAdapter(
            env.GOOGLE_PLACES_API_KEY ?? env.GOOGLE_ROUTES_API_KEY!,
          ),
    sms:
      env.SMS_PROVIDER === "fake"
        ? new FakeSmsAdapter()
        : env.SMS_PROVIDER === "disabled"
          ? new DisabledSmsAdapter()
          : notImplemented("Africa's Talking"),
    media:
      env.MEDIA_STORAGE === "local"
        ? new LocalMediaStorage(
            path.resolve(process.cwd(), ".local", "media", env.APP_ENV),
            env.APP_ORIGIN,
          )
        : new SupabaseMediaStorage(
            env.NEXT_PUBLIC_SUPABASE_URL!,
            env.SUPABASE_SECRET_KEY!,
            env.SUPABASE_PRIVATE_MEDIA_BUCKET,
            env.SUPABASE_PUBLIC_MEDIA_BUCKET,
          ),
  };
}

function adapters(): Required<Overrides> {
  cache ??= build();
  return { ...cache, ...overrides } as Required<Overrides>;
}

export const paymentAdapter = () => adapters().payments;
export const routingAdapter = () => adapters().routing;
export const placesAdapter = () => adapters().places;
export const smsAdapter = () => adapters().sms;
export const mediaStorage = () => adapters().media;

/** Test hook: replace adapters (e.g. a fault-injecting payment provider). */
export function setAdaptersForTests(next: Overrides) {
  overrides = next;
}

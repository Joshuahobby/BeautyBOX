import { afterEach, describe, expect, it } from "vitest";
import { resetServerEnvForTests, serverEnv } from "@/server/env";

// DR-042: production pawaPay (real money) only with APP_ENV=production; production never on
// the sandbox; a custom pawaPay address only for local imitations; signing settings in pairs.

const saved = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  resetServerEnvForTests();
});

function configure(values: Record<string, string>) {
  for (const k of Object.keys(process.env)) if (/^(APP_|PAWAPAY_|PAYMENT_|ROUTING_|SMS_|MEDIA_|NEXT_PUBLIC_|SUPABASE_|STAFF_|DEMO_)/.test(k)) delete process.env[k];
  Object.assign(process.env, {
    APP_ENV: "local",
    APP_ORIGIN: "http://localhost:3000",
    DATABASE_URL: "postgres://user:pass@127.0.0.1:5432/db",
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    TOKEN_HASH_SECRET: "t".repeat(40),
    WORKER_SECRET: "w".repeat(40),
    PAYMENT_PROVIDER: "pawapay",
    ROUTING_PROVIDER: "fake",
    SMS_PROVIDER: "fake",
    PAWAPAY_API_TOKEN: "token-value",
    ...values,
  });
  resetServerEnvForTests();
}

const problems = () => {
  try {
    serverEnv();
    return "";
  } catch (error) {
    return String((error as Error).message);
  }
};

describe("pawaPay configuration guard", () => {
  it("refuses production pawaPay outside production, so a development machine cannot take real money", () => {
    configure({ PAWAPAY_MODE: "production" });
    expect(problems()).toMatch(/PAWAPAY_MODE: production pawaPay moves real money/);
    configure({ PAWAPAY_MODE: "production", APP_ENV: "staging", APP_ORIGIN: "https://staging.example" });
    expect(problems()).toMatch(/PAWAPAY_MODE: production pawaPay moves real money/);
  });

  it("allows the sandbox in development, and leaves production keys alone while the simulator is used", () => {
    configure({ PAWAPAY_MODE: "sandbox" });
    expect(problems()).toBe("");
    configure({ PAYMENT_PROVIDER: "fake", PAWAPAY_MODE: "production" });
    expect(problems()).toBe("");
  });

  it("needs a token and a mode, and a custom address only for local imitations", () => {
    configure({ PAWAPAY_API_TOKEN: "" });
    expect(problems()).toMatch(/PAWAPAY_API_TOKEN/);
    configure({});
    expect(problems()).toMatch(/PAWAPAY_MODE: set PAWAPAY_MODE/);
    configure({ PAWAPAY_BASE_URL: "http://127.0.0.1:4010" });
    expect(problems()).toBe("");
    configure({ PAWAPAY_BASE_URL: "http://127.0.0.1:4010", APP_ENV: "staging", APP_ORIGIN: "https://staging.example", PAWAPAY_MODE: "sandbox" });
    expect(problems()).toMatch(/PAWAPAY_BASE_URL/);
  });

  it("a custom address can only be a local imitation, never pawaPay itself or another machine", () => {
    for (const address of [
      "https://api.pawapay.io",
      "https://API.PAWAPAY.IO/",
      "https://api.pawapay.io:443",
      "https://api.sandbox.pawapay.io",
      "https://api.pawapay.io./v2",
      "http://payments.example.com",
      "http://10.0.0.5:4010",
      "ftp://127.0.0.1",
    ]) {
      configure({ PAWAPAY_BASE_URL: address });
      expect(problems(), address).toMatch(/PAWAPAY_BASE_URL/);
      configure({ PAWAPAY_BASE_URL: address, PAWAPAY_MODE: "sandbox" });
      expect(problems(), address).toMatch(/PAWAPAY_BASE_URL/);
    }
    for (const address of ["http://127.0.0.1:4010", "http://localhost:4010", "http://[::1]:4010", "http://mock.localhost:4010"]) {
      configure({ PAWAPAY_BASE_URL: address });
      expect(problems(), address).toBe("");
    }
  });

  it("production must use production pawaPay", () => {
    configure({ APP_ENV: "production", APP_ORIGIN: "https://shop.example", PAWAPAY_MODE: "sandbox", ROUTING_PROVIDER: "google", GOOGLE_ROUTES_API_KEY: "k", SMS_PROVIDER: "disabled", MEDIA_STORAGE: "supabase", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "s" });
    expect(problems()).toMatch(/production needs PAWAPAY_MODE=production/);
  });

  it("signing settings come in pairs", () => {
    configure({ PAWAPAY_MODE: "sandbox", PAWAPAY_SIGNING_KEY_ID: "KEY_1" });
    expect(problems()).toMatch(/PAWAPAY_SIGNING_KEY_ID: set both/);
  });
});

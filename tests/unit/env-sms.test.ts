import { afterEach, describe, expect, it } from "vitest";
import { publicSecretProblems, resetServerEnvForTests, serverEnv } from "@/server/env";

// DR-048: Africa's Talking settings. Outside production only the sandbox (which texts nobody) is
// accepted, because every other environment holds synthetic numbers that may belong to real
// people; production needs the live account and an approved sender ID. Values are never echoed.

const saved = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  resetServerEnvForTests();
});

const KEY = "atsk_0123456789abcdef0123456789abcdef";

function configure(values: Record<string, string>) {
  for (const k of Object.keys(process.env)) if (/^(APP_|PAWAPAY_|PAYMENT_|ROUTING_|SMS_|MEDIA_|NEXT_PUBLIC_|SUPABASE_|STAFF_|DEMO_|AFRICASTALKING_|DATABASE_)/.test(k)) delete process.env[k];
  Object.assign(process.env, {
    APP_ENV: "local",
    APP_ORIGIN: "http://localhost:3000",
    DATABASE_URL: "postgres://user:pass@127.0.0.1:5432/db",
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    TOKEN_HASH_SECRET: "t".repeat(40),
    WORKER_SECRET: "w".repeat(40),
    PAYMENT_PROVIDER: "fake",
    ROUTING_PROVIDER: "fake",
    SMS_PROVIDER: "africastalking",
    AFRICASTALKING_USERNAME: "sandbox",
    AFRICASTALKING_API_KEY: KEY,
    ...values,
  });
  resetServerEnvForTests();
}

function production(values: Record<string, string> = {}) {
  configure({
    APP_ENV: "production",
    APP_ORIGIN: "https://beautyboxmarket.com",
    DATABASE_SSL: "verify",
    DATABASE_SSL_CA: "-----BEGIN CERTIFICATE-----\\nAAAA\\n-----END CERTIFICATE-----",
    PAYMENT_PROVIDER: "pawapay",
    PAWAPAY_MODE: "production",
    PAWAPAY_API_TOKEN: "token-value",
    MEDIA_STORAGE: "supabase",
    NEXT_PUBLIC_SUPABASE_URL: "https://ref.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_x",
    AFRICASTALKING_USERNAME: "beautybox",
    AFRICASTALKING_SENDER_ID: "BeautyBOX",
    ...values,
  });
}

const problems = () => {
  try {
    serverEnv();
    return "";
  } catch (error) {
    return String((error as Error).message);
  }
};

describe("Africa's Talking settings", () => {
  it("accepts the sandbox in development, with or without a sender ID and delivery-report token", () => {
    configure({});
    expect(problems()).toBe("");
    configure({ AFRICASTALKING_SENDER_ID: "BeautyBOX", AFRICASTALKING_CALLBACK_TOKEN: "c".repeat(43) });
    expect(problems()).toBe("");
  });

  it("needs a username and an API key, and never echoes the key", () => {
    configure({ AFRICASTALKING_USERNAME: "" });
    expect(problems()).toMatch(/AFRICASTALKING_USERNAME: required when SMS_PROVIDER=africastalking/);
    configure({ AFRICASTALKING_API_KEY: "" });
    expect(problems()).toMatch(/AFRICASTALKING_API_KEY: required when SMS_PROVIDER=africastalking/);
    configure({ AFRICASTALKING_API_KEY: "has a space in it" });
    expect(problems()).toMatch(/AFRICASTALKING_API_KEY: must be the API key/);
    expect(problems()).not.toContain("has a space");
  });

  it("refuses a live account outside production, so no synthetic number gets a real SMS", () => {
    configure({ AFRICASTALKING_USERNAME: "beautybox" });
    expect(problems()).toMatch(/AFRICASTALKING_USERNAME: a live Africa's Talking account texts real phones/);
    configure({ APP_ENV: "test", AFRICASTALKING_USERNAME: "beautybox" });
    expect(problems()).toMatch(/AFRICASTALKING_USERNAME: a live Africa's Talking account/);
  });

  it("needs the live account and an approved sender ID in production", () => {
    // Production cannot pass as a whole yet (routing is not built), so only the SMS rules are checked.
    production();
    expect(problems()).not.toMatch(/AFRICASTALKING|SMS_PROVIDER/);
    production({ AFRICASTALKING_USERNAME: "sandbox" });
    expect(problems()).toMatch(/AFRICASTALKING_USERNAME: production needs the live Africa's Talking account/);
    production({ AFRICASTALKING_SENDER_ID: "" });
    expect(problems()).toMatch(/AFRICASTALKING_SENDER_ID: production needs the approved sender ID/);
  });

  it("checks the shape of the sender ID and the delivery-report token", () => {
    configure({ AFRICASTALKING_SENDER_ID: "BeautyBOX Rwanda" });
    expect(problems()).toMatch(/AFRICASTALKING_SENDER_ID: must be an approved sender ID/);
    configure({ AFRICASTALKING_SENDER_ID: "20414" });
    expect(problems()).toBe("");
    configure({ AFRICASTALKING_CALLBACK_TOKEN: "short" });
    expect(problems()).toMatch(/AFRICASTALKING_CALLBACK_TOKEN: must be 32 to 128/);
    expect(problems()).not.toContain("short");
  });

  it("leaves Africa's Talking settings alone while SMS is off or simulated", () => {
    configure({ SMS_PROVIDER: "fake", AFRICASTALKING_USERNAME: "beautybox", AFRICASTALKING_API_KEY: "" });
    expect(problems()).toBe("");
    configure({ SMS_PROVIDER: "disabled", AFRICASTALKING_USERNAME: "" });
    expect(problems()).toBe("");
  });

  it("refuses Africa's Talking secrets under the NEXT_PUBLIC_ prefix", () => {
    expect(publicSecretProblems({ NEXT_PUBLIC_AFRICASTALKING_API_KEY: "x", NEXT_PUBLIC_SMS_CALLBACK_TOKEN: "y" })).toEqual([
      "NEXT_PUBLIC_AFRICASTALKING_API_KEY: secrets must not use the NEXT_PUBLIC_ prefix, which sends them to browsers",
      "NEXT_PUBLIC_SMS_CALLBACK_TOKEN: secrets must not use the NEXT_PUBLIC_ prefix, which sends them to browsers",
    ]);
  });
});

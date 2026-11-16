import { afterEach, describe, expect, it } from "vitest";
import { resetServerEnvForTests, serverEnv } from "@/server/env";

// DR-044/045: staging on serverless hosting, the pre-launch wall and the launch list.

const saved = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env))
    if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  resetServerEnvForTests();
});

const HASH =
  "scrypt:32768:8:1:c2FsdHNhbHRzYWx0c2FsdA:aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g";

function staging(values: Record<string, string> = {}) {
  for (const k of Object.keys(process.env))
    if (
      /^(APP_|PAWAPAY_|PAYMENT_|ROUTING_|GOOGLE_|SMS_|MEDIA_|NEXT_PUBLIC_|SUPABASE_|STAFF_|DEMO_|SITE_|HOLDING_|LAUNCH_|DATABASE_)/.test(
        k,
      )
    )
      delete process.env[k];
  Object.assign(process.env, {
    APP_ENV: "staging",
    APP_ORIGIN: "https://staging.beautyboxmarket.com",
    DATABASE_URL:
      "postgres://beautybox_app.ref:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres",
    DATABASE_SSL: "verify",
    DATABASE_SSL_CA:
      "-----BEGIN CERTIFICATE-----\\nAAAA\\n-----END CERTIFICATE-----",
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    TOKEN_HASH_SECRET: "t".repeat(40),
    WORKER_SECRET: "w".repeat(40),
    PAYMENT_PROVIDER: "pawapay",
    PAWAPAY_MODE: "sandbox",
    PAWAPAY_API_TOKEN: "token-value",
    ROUTING_PROVIDER: "fake",
    SMS_PROVIDER: "disabled",
    STAFF_AUTH_PROVIDER: "supabase",
    NEXT_PUBLIC_SUPABASE_URL: "https://ref.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
    SUPABASE_SECRET_KEY: "sb_secret_x",
    MEDIA_STORAGE: "supabase",
    SITE_GATE: "on",
    SITE_ACCESS_CODE_HASH: HASH,
    HOLDING_HOSTS: "beautyboxmarket.com,www.beautyboxmarket.com",
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

describe("staging configuration", () => {
  it("accepts the documented staging settings", () => {
    staging();
    expect(problems()).toBe("");
  });

  it("refuses what cannot work on serverless hosting or without the local simulators", () => {
    staging({ MEDIA_STORAGE: "local" });
    expect(problems()).toMatch(
      /MEDIA_STORAGE: staging needs MEDIA_STORAGE=supabase/,
    );
    staging({ PAYMENT_PROVIDER: "fake" });
    expect(problems()).toMatch(
      /PAYMENT_PROVIDER: staging uses the pawaPay sandbox/,
    );
    staging({ SMS_PROVIDER: "fake" });
    expect(problems()).toMatch(
      /SMS_PROVIDER: staging uses SMS_PROVIDER=disabled/,
    );
  });

  it("accepts server-key Google configuration with coverage still gated; refuses unbuilt SMS", () => {
    staging({ ROUTING_PROVIDER: "google", GOOGLE_ROUTES_API_KEY: "k" });
    expect(problems()).toBe("");
    expect(serverEnv().GOOGLE_TWO_WHEELER_COVERAGE_APPROVED).toBe(false);
    staging({ ROUTING_PROVIDER: "google", GOOGLE_ROUTES_API_KEY: "" });
    expect(problems()).toMatch(/GOOGLE_ROUTES_API_KEY: required/);
    staging({ SMS_PROVIDER: "africastalking" });
    expect(problems()).toMatch(
      /SMS_PROVIDER: Africa's Talking SMS is not implemented/,
    );
  });

  it("reaches a hosted database over TLS, with the certificate checked when verifying", () => {
    staging({ DATABASE_SSL: "off" });
    expect(problems()).toMatch(
      /DATABASE_SSL: a hosted database must be reached over TLS/,
    );
    staging({ DATABASE_SSL_CA: "" });
    expect(problems()).toMatch(
      /DATABASE_SSL_CA: required when DATABASE_SSL=verify/,
    );
    staging({ DATABASE_SSL: "require", DATABASE_SSL_CA: "" });
    expect(problems()).toBe("");
    staging({ DATABASE_URL: "postgres://u:p@h:6543/postgres?sslmode=require" });
    expect(problems()).toMatch(/DATABASE_URL: remove sslmode/);
  });
});

describe("pre-launch wall and launch list settings", () => {
  it("needs the code's verifier when the wall is on, in the generated format only", () => {
    staging({ SITE_ACCESS_CODE_HASH: "" });
    expect(problems()).toMatch(
      /SITE_ACCESS_CODE_HASH: required when SITE_GATE=on/,
    );
    staging({ SITE_ACCESS_CODE_HASH: "my-plain-code" });
    expect(problems()).toMatch(
      /SITE_ACCESS_CODE_HASH: must be the output of scripts\/ops\/site-access-code.ts/,
    );
    expect(problems()).not.toContain("my-plain-code");
  });

  it("never holds the shop's own host, and needs a contact before the list opens", () => {
    staging({
      HOLDING_HOSTS: "beautyboxmarket.com,staging.beautyboxmarket.com",
    });
    expect(problems()).toMatch(
      /HOLDING_HOSTS: must not include the APP_ORIGIN host/,
    );
    for (const bad of [
      "beautyboxmarket.com.",
      "beautyboxmarket..com",
      "beautyboxmarket.com,",
      "BeautyBoxMarket.com",
      "beautyboxmarket.com, www.beautyboxmarket.com",
    ]) {
      staging({ HOLDING_HOSTS: bad });
      expect(problems(), bad).toMatch(
        /HOLDING_HOSTS: comma-separated lower-case host names/,
      );
    }
    staging({ LAUNCH_LIST: "open" });
    expect(problems()).toMatch(
      /LAUNCH_LIST_CONTACT_EMAIL: required when LAUNCH_LIST=open/,
    );
    staging({
      LAUNCH_LIST: "open",
      LAUNCH_LIST_CONTACT_EMAIL: "hello@beautyboxmarket.com",
    });
    expect(problems()).toBe("");
  });
});

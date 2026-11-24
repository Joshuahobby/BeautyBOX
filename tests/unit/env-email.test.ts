import { afterEach, describe, expect, it } from "vitest";
import { resetServerEnvForTests, serverEnv } from "@/server/env";

const saved = { ...process.env };
afterEach(() => {
  for (const name of Object.keys(process.env))
    if (!(name in saved)) delete process.env[name];
  Object.assign(process.env, saved);
  resetServerEnvForTests();
});
function setup(extra: Record<string, string> = {}) {
  for (const name of Object.keys(process.env))
    if (
      /^(EMAIL_|RESEND_|AFRICASTALKING_|NEXT_PUBLIC_|GOOGLE_|SMS_|STAFF_|SITE_|HOLDING_|LAUNCH_|PAWAPAY_)/.test(
        name,
      )
    )
      delete process.env[name];
  Object.assign(process.env, {
    APP_ENV: "test",
    APP_ORIGIN: "http://localhost:3100",
    DATABASE_URL: "postgres://local/test",
    DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
    TOKEN_HASH_SECRET: "t".repeat(40),
    WORKER_SECRET: "w".repeat(40),
    PAYMENT_PROVIDER: "fake",
    ROUTING_PROVIDER: "fake",
    SMS_PROVIDER: "disabled",
    ...extra,
  });
  resetServerEnvForTests();
}

describe("order e-mail configuration (DR-059)", () => {
  it("is off by default, with the BeautyBOX sender", () => {
    setup();
    expect(serverEnv().EMAIL_PROVIDER).toBe("disabled");
    expect(serverEnv().EMAIL_FROM).toBe(
      "BeautyBOX <orders@beautyboxmarket.com>",
    );
  });

  it("requires a key for Resend", () => {
    setup({ EMAIL_PROVIDER: "resend" });
    expect(() => serverEnv()).toThrow("RESEND_API_KEY");
    setup({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test_key_123456" });
    expect(serverEnv().EMAIL_PROVIDER).toBe("resend");
  });

  it("rejects a malformed sender", () => {
    setup({ EMAIL_FROM: "BeautyBOX <not-an-address>" });
    expect(() => serverEnv()).toThrow("EMAIL_FROM");
  });
});

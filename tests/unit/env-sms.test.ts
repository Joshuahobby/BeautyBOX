import { afterEach, describe, expect, it } from "vitest";
import {
  publicSecretProblems,
  resetServerEnvForTests,
  serverEnv,
} from "@/server/env";
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
      /^(AFRICASTALKING_|NEXT_PUBLIC_|GOOGLE_|SMS_|STAFF_|SITE_|HOLDING_|LAUNCH_|PAWAPAY_)/.test(
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
    SMS_PROVIDER: "africastalking",
    ...extra,
  });
  resetServerEnvForTests();
}
describe("private SMS configuration", () => {
  it("selects the adapter without credentials while sending is disabled by default", () => {
    setup();
    expect(serverEnv().AFRICASTALKING_SEND_ENABLED).toBe(false);
  });
  it("requires private credentials and sender when explicitly enabled", () => {
    setup({ AFRICASTALKING_SEND_ENABLED: "true" });
    expect(() => serverEnv()).toThrow("AFRICASTALKING_API_KEY");
  });
  it.each(["local", "test", "staging"])(
    "refuses live mode in %s even when sending is disabled",
    (env) => {
      setup({ APP_ENV: env, AFRICASTALKING_MODE: "live" });
      expect(() => serverEnv()).toThrow(
        "live mode requires APP_ENV=production",
      );
    },
  );
  it("requires sandbox username for sandbox mode and never exposes a public API key", () => {
    setup({
      AFRICASTALKING_SEND_ENABLED: "true",
      AFRICASTALKING_USERNAME: "live-account",
      AFRICASTALKING_API_KEY: "private-key",
      AFRICASTALKING_SENDER_ID: "BBTEST",
    });
    expect(() => serverEnv()).toThrow(
      "sandbox mode requires the sandbox username",
    );
    expect(
      publicSecretProblems({
        NEXT_PUBLIC_AFRICASTALKING_API_KEY: "private-key",
      }).join(" "),
    ).not.toContain("private-key");
    expect(
      publicSecretProblems({
        NEXT_PUBLIC_AFRICASTALKING_API_KEY: "private-key",
      }),
    ).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import { publicSecretProblems } from "@/server/env";

// A NEXT_PUBLIC_ variable is built into browser code wherever it is referenced, so the
// server refuses to start if one holds a secret (found while checking the dev setup).
describe("secrets never use the NEXT_PUBLIC_ prefix", () => {
  const jwt = (payload: object) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;

  it("accepts the public Supabase settings and server-only secrets", () => {
    expect(
      publicSecretProblems({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc123",
        NEXT_PUBLIC_LEGACY_ANON: jwt({ role: "anon" }),
        SUPABASE_SECRET_KEY: "sb_secret_abc123",
        WORKER_SECRET: "x".repeat(40),
      }),
    ).toEqual([]);
  });

  it("refuses a secret-looking name, a secret-format value or a service-role key under NEXT_PUBLIC_", () => {
    const problems = publicSecretProblems({
      NEXT_PUBLIC_SUPABASE_SECRET_KEY: "anything",
      NEXT_PUBLIC_KEY: "sb_secret_abc123",
      NEXT_PUBLIC_OLD_KEY: jwt({ role: "service_role" }),
      NEXT_PUBLIC_DB_PASSWORD: "pw",
    });
    expect(problems).toHaveLength(4);
    expect(problems.join(" ")).not.toContain("sb_secret_abc123");
    expect(problems.join(" ")).not.toContain("service_role");
  });
});

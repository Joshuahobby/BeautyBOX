import { afterEach, describe, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({ mode: "test" }));
vi.mock("@/server/env", () => ({ serverEnv: () => ({ APP_ENV: env.mode }) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
import { testFeedback } from "@/server/test-feedback";
afterEach(() => {
  env.mode = "test";
});
describe("TEST-only read feedback probes", () => {
  it.each(["local", "staging", "production"])(
    "is unavailable in %s before reading probe parameters",
    async (mode) => {
      env.mode = mode;
      await expect(
        testFeedback(Promise.resolve({ fail: "1", delay: "5000" })),
      ).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    },
  );
  it("allows bounded TEST reads and deliberate TEST read failures", async () => {
    await expect(testFeedback(Promise.resolve({}))).resolves.toBeUndefined();
    await expect(testFeedback(Promise.resolve({ fail: "1" }))).rejects.toThrow(
      "TEST read failure",
    );
  });
});

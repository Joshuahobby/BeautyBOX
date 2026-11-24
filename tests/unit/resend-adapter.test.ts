import { describe, expect, it, vi } from "vitest";
import { ResendEmailAdapter, RESEND_ENDPOINT } from "@/adapters/email/resend";

// DR-059: every provider call is mocked; nothing is sent.
const message = {
  messageIntentId: "intent-1",
  idempotencyKey: "intent-1:0",
  to: "buyer@example.com",
  subject: "Order BB-TEST confirmed - BeautyBOX",
  text: "Private https://example.test/order-access#token=never-log",
  html: "<p>Private</p>",
};
const config = {
  apiKey: "re_private_test_key",
  from: "BeautyBOX <orders@beautyboxmarket.com>",
  replyTo: "care@beautyboxmarket.com",
};
const transport = (value: unknown, status = 200) =>
  vi.fn<typeof fetch>(
    async () =>
      new Response(typeof value === "string" ? value : JSON.stringify(value), {
        status,
      }),
  );

describe("Resend transport (all provider calls mocked)", () => {
  it("posts one recipient to the fixed endpoint with the key only in the header", async () => {
    const send = transport({ id: "re-msg-01" });
    expect(
      await new ResendEmailAdapter(config, send).sendTransactional(message),
    ).toEqual({ kind: "ACCEPTED", providerMessageId: "re-msg-01" });
    const [url, init] = send.mock.calls[0]!;
    expect(url).toBe(RESEND_ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_private_test_key");
    expect(headers["Idempotency-Key"]).toBe("intent-1:0");
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      from: config.from,
      to: ["buyer@example.com"],
      subject: message.subject,
      text: message.text,
      html: message.html,
      reply_to: "care@beautyboxmarket.com",
    });
    expect(String(init?.body)).not.toContain("re_private_test_key");
  });

  it.each([400, 401, 403, 404, 422, 429])(
    "treats HTTP %s as definitely not sent",
    async (status) => {
      const result = await new ResendEmailAdapter(
        config,
        transport({ message: "x" }, status),
      ).sendTransactional(message);
      expect(result.kind).toBe("FAILED");
    },
  );

  it.each([409, 500, 502, 503])(
    "treats HTTP %s as possibly sent (never resent)",
    async (status) => {
      const result = await new ResendEmailAdapter(
        config,
        transport({ message: "x" }, status),
      ).sendTransactional(message);
      expect(result.kind).toBe("UNKNOWN");
    },
  );

  it("treats a lost response or timeout as possibly sent", async () => {
    const send = vi.fn<typeof fetch>(async () => {
      throw new DOMException("timeout", "TimeoutError");
    });
    expect(
      await new ResendEmailAdapter(config, send).sendTransactional(message),
    ).toEqual({ kind: "UNKNOWN", reason: "EMAIL_NO_RESPONSE" });
  });

  it("caps the response it reads and keeps only a well-formed id", async () => {
    const big = await new ResendEmailAdapter(
      config,
      transport("x".repeat(70 * 1024)),
    ).sendTransactional(message);
    expect(big).toEqual({
      kind: "UNKNOWN",
      reason: "EMAIL_RESPONSE_TOO_LARGE",
    });
    const odd = await new ResendEmailAdapter(
      config,
      transport({ id: "<script>" }),
    ).sendTransactional(message);
    expect(odd).toEqual({ kind: "ACCEPTED", providerMessageId: null });
  });

  it("refuses to call the provider without a key or with a bad recipient", async () => {
    const send = transport({ id: "x" });
    expect(
      await new ResendEmailAdapter(
        { ...config, apiKey: "" },
        send,
      ).sendTransactional(message),
    ).toEqual({ kind: "FAILED", code: "EMAIL_CONFIGURATION" });
    expect(
      await new ResendEmailAdapter(config, send).sendTransactional({
        ...message,
        to: "not an address",
      }),
    ).toEqual({ kind: "FAILED", code: "EMAIL_INPUT" });
    expect(send).not.toHaveBeenCalled();
  });
});

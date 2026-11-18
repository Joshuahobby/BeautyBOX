import { describe, expect, it, vi } from "vitest";
import {
  AfricasTalkingSmsAdapter,
  AFRICASTALKING_ENDPOINTS,
  type AfricasTalkingConfig,
} from "@/adapters/sms/africastalking";
const input = {
  messageIntentId: "test-intent",
  recipientE164: "+250788555111",
  text: "Private https://example.test/order-access?token=never-log",
};
const config: AfricasTalkingConfig = {
  sendEnabled: true,
  mode: "sandbox",
  appEnv: "test",
  username: "sandbox",
  apiKey: "private-test-key",
  senderId: "BBTEST",
};
const answer = (statusCode: unknown = 101, number = input.recipientE164) => ({
  SMSMessageData: {
    Recipients: [{ number, statusCode, messageId: "AT-test-01" }],
  },
});
const transport = (value: unknown, status = 201) =>
  vi.fn<typeof fetch>(
    async () =>
      new Response(typeof value === "string" ? value : JSON.stringify(value), {
        status,
      }),
  );

describe("Africa's Talking transport (all provider calls mocked)", () => {
  it("defaults to disabled and refuses non-production live sends", async () => {
    const send = transport(answer());
    expect(
      await new AfricasTalkingSmsAdapter(
        { ...config, sendEnabled: undefined },
        send,
      ).sendTransactional(input),
    ).toEqual({ kind: "FAILED", code: "SMS_DISABLED" });
    expect(
      await new AfricasTalkingSmsAdapter(
        { ...config, mode: "live" },
        send,
      ).sendTransactional(input),
    ).toEqual({ kind: "FAILED", code: "SMS_CONFIGURATION" });
    expect(send).not.toHaveBeenCalled();
  });
  it.each([100, 101, 102, "101"])(
    "accepts exact recipient status %s, using the fixed endpoint and private header",
    async (code) => {
      const send = transport(answer(code));
      expect(
        await new AfricasTalkingSmsAdapter(config, send).sendTransactional(
          input,
        ),
      ).toEqual({ kind: "ACCEPTED", providerMessageId: "AT-test-01" });
      expect(send).toHaveBeenCalledTimes(1);
      const [url, init] = send.mock.calls[0]!;
      expect(url).toBe(AFRICASTALKING_ENDPOINTS.sandbox);
      expect(init).toMatchObject({
        method: "POST",
        redirect: "error",
        headers: { apiKey: config.apiKey, Accept: "application/json" },
      });
      expect(
        Object.fromEntries(new URLSearchParams(String(init?.body))),
      ).toMatchObject({
        username: "sandbox",
        to: input.recipientE164,
        message: input.text,
        from: "BBTEST",
      });
    },
  );
  it("uses only the live official endpoint for an explicitly enabled production account", async () => {
    const send = transport(answer());
    await new AfricasTalkingSmsAdapter(
      {
        ...config,
        appEnv: "production",
        mode: "live",
        username: "approved-account",
      },
      send,
    ).sendTransactional(input);
    expect(send.mock.calls[0]?.[0]).toBe(AFRICASTALKING_ENDPOINTS.live);
  });
  it.each([402, 403, 404, 405, 406, 407, 409, 502])(
    "classifies explicit recipient rejection %s",
    async (code) => {
      const send = transport(answer(code));
      expect(
        (
          await new AfricasTalkingSmsAdapter(config, send).sendTransactional(
            input,
          )
        ).kind,
      ).toBe("FAILED");
      expect(send).toHaveBeenCalledTimes(1);
    },
  );
  it.each([401, 500, 501, 999, null, "missing"])(
    "leaves ambiguous recipient status %s unknown",
    async (code) => {
      expect(
        (
          await new AfricasTalkingSmsAdapter(
            config,
            transport(answer(code)),
          ).sendTransactional(input)
        ).kind,
      ).toBe("UNKNOWN");
    },
  );
  it.each([
    answer(101, "+250788555112"),
    answer(101, "junk250788555111"),
    { SMSMessageData: { Recipients: [] } },
    { SMSMessageData: { Recipients: [answer(), answer()] } },
    "<html>private-test-key never-log</html>",
    "x".repeat(65 * 1024),
  ])(
    "never accepts a mismatched, missing, malformed or oversized answer",
    async (value) => {
      const result = await new AfricasTalkingSmsAdapter(
        config,
        transport(value),
      ).sendTransactional(input);
      expect(result.kind).toBe("UNKNOWN");
      expect(JSON.stringify(result)).not.toMatch(
        /private-test-key|never-log|https:/,
      );
    },
  );
  it.each([400, 401, 403, 429])(
    "allows bounded outbox retry after definite HTTP refusal %s",
    async (status) => {
      expect(
        (
          await new AfricasTalkingSmsAdapter(
            config,
            transport("private provider body", status),
          ).sendTransactional(input)
        ).kind,
      ).toBe("FAILED");
    },
  );
  it.each([408, 500, 502, 503])("keeps HTTP %s unknown", async (status) => {
    expect(
      (
        await new AfricasTalkingSmsAdapter(
          config,
          transport(answer(), status),
        ).sendTransactional(input)
      ).kind,
    ).toBe("UNKNOWN");
  });
  it("cancels a streamed response at 64 KiB and never retries", async () => {
    const cancel = vi.fn();
    let pulls = 0;
    const stream = new ReadableStream(
      {
        pull(controller) {
          pulls++;
          controller.enqueue(new Uint8Array(20 * 1024));
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const send = vi.fn<typeof fetch>(async () => new Response(stream));
    expect(
      await new AfricasTalkingSmsAdapter(config, send).sendTransactional(input),
    ).toEqual({ kind: "UNKNOWN", reason: "SMS_RESPONSE_TOO_LARGE" });
    expect(pulls).toBe(4);
    expect(cancel).toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("times out a response without automatic retries or exposing its exception", async () => {
    const send = vi.fn<typeof fetch>(
      async (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new Error(input.text + config.apiKey)),
          ),
        ),
    );
    const keepAlive = setTimeout(() => {}, 100);
    try {
      expect(
        await new AfricasTalkingSmsAdapter(config, send, 10).sendTransactional(
          input,
        ),
      ).toEqual({ kind: "UNKNOWN", reason: "SMS_RESPONSE_UNCONFIRMED" });
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      clearTimeout(keepAlive);
    }
  });
});

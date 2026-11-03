import { describe, expect, it } from "vitest";
import { AFRICASTALKING_BASE_URLS, AfricasTalkingSmsAdapter, africasTalkingBaseUrl } from "@/adapters/sms/africastalking";

// The Africa's Talking SMS adapter (I11, DR-048) against simulated answers in the documented
// shapes ("Bulk (legacy)" endpoint). DR-026: FAILED only when Africa's Talking said the message
// was not sent; anything that may have gone out is UNKNOWN, so it is never sent twice.
// Nothing here talks to Africa's Talking.

const API_KEY = "atsk_test_key_never_echoed_0123456789abcdef";
const TO = "+250788123456";

type Seen = { url: string; method: string; headers: Headers; body: URLSearchParams };

function simulated(answer: { status?: number; body?: unknown; text?: string } | (() => never | Promise<never>)) {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers), body: new URLSearchParams(String(init?.body ?? "")) });
    if (typeof answer === "function") return answer();
    const text = answer.text ?? JSON.stringify(answer.body ?? {});
    return new Response(text, { status: answer.status ?? 201, headers: { "Content-Type": answer.text ? "text/plain" : "application/json" } });
  }) as typeof fetch;
  return { fetchImpl, seen };
}

const recipient = (statusCode: number, extra: Record<string, unknown> = {}) => ({
  SMSMessageData: {
    Message: statusCode < 200 ? "Sent to 1/1 Total Cost: RWF 15.0000" : "Sent to 0/1 Total Cost: 0",
    Recipients: [{ statusCode, number: TO, status: statusCode < 200 ? "Success" : "Failed", cost: statusCode < 200 ? "RWF 15.0000" : "0", messageId: statusCode < 200 ? "ATXid_5f2c0b8e1c6a4d0e9b7a1f3c2d4e6f80" : "None", ...extra }],
  },
});

function adapter(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof AfricasTalkingSmsAdapter>[0]> = {}) {
  return new AfricasTalkingSmsAdapter({ username: "sandbox", apiKey: API_KEY, fetchImpl, ...extra });
}

const send = (a: AfricasTalkingSmsAdapter, recipientE164 = TO) =>
  a.sendTransactional({ messageIntentId: "7d1d8f0e-3f7a-4a51-9a5e-8a4d2c1b0f9e", recipientE164, text: "BeautyBOX: Payment received for order BB-J2JS-KAWB, RWF 5,100." });

describe("request", () => {
  it("posts the documented form to the sandbox for username sandbox, with the key only in the apiKey header", async () => {
    const { fetchImpl, seen } = simulated({ body: recipient(101) });
    expect(await send(adapter(fetchImpl))).toEqual({ kind: "ACCEPTED", providerMessageId: "ATXid_5f2c0b8e1c6a4d0e9b7a1f3c2d4e6f80" });
    const request = seen[0]!;
    expect(request.url).toBe("https://api.sandbox.africastalking.com/version1/messaging");
    expect(request.method).toBe("POST");
    expect(request.headers.get("apiKey")).toBe(API_KEY);
    expect(request.headers.get("accept")).toBe("application/json");
    expect(request.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(request.body)).toEqual({
      username: "sandbox",
      to: TO,
      message: "BeautyBOX: Payment received for order BB-J2JS-KAWB, RWF 5,100.",
      bulkSMSMode: "1",
    });
    expect(request.url).not.toContain(API_KEY);
  });

  it("uses the live address for any other username, and sends the sender ID when one is set", async () => {
    expect(africasTalkingBaseUrl("sandbox")).toBe(AFRICASTALKING_BASE_URLS.sandbox);
    expect(africasTalkingBaseUrl("beautybox")).toBe(AFRICASTALKING_BASE_URLS.live);
    const { fetchImpl, seen } = simulated({ body: recipient(101) });
    await send(adapter(fetchImpl, { username: "beautybox", senderId: "BeautyBOX" }));
    expect(seen[0]!.url).toBe("https://api.africastalking.com/version1/messaging");
    expect(seen[0]!.body.get("from")).toBe("BeautyBOX");
  });

  it("refuses a malformed number or an empty message without calling Africa's Talking", async () => {
    const { fetchImpl, seen } = simulated({ body: recipient(101) });
    expect(await send(adapter(fetchImpl), "0788123456")).toEqual({ kind: "FAILED", code: "INVALID_RECIPIENT" });
    expect(await adapter(fetchImpl).sendTransactional({ messageIntentId: "x", recipientE164: TO, text: "  " })).toEqual({ kind: "FAILED", code: "EMPTY_MESSAGE" });
    expect(seen).toHaveLength(0);
  });
});

describe("answers about the recipient", () => {
  it("treats Processed, Sent and Queued as accepted (not delivered)", async () => {
    for (const code of [100, 101, 102]) {
      expect((await send(adapter(simulated({ body: recipient(code) }).fetchImpl))).kind).toBe("ACCEPTED");
    }
  });

  it("reads each documented refusal as definitely not sent", async () => {
    const expected: Record<number, string> = {
      402: "INVALID_SENDER_ID",
      403: "INVALID_PHONE_NUMBER",
      404: "UNSUPPORTED_NUMBER_TYPE",
      405: "INSUFFICIENT_BALANCE",
      406: "USER_IN_BLACKLIST",
      407: "COULD_NOT_ROUTE",
      409: "DO_NOT_DISTURB_REJECTION",
      502: "REJECTED_BY_GATEWAY",
    };
    for (const [code, name] of Object.entries(expected)) {
      expect(await send(adapter(simulated({ body: recipient(Number(code)) }).fetchImpl))).toEqual({ kind: "FAILED", code: name });
    }
  });

  it("treats RiskHold, InternalServerError, GatewayError and new codes as unknown, keeping the message id", async () => {
    for (const code of [401, 500, 501, 999]) {
      const result = await send(adapter(simulated({ body: recipient(code, { messageId: "ATXid_held" }) }).fetchImpl));
      expect(result).toEqual({ kind: "UNKNOWN", reason: `recipient status ${code}`, providerMessageId: "ATXid_held" });
    }
  });

  it("never applies an answer about another number or several numbers", async () => {
    expect(await send(adapter(simulated({ body: recipient(101, { number: "+250788999999" }) }).fetchImpl))).toMatchObject({ kind: "UNKNOWN", reason: "answer is for another number" });
    const two = { SMSMessageData: { Message: "Sent to 2/2", Recipients: [recipient(101).SMSMessageData.Recipients[0], recipient(101).SMSMessageData.Recipients[0]] } };
    expect(await send(adapter(simulated({ body: two }).fetchImpl))).toMatchObject({ kind: "UNKNOWN", reason: "answer lists several recipients" });
  });

  it("reads a refusal named in the summary when no recipient comes back", async () => {
    const summary = (Message: string) => ({ SMSMessageData: { Message, Recipients: [] } });
    expect(await send(adapter(simulated({ body: summary("InvalidSenderId") }).fetchImpl))).toEqual({ kind: "FAILED", code: "INVALID_SENDER_ID" });
    expect(await send(adapter(simulated({ body: summary("Sent to 0/1 Total Cost: 0") }).fetchImpl))).toEqual({ kind: "FAILED", code: "NOT_SENT" });
    expect(await send(adapter(simulated({ body: summary("Something new") }).fetchImpl))).toMatchObject({ kind: "UNKNOWN" });
  });
});

describe("answers about the request", () => {
  it("treats a refused key, rate limiting and a plain-text refusal as definitely not sent", async () => {
    expect(await send(adapter(simulated({ status: 401, text: "The supplied authentication is invalid" }).fetchImpl))).toEqual({ kind: "FAILED", code: "AUTHENTICATION" });
    expect(await send(adapter(simulated({ status: 429, text: "Too many requests" }).fetchImpl))).toEqual({ kind: "FAILED", code: "RATE_LIMITED" });
    expect(await send(adapter(simulated({ status: 400, text: "Invalid Sender Id" }).fetchImpl))).toEqual({ kind: "FAILED", code: "INVALID_SENDER_ID" });
    expect(await send(adapter(simulated({ status: 400, text: "Invalid phone number: 0788" }).fetchImpl))).toEqual({ kind: "FAILED", code: "INVALID_PHONE_NUMBER" });
    expect(await send(adapter(simulated({ status: 400, text: "Request is missing required form field" }).fetchImpl))).toEqual({ kind: "FAILED", code: "REQUEST_REFUSED" });
  });

  it("treats HTTP 5xx, an unreadable success and an oversized answer as unknown", async () => {
    for (const status of [500, 502, 503, 504]) {
      expect(await send(adapter(simulated({ status, text: "upstream error" }).fetchImpl))).toEqual({ kind: "UNKNOWN", reason: `http ${status}` });
    }
    expect(await send(adapter(simulated({ status: 201, text: "<html>ok</html>" }).fetchImpl))).toEqual({ kind: "UNKNOWN", reason: "unreadable answer" });
    expect(await send(adapter(simulated({ status: 201, text: "x".repeat(70 * 1024) }).fetchImpl))).toEqual({ kind: "UNKNOWN", reason: "answer too large" });
  });

  it("treats a network error and a timeout as unknown, without echoing the request or key", async () => {
    const refused = simulated(() => {
      throw new TypeError(`fetch failed for ${API_KEY}`);
    });
    expect(await send(adapter(refused.fetchImpl))).toEqual({ kind: "UNKNOWN", reason: "network: TypeError" });

    const slow = (async (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))) as typeof fetch;
    const result = await send(adapter(slow, { timeoutMs: 50 }));
    expect(result).toEqual({ kind: "UNKNOWN", reason: "network: TimeoutError" });
    expect(JSON.stringify(result)).not.toContain(API_KEY);
  });
});

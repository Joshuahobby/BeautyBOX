import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { setAdaptersForTests } from "@/adapters/registry";
import { AfricasTalkingSmsAdapter } from "@/adapters/sms/africastalking";
import { smsLength } from "@/adapters/sms/gsm7";
import { renderSms } from "@/modules/notifications/templates";
import { addToCart, drainJobs, newCustomer, pay, readyCheckout, resetDatabase, seedShop, settleAndDrain, type Shop } from "./harness";

// DR-048: the Africa's Talking adapter, and the app's order confirmation through it, against the
// REAL Africa's Talking sandbox. Opt-in, because it needs the network and the sandbox API key:
//   RUN_AFRICASTALKING_SANDBOX_TESTS=1 npx vitest run --project integration tests/integration/africastalking-sandbox.test.ts
// The key comes from .env.local (never printed), and only AFRICASTALKING_USERNAME=sandbox is
// accepted. Sandbox messages reach only Africa's Talking's simulator, never a phone, and cost nothing.

function localEnv(): Record<string, string> {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#")) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const enabled = process.env.RUN_AFRICASTALKING_SANDBOX_TESTS === "1";
const env = enabled ? localEnv() : {};
if (enabled && (env.AFRICASTALKING_USERNAME !== "sandbox" || !env.AFRICASTALKING_API_KEY)) {
  throw new Error("The Africa's Talking sandbox tests run only with AFRICASTALKING_USERNAME=sandbox and the sandbox API key in .env.local.");
}
const SLOW = 60_000;
// Synthetic Rwanda numbers: the sandbox delivers only to its simulator.
const TEST_NUMBER = "+250788000101";

describe.skipIf(!enabled)("SMS through the real Africa's Talking sandbox", () => {
  const sandbox = (apiKey = env.AFRICASTALKING_API_KEY!) =>
    new AfricasTalkingSmsAdapter({ username: "sandbox", apiKey, senderId: env.AFRICASTALKING_SENDER_ID || undefined });
  let shop: Shop;

  beforeEach(async () => {
    await resetDatabase();
    shop = await seedShop();
  });

  it(
    "accepts a one-part order confirmation as the app renders it, and returns a message id",
    async () => {
      const text = renderSms("ORDER_CONFIRMED", {
        reference: "BB-TEST-SMS1",
        amount: "RWF 29,100",
        link: `https://staging.beautyboxmarket.com/o#${"A".repeat(43)}`,
        contact: "+250788123456",
        brandInSender: false,
      })!;
      expect(smsLength(text)).toMatchObject({ encoding: "GSM-7", parts: 1 });
      const result = await sandbox().sendTransactional({ messageIntentId: "sandbox-1", recipientE164: TEST_NUMBER, text });
      expect(result).toMatchObject({ kind: "ACCEPTED" });
      expect(result.kind === "ACCEPTED" && result.providerMessageId).toMatch(/^ATXid_/);
    },
    SLOW,
  );

  it(
    "refuses a wrong API key, and an invalid number, as definitely not sent",
    async () => {
      const text = "BeautyBOX: sandbox check.";
      expect(await sandbox("atsk_wrong_key_0000000000000000000000000000").sendTransactional({ messageIntentId: "sandbox-2", recipientE164: TEST_NUMBER, text })).toEqual({
        kind: "FAILED",
        code: "AUTHENTICATION",
      });
      expect(await sandbox().sendTransactional({ messageIntentId: "sandbox-3", recipientE164: "+25099999", text })).toMatchObject({ kind: "FAILED" });
    },
    SLOW,
  );

  it(
    "sends the app's order confirmation once, through the job handler, and keeps Africa's Talking's message id",
    async () => {
      setAdaptersForTests({ sms: sandbox() });
      const customer = await newCustomer();
      await addToCart(customer, shop.cleanser.id, 1);
      const ready = await readyCheckout(customer);
      const { attemptId } = await pay(customer, ready);
      await drainJobs();
      await settleAndDrain(6);
      const attempt = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
      const notification = await db().notification.findFirstOrThrow({ where: { orderId: attempt.orderId, event: "ORDER_CONFIRMED" } });
      expect(notification.state).toBe("ACCEPTED");
      expect(notification.providerMessageId).toMatch(/^ATXid_/);
    },
    SLOW,
  );
});

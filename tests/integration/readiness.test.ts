import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { setAdaptersForTests } from "@/adapters/registry";
import { AfricasTalkingSmsAdapter } from "@/adapters/sms/africastalking";
import { POST as postProduct } from "@/app/api/v1/staff/products/route";
import { POST as previewImport } from "@/app/api/v1/staff/inventory/import-previews/route";
import { POST as applyImport } from "@/app/api/v1/staff/inventory/import-previews/[previewId]/apply/route";
import {
  addToCart,
  advanceSeconds,
  drainJobs,
  ledgerMismatches,
  lotTotals,
  newCustomer,
  pay,
  readyCheckout,
  resetDatabase,
  seedShop,
  settleAndDrain,
  type Shop,
} from "./harness";
let shop: Shop;
beforeEach(async () => {
  await resetDatabase();
  shop = await seedShop();
});
const params = <T extends Record<string, string>>(value: T) => ({
  params: Promise.resolve(value),
});
async function staff(role: "OPERATIONS" | "SUPPORT" = "OPERATIONS") {
  const authUserId = randomUUID();
  const member = await db().staffMember.create({
    data: {
      authUserId,
      email: `${authUserId}@example.test`,
      displayName: "Test staff",
      role,
    },
  });
  return { ...member, header: `${authUserId}:aal2` };
}
function request(
  path: string,
  header: string,
  body: BodyInit,
  key = `test-${randomUUID()}`,
) {
  return new NextRequest(`${process.env.APP_ORIGIN}${path}`, {
    method: "POST",
    headers: {
      origin: process.env.APP_ORIGIN!,
      "content-type": "application/json",
      "x-test-staff": header,
      "idempotency-key": key,
    },
    body,
    duplex: "half",
  } as ConstructorParameters<typeof NextRequest>[1]);
}
async function realRow(header: string) {
  const category = await db().category.findUniqueOrThrow({
    where: { slug: "skincare" },
  });
  const created = await postProduct(
    request(
      "/api/v1/staff/products",
      header,
      JSON.stringify({
        title: "Reviewed serum",
        slug: "reviewed-serum",
        brand: "Test",
        categoryId: category.id,
        description: "Reviewed packaging",
        variants: [
          {
            id: null,
            sku: "REAL-01",
            attributes: {},
            priceRwf: 1000,
            isActive: true,
          },
        ],
        media: [],
        contentReviewed: true,
        imageRightsConfirmed: true,
        isSynthetic: false,
      }),
    ),
    params({}),
  );
  expect(created.status).toBe(201);
  return {
    sku: "REAL-01",
    quantityOnHand: 7,
    ownership: "OWNED",
    supplierId: null,
    agreementReference: null,
    batchReference: "SIGNED-COUNT",
    expiryDate: "2028-02-29",
    unitCostRwf: 500,
  };
}

describe("stock import recovery and authenticated body limit", () => {
  it("replays the exact lost apply request once, retaining stock ledger and duplicate protection", async () => {
    const ops = await staff();
    const row = await realRow(ops.header);
    const previewResponse = await previewImport(
      request(
        "/api/v1/staff/inventory/import-previews",
        ops.header,
        JSON.stringify({ rows: [row] }),
      ),
      params({}),
    );
    const preview = await previewResponse.json();
    expect(preview.state).toBe("READY");
    const key = `test-${randomUUID()}`;
    const body = JSON.stringify({
      sourceHash: preview.sourceHash,
      reason: "Signed count",
    });
    const apply = () =>
      applyImport(
        request(
          `/api/v1/staff/inventory/import-previews/${preview.id}/apply`,
          ops.header,
          body,
          key,
        ),
        params({ previewId: preview.id }),
      );
    expect((await apply()).status).toBe(200); // first response lost to the browser
    expect((await (await apply()).json()).state).toBe("APPLIED");
    expect(
      await db().inventoryLot.count({ where: { importPreviewId: preview.id } }),
    ).toBe(1);
    const lot = await db().inventoryLot.findFirstOrThrow({
      where: { importPreviewId: preview.id },
    });
    expect(lot.quantityOnHand).toBe(7);
    expect(
      await db().inventoryMovement.count({
        where: { lotId: lot.id, type: "RECEIPT" },
      }),
    ).toBe(1);
    expect(await ledgerMismatches()).toBe(0);
    const duplicate = await (
      await previewImport(
        request(
          "/api/v1/staff/inventory/import-previews",
          ops.header,
          JSON.stringify({ rows: [row] }),
        ),
        params({}),
      )
    ).json();
    expect(duplicate.state).toBe("INVALID");
  });
  it("rejects normalized impossible dates on the server and preserves the 512 KiB JSON allowance", async () => {
    const ops = await staff();
    const row = await realRow(ops.header);
    const large = " ".repeat(300 * 1024) + JSON.stringify({ rows: [row] });
    const ready = await previewImport(
      request("/api/v1/staff/inventory/import-previews", ops.header, large),
      params({}),
    );
    expect(ready.status).toBe(201);
    expect((await ready.json()).state).toBe("READY");
    const invalid = await previewImport(
      request(
        "/api/v1/staff/inventory/import-previews",
        ops.header,
        JSON.stringify({ rows: [{ ...row, expiryDate: "2028-02-30" }] }),
      ),
      params({}),
    );
    expect((await invalid.json()).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "expiryDate" }),
      ]),
    );
  });
  it("authorizes before consuming a body, and cancels an oversized stream while reading", async () => {
    const support = await staff("SUPPORT");
    let pulls = 0;
    const cancel = vi.fn();
    const stream = () =>
      new ReadableStream(
        {
          pull(controller) {
            pulls++;
            controller.enqueue(new Uint8Array(32 * 1024));
          },
          cancel,
        },
        { highWaterMark: 0 },
      );
    const forbiddenBody = stream();
    expect(
      (
        await previewImport(
          request(
            "/api/v1/staff/inventory/import-previews",
            support.header,
            forbiddenBody,
          ),
          params({}),
        )
      ).status,
    ).toBe(403);
    expect(pulls).toBe(0);
    await forbiddenBody.cancel();
    cancel.mockClear();
    const ops = await staff();
    const response = await previewImport(
      request("/api/v1/staff/inventory/import-previews", ops.header, stream()),
      params({}),
    );
    expect(response.status).toBe(400);
    expect(pulls).toBe(17);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe("Africa's Talking adapter with durable outbox (mocked transport)", () => {
  it.each(["lost", "rejected"])(
    "%s response cannot change payment or stock; unknown is never resent",
    async (fault) => {
      const send = vi.fn<typeof fetch>(async () => {
        if (fault === "lost") throw new Error("private provider response");
        return Response.json(
          {
            SMSMessageData: {
              Recipients: [{ number: "+250788555111", statusCode: 405 }],
            },
          },
          { status: 201 },
        );
      });
      setAdaptersForTests({
        sms: new AfricasTalkingSmsAdapter(
          {
            sendEnabled: true,
            mode: "sandbox",
            appEnv: "test",
            username: "sandbox",
            apiKey: "test-key",
            senderId: "BBTEST",
          },
          send,
        ),
      });
      const customer = await newCustomer();
      await addToCart(customer, shop.cleanser.id, 1);
      const { attemptId } = await pay(customer, await readyCheckout(customer));
      await drainJobs();
      await settleAndDrain(6);
      const attempt = await db().paymentAttempt.findUniqueOrThrow({
        where: { id: attemptId },
      });
      const stock = await lotTotals(shop.cleanser.id);
      for (let i = 0; i < 5; i++) {
        advanceSeconds(700);
        await drainJobs();
      }
      expect(send).toHaveBeenCalledTimes(fault === "lost" ? 1 : 3);
      expect(
        (
          await db().notification.findFirstOrThrow({
            where: { orderId: attempt.orderId },
          })
        ).state,
      ).toBe(fault === "lost" ? "UNKNOWN" : "FAILED");
      expect(
        await db().order.findUniqueOrThrow({ where: { id: attempt.orderId } }),
      ).toMatchObject({ state: "PAID", paymentState: "PAID" });
      expect(await lotTotals(shop.cleanser.id)).toEqual(stock);
      expect(await ledgerMismatches()).toBe(0);
      expect(await db().refund.count()).toBe(0);
    },
  );
});

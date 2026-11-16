import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import { readJson } from "@/server/http/api";

const schema = z.strictObject({ value: z.string() });
const request = (body: string) =>
  new NextRequest("http://localhost/api/v1/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

describe("bounded application JSON input", () => {
  it("enforces byte size before parsing, including multibyte text", async () => {
    const body = JSON.stringify({ value: "界".repeat(6000) });
    expect(body.length).toBeLessThan(16 * 1024);
    await expect(readJson(request(body), schema)).rejects.toMatchObject({
      httpStatus: 400,
      message: "Request body is too large.",
    });
    expect(
      await readJson(request(body), schema, { maxBytes: 128 * 1024 }),
    ).toEqual({ value: "界".repeat(6000) });
  });
  it("cancels oversized chunked input instead of buffering the remaining body", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(17 * 1024)));
      },
      cancel,
    });
    const options = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half" as const,
    };
    await expect(
      readJson(
        new NextRequest("http://localhost/api/v1/test", options),
        schema,
      ),
    ).rejects.toMatchObject({ httpStatus: 400 });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("still rejects malformed JSON and unknown fields with controlled errors", async () => {
    await expect(readJson(request("{"), schema)).rejects.toMatchObject({
      httpStatus: 400,
    });
    await expect(
      readJson(request('{"value":"ok","extra":true}'), schema),
    ).rejects.toMatchObject({ httpStatus: 422 });
    expect(await readJson(request('{"value":"ok"}'), schema)).toEqual({
      value: "ok",
    });
  });
});

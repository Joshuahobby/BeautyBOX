import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { POSTER_FRAME } from "@/design/promo/film";

// The opening film on "Launching soon": the page starts the first play on the poster's frame,
// so the exported poster and the page must agree on which frame that is.

describe("opening film", () => {
  it("exports the poster from the frame the page starts on", () => {
    const promo = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../promo/package.json"), "utf8")) as { scripts: Record<string, string> };
    const frame = /--frame=(\d+)/.exec(promo.scripts["export:poster"] ?? "")?.[1];
    expect(frame, "promo/package.json export:poster --frame").toBe(String(POSTER_FRAME));
  });
});

import { describe, expect, it } from "vitest";
import {
  MAX_STOCK_CSV_BYTES,
  parseStockCsv,
  STOCK_CSV_HEADER,
  StockCsvError,
} from "@/lib/stock-csv";
const header = STOCK_CSV_HEADER.join(",");
const row = "REAL-01,2,OWNED,,,COUNT-1,2028-02-29,1500";
describe("stock CSV intake", () => {
  it("reads BOM, CRLF, commas, escaped quotes and multiline fields", () => {
    const parsed = parseStockCsv(
      `\uFEFF${header}\r\nREAL-01,2,CONSIGNED,,"Signed, \"\"A\"\"\r\ncount",BATCH-1,2028-02-29,0\r\n`,
    );
    expect(parsed[0]).toMatchObject({
      quantityOnHand: 2,
      ownership: "CONSIGNED",
      agreementReference: 'Signed, "A"\r\ncount',
      unitCostRwf: 0,
    });
  });
  it("accepts exactly 1,000 rows and rejects 1,001 or oversized UTF-8", () => {
    expect(
      parseStockCsv(`${header}\n${Array(1000).fill(row).join("\n")}`),
    ).toHaveLength(1000);
    expect(() =>
      parseStockCsv(`${header}\n${Array(1001).fill(row).join("\n")}`),
    ).toThrow("1,000");
    expect(() =>
      parseStockCsv("é".repeat(MAX_STOCK_CSV_BYTES / 2 + 1)),
    ).toThrow("256 KiB");
  });
  it.each([
    [header, "data row"],
    [header + ",extra\n" + row, "exactly"],
    [header + "\n" + row + ",extra", "8 cells"],
    [header + '\n"unterminated', "Unclosed"],
    [header + '\n"SKU"bad,2,OWNED,,,BATCH,,', "Malformed quote"],
    [header + '\nS"KU,2,OWNED,,,BATCH,,', "Malformed quote"],
    [header + "\n" + row.replace("OWNED", ""), "OWNED or CONSIGNED"],
    [header + "\n" + row.replace(",2,", ",1e3,"), "safe whole number"],
    [
      header + "\n" + row.replace(",2,", ",9007199254740992,"),
      "safe whole number",
    ],
    [header + "\n" + row.replace(",2,", ",-1,"), "safe whole number"],
    [
      header + "\n" + row.replace("2028-02-29", "2027-02-29"),
      "real calendar date",
    ],
    [
      header + "\n" + row.replace("2028-02-29", "2028-04-31"),
      "real calendar date",
    ],
  ])("diagnoses malformed input: %s", (source, message) =>
    expect(() => parseStockCsv(source)).toThrow(message),
  );
  it("reports all invalid fields with CSV record numbers", () => {
    try {
      parseStockCsv(`${header}\n,1.5,,,,,2028-13-01,NaN`);
      throw new Error("expected diagnostics");
    } catch (e) {
      expect(e).toBeInstanceOf(StockCsvError);
      expect((e as StockCsvError).problems.every((p) => p.row === 2)).toBe(
        true,
      );
      expect((e as StockCsvError).problems.length).toBeGreaterThan(3);
    }
  });
});

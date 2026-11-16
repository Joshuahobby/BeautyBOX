import { isCalendarDate } from "./calendar-date";

export const STOCK_CSV_HEADER = [
  "sku",
  "quantityOnHand",
  "ownership",
  "supplierId",
  "agreementReference",
  "batchReference",
  "expiryDate",
  "unitCostRwf",
] as const;
export const MAX_STOCK_CSV_BYTES = 256 * 1024;
export const MAX_STOCK_CSV_ROWS = 1000;
export type StockCsvRow = {
  sku: string;
  quantityOnHand: number;
  ownership: "OWNED" | "CONSIGNED";
  supplierId: string | null;
  agreementReference: string | null;
  batchReference: string;
  expiryDate: string | null;
  unitCostRwf: number | null;
};
export type StockCsvProblem = { row: number; field: string; message: string };
export class StockCsvError extends Error {
  constructor(readonly problems: StockCsvProblem[]) {
    super(
      problems.map((p) => `Row ${p.row}, ${p.field}: ${p.message}`).join("\n"),
    );
  }
}

/** Bounded RFC 4180-style records. Quotes, delimiters and embedded newlines are data. */
export function parseStockCsv(source: string): StockCsvRow[] {
  const fail = (row: number, field: string, message: string): never => {
    throw new StockCsvError([{ row, field, message }]);
  };
  if (new TextEncoder().encode(source).byteLength > MAX_STOCK_CSV_BYTES)
    fail(1, "CSV", "Use a file of 256 KiB or less.");
  const text = source.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let cells: string[] = [],
    cell = "",
    state: "start" | "plain" | "quoted" | "closed" = "start";
  const finishCell = () => {
    cells.push(cell.trim());
    cell = "";
    state = "start";
  };
  const finishRecord = () => {
    finishCell();
    if (cells.some(Boolean) || cells.length > 1) records.push(cells);
    cells = [];
    if (records.length > MAX_STOCK_CSV_ROWS + 1)
      fail(records.length, "CSV", "Use at most 1,000 data rows.");
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (state === "quoted") {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else state = "closed";
      } else cell += char;
      continue;
    }
    if (char === ",") {
      finishCell();
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      finishRecord();
      continue;
    }
    if (char === '"' && state === "start") {
      state = "quoted";
      continue;
    }
    if (char === '"' || state === "closed")
      fail(
        records.length + 1,
        "CSV",
        'Malformed quote. Quote the entire field and escape quotes as "".',
      );
    cell += char;
    state = "plain";
  }
  if (state === "quoted")
    fail(records.length + 1, "CSV", "Unclosed quoted field.");
  if (cell || cells.length || state === "closed") finishRecord();
  const header = records.shift();
  if (
    !header ||
    header.length !== STOCK_CSV_HEADER.length ||
    STOCK_CSV_HEADER.some((name, i) => header[i] !== name)
  )
    fail(1, "header", `Use exactly: ${STOCK_CSV_HEADER.join(",")}`);
  if (!records.length) fail(2, "CSV", "Add at least one data row.");
  const problems: StockCsvProblem[] = [];
  const rows = records.map((record, i): StockCsvRow => {
    const row = i + 2;
    const problem = (field: string, message: string) =>
      problems.push({ row, field, message });
    if (record.length !== STOCK_CSV_HEADER.length)
      problem("CSV", `Expected 8 cells, found ${record.length}.`);
    const value = (index: number) => record[index] ?? "";
    const integer = (index: number, nullable = false) => {
      const raw = value(index);
      if (!raw && nullable) return null;
      const number = Number(raw);
      if (
        !/^\d+$/.test(raw) ||
        !Number.isSafeInteger(number) ||
        (index === 1 && number > 2_147_483_647)
      )
        problem(
          STOCK_CSV_HEADER[index]!,
          "Enter a non-negative, safe whole number (quantity maximum 2,147,483,647).",
        );
      return number;
    };
    if (!value(0) || value(0).length > 64)
      problem("sku", "Enter a SKU of 1–64 characters.");
    if (!["OWNED", "CONSIGNED"].includes(value(2)))
      problem("ownership", "Enter OWNED or CONSIGNED explicitly.");
    if (!value(5) || value(5).length > 80)
      problem("batchReference", "Enter a batch reference of 1–80 characters.");
    if (value(6) && !isCalendarDate(value(6)))
      problem("expiryDate", "Enter a real calendar date as YYYY-MM-DD.");
    return {
      sku: value(0),
      quantityOnHand: integer(1)!,
      ownership: value(2) as StockCsvRow["ownership"],
      supplierId: value(3) || null,
      agreementReference: value(4) || null,
      batchReference: value(5),
      expiryDate: value(6) || null,
      unitCostRwf: integer(7, true),
    };
  });
  if (problems.length) throw new StockCsvError(problems);
  return rows;
}

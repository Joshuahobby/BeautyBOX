# Counted stock CSV

Admin and Operations can import through **Stock → Import counted stock**. Download the header-only template, then upload UTF-8 CSV or paste it. The client permits 256 KiB and 1,000 data records. BOM, CRLF, quoted commas, doubled quotes and embedded newlines work. Empty lines are ignored; diagnostic CSV record numbers include the header (a multiline cell is one record).

Columns, in this order:

```csv
sku,quantityOnHand,ownership,supplierId,agreementReference,batchReference,expiryDate,unitCostRwf
```

Ownership must explicitly be `OWNED` or `CONSIGNED`. Count and optional unit cost are non-negative safe integers; counts fit PostgreSQL's integer range. Expiry is empty or a real Gregorian date in `YYYY-MM-DD`. Consigned stock requires an active supplier UUID and agreement reference. Owned stock has no supplier. SKU and batch identify a new lot; use an adjustment for an existing lot.

Preview validates on the server: existing active SKU, reviewed verified product, supplier, batch duplicates and future expiry. Editing source invalidates the preview. Preview expires after 30 minutes, and apply revalidates stock/catalogue in its transaction with the source hash. The authenticated JSON API retains its separate **512 KiB** limit, enforced while streaming; this is intentionally larger than the CSV limit.

If an apply response is lost, the page locks source and reason and offers **Check import outcome**. Keep the page open. This explicit check reuses the original payload and key; the transaction replays the recorded result, adding stock once. Do not start a fresh preview or invent a second key to resolve an uncertain import. After a full browser reload, review stock/count references with operations before creating another import. Nothing here relaxes publication, expiry, supplier, role or release gates.

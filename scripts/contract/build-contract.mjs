#!/usr/bin/env node
// The original generator required an external v1.0 handoff that is no longer present.
// Use the exact committed v1.1 contract as the immutable baseline for later additions.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const baselinePath = path.join(
  root,
  "docs/api/baseline/API-Contract-v1.1.openapi.json",
);
const baseline = fs.readFileSync(baselinePath);
const expected =
  "6922d9c35452af687e1ce9884dff15495f7a640a47decc33bfe2061909f8f36c";
if (createHash("sha256").update(baseline).digest("hex") !== expected)
  throw new Error("Immutable v1.1 contract baseline changed.");
const contract = JSON.parse(baseline);
// CC-21: additive atomic option replacement. Existing cart responses are unchanged.
const replacement = structuredClone(
  contract.paths["/cart/lines/{variantId}"].delete,
);
replacement.operationId = "replaceCartLine";
replacement.summary =
  "CC-21: atomically replace an item with an option of the same product";
replacement.description =
  "Preserves quantity, merges an existing target line, revalidates stock/price and invalidates editable checkout quotes. Versioned and idempotent; failures leave the original cart intact.";
replacement.requestBody = {
  required: true,
  content: {
    "application/json": {
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["expectedVersion", "replacementVariantId"],
        properties: {
          expectedVersion: {
            type: "integer",
            minimum: 1,
            maximum: 9007199254740991,
          },
          replacementVariantId: { type: "string", format: "uuid" },
        },
      },
    },
  },
};
contract.paths["/cart/lines/{variantId}"].patch = replacement;
// CC-22 (DR-059): the recipient's e-mail address. Optional where a recipient is returned
// (checkouts and orders made before it have none); required when a checkout is updated.
const schemas = contract.components.schemas;
schemas.Recipient.properties.email = {
  type: "string",
  format: "email",
  maxLength: 254,
  description:
    "CC-22: where the order confirmation and private order link are e-mailed. Absent on checkouts and orders made before it was collected.",
};
schemas.RecipientInput = structuredClone(schemas.Recipient);
schemas.RecipientInput.required = [...schemas.Recipient.required, "email"];
schemas.RecipientInput.description =
  "CC-22: the recipient as sent when a checkout is updated; email is required.";
schemas.CheckoutPatch.properties.recipient = {
  $ref: "#/components/schemas/RecipientInput",
};
// CC-24: the customer-messages switch in staff settings. Always returned; optional on
// update, where leaving it out keeps the current value.
schemas.Settings.properties.notificationsEnabled = {
  type: "boolean",
  description:
    "CC-24: send customer order messages (e-mail, or SMS when e-mail is off). Optional on update; left out, the current value is kept.",
};
contract.info.version = "1.2.0";
contract.info.description +=
  "\n\nv1.2.0: CC-21 adds atomic cart option replacement. Existing responses and methods are unchanged." +
  "\n\nCC-22 adds the recipient's e-mail address: returned with checkouts and orders when present, and required when a checkout is updated. CC-24 adds the customer-messages switch to staff settings.";
const output = JSON.stringify(contract, null, 2) + "\n";
const target = path.join(root, "docs/api/API-Contract-v1.2.openapi.json");
if (process.argv.includes("--check")) {
  if (fs.readFileSync(target, "utf8") !== output)
    throw new Error(
      "Contract differs from the pinned baseline; document and generate any additions explicitly.",
    );
  console.log(
    "[contract] v1.2 matches generated additions to the pinned v1.1 baseline",
  );
} else {
  fs.writeFileSync(target, output);
  console.log("[contract] wrote v1.2 from pinned v1.1 baseline");
}

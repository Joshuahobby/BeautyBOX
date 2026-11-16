import {
  configureKigali,
  disconnectDeliveryConfiguration,
} from "@/modules/delivery/configure-kigali";
import { KIGALI_TARIFF } from "@/config/delivery/kigali";

async function main() {
  const args = process.argv.slice(2);
  const config = args
    .find((a) => a.startsWith("--config-file="))
    ?.split("=")[1];
  if (![".env.local", ".env.test"].includes(config ?? ""))
    throw new Error("Use --config-file=.env.local or --config-file=.env.test.");
  process.loadEnvFile(config!);
  const apply = args.includes("--apply");
  const text = args
    .find((a) => a.startsWith("--expected-version="))
    ?.split("=")[1];
  const expectedVersion = text && /^\d+$/.test(text) ? Number(text) : undefined;
  if (apply && (!expectedVersion || !Number.isSafeInteger(expectedVersion)))
    throw new Error(
      "Apply requires --expected-version=N from a fresh preview.",
    );
  const result = await configureKigali({ apply, expectedVersion });
  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "read-only preview",
      ...result,
      tariff: KIGALI_TARIFF,
      releaseGatesChanged: false,
    }),
  );
}

main()
  .catch(() => {
    // No exception text: connection strings or provider details must never reach command output.
    console.error(
      "Kigali configuration was not applied. Check the local/test target and current settings version.",
    );
    process.exitCode = 1;
  })
  .finally(disconnectDeliveryConfiguration);

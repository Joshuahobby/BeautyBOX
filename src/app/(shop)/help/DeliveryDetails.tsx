import type { SettingsVersion } from "@/generated/prisma/client";
import { db } from "@/server/db";

export async function DeliveryDetails({ settings }: { settings: SettingsVersion | null }) {
  if (!settings) return null;
  const location = await db().dispatchLocation.findUnique({
    where: { id: settings.activeLocationId },
    select: { hours: true },
  });
  const hours = location?.hours;
  const dispatchHours = hours && typeof hours === "object" && !Array.isArray(hours)
    && typeof hours.text === "string" ? hours.text.trim() : "";
  return (
    <>
      {dispatchHours && <p>Dispatch hours: {dispatchHours}</p>}
      {settings.deliveryPromise?.trim() && <p>{settings.deliveryPromise}</p>}
    </>
  );
}

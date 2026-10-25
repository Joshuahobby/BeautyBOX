import type { MetadataRoute } from "next";
import { serverEnv } from "@/server/env";

export const dynamic = "force-dynamic";

// Search engines stay out of staging and of anything behind the pre-launch wall (DR-044).
export default function robots(): MetadataRoute.Robots {
  const env = serverEnv();
  const open = env.APP_ENV === "production" && env.SITE_GATE === "off";
  return { rules: open ? { userAgent: "*", allow: "/", disallow: ["/staff", "/api/"] } : { userAgent: "*", disallow: "/" } };
}

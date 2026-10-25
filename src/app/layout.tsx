import type { Metadata, Viewport } from "next";
import { CspNonce } from "@/components/CspNonce";
import { serverEnv } from "@/server/env";
import { manrope } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "BeautyBOX", template: "%s | BeautyBOX" },
  description: "Beauty and personal-care products held at BeautyBOX, delivered from our shop with the full total shown before you pay.",
  robots: serverEnv().APP_ENV === "production" ? undefined : { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#F7F2EC" };

export const dynamic = "force-dynamic";

// Root document only. The storefront chrome lives in app/(shop)/layout.tsx and the
// staff workspace has its own shell under app/staff.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body>
        <CspNonce />
        {children}
      </body>
    </html>
  );
}

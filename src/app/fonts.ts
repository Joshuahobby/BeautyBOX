import localFont from "next/font/local";

// Self-hosted Manrope (SIL OFL 1.1; licence in src/design/fonts/Manrope-OFL.txt),
// subset to launch glyphs and weights 400-700 by scripts/design/build-font.mjs.
// Shared by the root layout and the global error page, which renders its own document.
export const manrope = localFont({
  src: "../design/fonts/Manrope-latin-ext-wght400-700.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-manrope",
  fallback: ["system-ui", "Segoe UI", "Arial", "sans-serif"],
});

// Editorial headings only; self-hosted SIL OFL font. Interface text remains Manrope.
export const editorial = localFont({
  src: "../design/fonts/BodoniModa-latin.woff2",
  weight: "400 900",
  display: "swap",
  variable: "--font-editorial",
  fallback: ["Georgia", "serif"],
});

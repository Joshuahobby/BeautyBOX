import { loadFont } from "@remotion/fonts";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { staticFile } from "remotion";

// Manrope is the only typeface for words in the video (DESIGN.md): the website's own
// self-hosted file (src/design/fonts, the public folder's fonts/), weights 400 to 700.
loadFont({
  family: "Manrope",
  url: staticFile("fonts/Manrope-latin-ext-wght400-700.woff2"),
  weight: "400 700",
});

// The supplied lockup sets its "BeautyBox" wordmark as live SVG text in Inter 700. Loading Inter
// lets that original file render as designed; Inter is never used for any other text.
loadInter("normal", { weights: ["700"], subsets: ["latin"] });

export const MANROPE = "Manrope, system-ui, 'Segoe UI', Arial, sans-serif";

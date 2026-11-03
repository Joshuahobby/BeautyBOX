import { useEffect, useState, type CSSProperties } from "react";
import { Interactive, staticFile, useDelayRender } from "remotion";
import "../fonts";

/**
 * The supplied horizontal lockup (icon + "BeautyBox" wordmark), read from the original file and
 * placed inline so its live wordmark text can use the loaded Inter font. An <img> could only use
 * the system fonts of the machine that renders. The artwork is never edited or retyped: only the
 * root size attributes are set to fill this box, which is uniform scaling. Needs a light background.
 */
const LockupInner = ({ style }: { readonly style?: CSSProperties }) => {
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [handle] = useState(() => delayRender("Loading the BeautyBOX lockup"));
  const [markup, setMarkup] = useState<string | null>(null);

  useEffect(() => {
    // The supplied original (src/design/brand), not the outlined copy the pages use.
    fetch(staticFile("brand/BeautyBox_Platform_Hub_Lockup.svg"))
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Could not load the lockup SVG (HTTP ${response.status})`);
        }
        return response.text();
      })
      .then((text) => {
        const svg = new DOMParser().parseFromString(text, "image/svg+xml").documentElement;
        // Every position in the film is measured against this exact file, so stop the render
        // rather than draw a different one.
        if (svg.nodeName !== "svg" || svg.getAttribute("viewBox") !== "0 0 860 180") {
          throw new Error("The lockup SVG is not the expected 860 x 180 file");
        }
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");
        setMarkup(new XMLSerializer().serializeToString(svg));
      })
      .catch((error: unknown) => cancelRender(error));
  }, [cancelRender]);

  // Release the frame only after the markup is in the DOM.
  useEffect(() => {
    if (markup) {
      continueRender(handle);
    }
  }, [markup, handle, continueRender]);

  return (
    <div
      style={{ aspectRatio: "860 / 180", ...style }}
      dangerouslySetInnerHTML={markup ? { __html: markup } : undefined}
    />
  );
};

export const Lockup = Interactive.create({
  Component: LockupInner,
  componentName: "Lockup",
});

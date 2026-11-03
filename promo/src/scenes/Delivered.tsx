import { Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { clipToEdges } from "../brand/clip";

/**
 * S3, 112 frames. The coral page from S2. One giant "d" cuts on, holds like a monogram, and
 * pulls back into "delivered / in Kigali.", holds, then the page shuts like a shutter into the
 * gap between the two lines and closes sideways into the coral rule S4 keeps beside its first line.
 */
const DeliveredInner = () => {
  const frame = useCurrentFrame();

  // The "d" holds at 4x for 8 frames, then pulls back to 1x in log space over 24 frames.
  const zoom = interpolate(frame, [10, 34], [0, 1], {
    easing: Easing.bezier(0.45, 0, 0.15, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <>
      {/* The page is the rule at full size, so its clip also clips the words inside it. */}
      <Interactive.Div
        name="Coral page into rule"
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "#D85F58",
          clipPath: clipToEdges(
            interpolate(
              frame,
              [0, 86, 99, 111],
              [
                [0, 1080, 1080, 0],
                [0, 1080, 1080, 0],
                [466, 1080, 480, 0],
                [466, 222, 480, 96],
              ],
              {
                easing: [
                  Easing.linear,
                  Easing.bezier(0.65, 0, 0.35, 1),
                  Easing.bezier(0.65, 0, 0.35, 1),
                ],
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              },
            ),
          ),
        }}
      >
        {/* From frame 97 the closing band holds only thin slivers of the letters' bottoms,
            which read as stray dashes, so the words are gone by then. */}
        {frame >= 2 && frame < 97 ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              // Centred on the measured ink of the "d", so at 4x it sits inside the safe area.
              transformOrigin: "16px 318px",
              scale: String(Math.pow(4, 1 - zoom)),
            }}
          >
            <Interactive.Div
              name="Line 1"
              style={{
                position: "absolute",
                left: 89,
                top: 280,
                fontFamily: "Manrope",
                fontWeight: 700,
                fontSize: 200,
                lineHeight: "200px",
                letterSpacing: "-0.03em",
                color: "#221720",
                whiteSpace: "nowrap",
              }}
            >
              delivered
            </Interactive.Div>
            <Interactive.Div
              name="Line 2"
              style={{
                position: "absolute",
                left: 81,
                top: 480,
                fontFamily: "Manrope",
                fontWeight: 700,
                fontSize: 200,
                lineHeight: "200px",
                letterSpacing: "-0.03em",
                color: "#221720",
                whiteSpace: "nowrap",
              }}
            >
              in Kigali.
            </Interactive.Div>
          </div>
        ) : null}
      </Interactive.Div>
    </>
  );
};

export const Delivered = Interactive.create({
  Component: DeliveredInner,
  componentName: "Delivered",
  layout: "absolute-fill",
  schema: {
    ...Interactive.backgroundSchema,
  },
});

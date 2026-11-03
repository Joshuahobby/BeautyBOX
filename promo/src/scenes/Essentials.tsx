import { Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { clipToEdges } from "../brand/clip";

/**
 * S2, 116 frames. The coral rule draws, "Your beauty / essentials," rises, holds, and leaves
 * upward (the cut falls on the tops of the letters, so no word ever reads misspelt). Then the
 * rule, left alone, stretches across the frame and thickens into the coral page of S3.
 */
const EssentialsInner = () => {
  const frame = useCurrentFrame();

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 240,
          top: 376,
          width: 800,
          height: 152,
          overflow: "hidden",
        }}
      >
        <Interactive.Div
          name="Line 1"
          style={{
            position: "absolute",
            left: 29,
            top: 18,
            fontFamily: "Manrope",
            fontWeight: 600,
            fontSize: 112,
            lineHeight: "112px",
            letterSpacing: "-0.02em",
            color: "#221720",
            whiteSpace: "nowrap",
            translate: interpolate(
              frame,
              [2, 20, 80, 90],
              ["0px 152px", "0px 0px", "0px 0px", "0px -152px"],
              {
                easing: [
                  Easing.bezier(0.16, 1, 0.3, 1),
                  Easing.linear,
                  Easing.bezier(0.7, 0, 0.84, 0),
                ],
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              },
            ),
          }}
        >
          Your beauty
        </Interactive.Div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 240,
          top: 504,
          width: 800,
          height: 190,
          overflow: "hidden",
        }}
      >
        <Interactive.Div
          name="Line 2"
          style={{
            position: "absolute",
            left: 23,
            top: 17,
            fontFamily: "Manrope",
            fontWeight: 700,
            fontSize: 144,
            lineHeight: "144px",
            letterSpacing: "-0.03em",
            color: "#221720",
            whiteSpace: "nowrap",
            translate: interpolate(
              frame,
              [8, 26, 82, 92],
              ["0px 190px", "0px 0px", "0px 0px", "0px -190px"],
              {
                easing: [
                  Easing.bezier(0.16, 1, 0.3, 1),
                  Easing.linear,
                  Easing.bezier(0.7, 0, 0.84, 0),
                ],
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              },
            ),
          }}
        >
          essentials,
        </Interactive.Div>
      </div>

      {/* The rule and the page are one coral plane, clipped to edges [top, right, bottom, left]. */}
      <Interactive.Div
        name="Coral rule into page"
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "#D85F58",
          clipPath: clipToEdges(
            interpolate(
              frame,
              [0, 13, 92, 104, 115],
              [
                [455, 96, 469, 96],
                [455, 222, 469, 96],
                [455, 222, 469, 96],
                [455, 1080, 469, 0],
                [0, 1080, 1080, 0],
              ],
              {
                easing: [
                  Easing.bezier(0.65, 0, 0.35, 1),
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
      />
    </>
  );
};

export const Essentials = Interactive.create({
  Component: EssentialsInner,
  componentName: "Essentials",
  layout: "absolute-fill",
  schema: {
    ...Interactive.backgroundSchema,
  },
});

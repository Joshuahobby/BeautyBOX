import { Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { BIcon } from "../brand/BIcon";
import { Lockup } from "../brand/Lockup";

/**
 * S1, 125 frames. The end card (also the poster and the last frame) holds still for 50 frames,
 * then the B lifts out of the lockup, grows to the centre, holds, and its quarters part like doors.
 */
const BoxOpensInner = () => {
  const frame = useCurrentFrame();

  // The B travels from its place in the lockup to the centre. The scale moves in log space, so
  // every frame grows by the same ratio, and the hub centre follows the same eased curve.
  const travel = interpolate(frame, [63, 87], [0, 1], {
    easing: Easing.bezier(0.83, 0, 0.17, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <>
      {/* From frame 50 the icon comes from the split overlay, so the lockup is clipped to its
          wordmark. The clip edge falls in the empty gap between icon and wordmark, never on ink. */}
      <Lockup
        name="BeautyBOX lockup"
        style={{
          position: "absolute",
          left: 78,
          top: 344,
          width: 774,
          height: 162,
          clipPath: frame < 50 ? "none" : "inset(0px 0px 0px 166px)",
          opacity: interpolate(frame, [51, 63], [1, 0], {
            easing: Easing.bezier(0.33, 0, 0.67, 1),
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />

      {frame >= 50 && frame < 123 ? (
        <BIcon
          name="BeautyBOX icon, split"
          hubX={153.6 + (540 - 153.6) * travel}
          hubY={425 + (540 - 425) * travel}
          size={Math.exp(Math.log(0.9) + (Math.log(3) - Math.log(0.9)) * travel)}
          topLeft={interpolate(frame, [105, 119], [0, -660], {
            easing: Easing.bezier(0.7, 0, 0.84, 0),
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })}
          topRight={interpolate(frame, [105, 119], [0, 660], {
            easing: Easing.bezier(0.7, 0, 0.84, 0),
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })}
          bottomLeft={interpolate(frame, [108, 122], [0, -660], {
            easing: Easing.bezier(0.7, 0, 0.84, 0),
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })}
          bottomRight={interpolate(frame, [108, 122], [0, 660], {
            easing: Easing.bezier(0.7, 0, 0.84, 0),
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })}
        />
      ) : null}

      <Interactive.Div
        name="Coral rule"
        style={{
          position: "absolute",
          left: 96,
          top: 642,
          width: 126,
          height: 14,
          backgroundColor: "#D85F58",
          transformOrigin: "0px 7px",
          scale: interpolate(frame, [50, 62], ["1 1", "0 1"], {
            easing: Easing.bezier(0.7, 0, 0.84, 0),
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 240,
          top: 569,
          width: 800,
          height: 144,
          overflow: "hidden",
        }}
      >
        <Interactive.Div
          name="Headline"
          style={{
            position: "absolute",
            left: 26,
            top: 16,
            fontFamily: "Manrope",
            fontWeight: 700,
            fontSize: 104,
            lineHeight: "104px",
            letterSpacing: "-0.025em",
            color: "#221720",
            whiteSpace: "nowrap",
            translate: interpolate(frame, [50, 62], ["0px 0px", "0px -144px"], {
              easing: Easing.bezier(0.7, 0, 0.84, 0),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          Opening soon.
        </Interactive.Div>
      </div>
    </>
  );
};

export const BoxOpens = Interactive.create({
  Component: BoxOpensInner,
  componentName: "BoxOpens",
  layout: "absolute-fill",
  schema: {
    ...Interactive.backgroundSchema,
  },
});

import { Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { BIcon } from "../brand/BIcon";
import { Lockup } from "../brand/Lockup";

/**
 * S6, 157 frames. An ivory square the exact size and place of the big B's hub appears, pauses and
 * opens onto the last page. The four quarters slide home around that hub, the B shrinks back
 * into the lockup, and the end card settles. Its last frame is identical to frame 0 of S1.
 */
const HomeInner = () => {
  const frame = useCurrentFrame();

  // The reverse of S1: from the big B at the centre back to the lockup, in log space.
  const travel = interpolate(frame, [87, 111], [0, 1], {
    easing: Easing.bezier(0.83, 0, 0.17, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <>
      {/* One plain ivory square with the hub's corner ratio (8/36), used as a window. It holds
          at the hub's size for 12 frames, then opens over 18 so its rounded edges are seen
          sweeping out. Held open at 1600 px it covers the frame, so it is the ivory field too. */}
      <Interactive.Div
        name="Hub window"
        style={{
          position: "absolute",
          left: 486,
          top: 486,
          width: 108,
          height: 108,
          borderRadius: 24,
          backgroundColor: "#F7F2EC",
          scale: interpolate(frame, [0, 8, 20, 38], [0, 1, 1, 14.8148], {
            easing: [
              Easing.bezier(0.16, 1, 0.3, 1),
              Easing.linear,
              Easing.bezier(0.65, 0, 0.35, 1),
            ],
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />

      {frame >= 38 && frame < 123 ? (
        <BIcon
          name="BeautyBOX icon, split"
          hubX={540 + (153.6 - 540) * travel}
          hubY={540 + (425 - 540) * travel}
          size={Math.exp(Math.log(3) + (Math.log(0.9) - Math.log(3)) * travel)}
          topLeft={interpolate(frame, [38, 60], [-660, 0], {
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })}
          topRight={interpolate(frame, [38, 60], [660, 0], {
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })}
          bottomLeft={interpolate(frame, [41, 63], [-660, 0], {
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })}
          bottomRight={interpolate(frame, [41, 63], [660, 0], {
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })}
        />
      ) : null}

      {/* Until frame 123 the icon comes from the split overlay, so the lockup is clipped to its
          wordmark and only the wordmark fades in. Then the single, unclipped lockup takes over. */}
      <Lockup
        name="BeautyBOX lockup"
        style={{
          position: "absolute",
          left: 78,
          top: 344,
          width: 774,
          height: 162,
          clipPath: frame < 123 ? "inset(0px 0px 0px 166px)" : "none",
          opacity: interpolate(frame, [111, 123], [0, 1], {
            easing: Easing.bezier(0.33, 0, 0.67, 1),
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />

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
          scale: interpolate(frame, [117, 129], ["0 1", "1 1"], {
            easing: Easing.bezier(0.65, 0, 0.35, 1),
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
            translate: interpolate(frame, [121, 139], ["0px 144px", "0px 0px"], {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
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

export const Home = Interactive.create({
  Component: HomeInner,
  componentName: "Home",
  layout: "absolute-fill",
  schema: {
    ...Interactive.backgroundSchema,
  },
});

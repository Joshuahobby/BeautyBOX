import { Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { BIcon } from "../brand/BIcon";
import {
  BIG_B,
  HEADLINE_TYPE,
  HEADLINE_WINDOW,
  ICON_IN_LOCKUP,
  iconBetween,
  LOCKUP_BOX,
  RULE_BOX,
  WORDMARK_ONLY,
} from "../brand/endCard";
import { Lockup } from "../brand/Lockup";

/**
 * S6, 157 frames. An ivory square the exact size and place of the big B's hub appears, pauses and
 * opens onto the last page. The four quarters slide home around that hub, the B shrinks back
 * into the lockup, and the end card settles. Its last frame is identical to frame 0 of S1.
 */
const HomeInner = () => {
  const frame = useCurrentFrame();

  // The reverse of S1: from the big B at the centre back to the lockup (iconBetween).
  const travel = interpolate(frame, [87, 111], [0, 1], {
    easing: Easing.bezier(0.83, 0, 0.17, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const icon = iconBetween(BIG_B, ICON_IN_LOCKUP, travel);

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
          hubX={icon.hubX}
          hubY={icon.hubY}
          size={icon.size}
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
          ...LOCKUP_BOX,
          clipPath: frame < 123 ? WORDMARK_ONLY : "none",
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
          ...RULE_BOX,
          scale: interpolate(frame, [117, 129], ["0 1", "1 1"], {
            easing: Easing.bezier(0.65, 0, 0.35, 1),
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />

      <div style={HEADLINE_WINDOW}>
        <Interactive.Div
          name="Headline"
          style={{
            ...HEADLINE_TYPE,
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

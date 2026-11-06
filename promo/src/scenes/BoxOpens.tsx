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
 * S1, 125 frames. The end card (the film's first and last frame) holds still for 50 frames, then
 * the B lifts out of the lockup, grows to the centre, holds (frames 87 to 105, where frame 96 is
 * the poster), and its quarters part like doors.
 */
const BoxOpensInner = () => {
  const frame = useCurrentFrame();

  // The B travels from its place in the lockup to the centre (iconBetween).
  const travel = interpolate(frame, [63, 87], [0, 1], {
    easing: Easing.bezier(0.83, 0, 0.17, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const icon = iconBetween(ICON_IN_LOCKUP, BIG_B, travel);

  return (
    <>
      {/* From frame 50 the icon comes from the split overlay, so the lockup is clipped to its wordmark. */}
      <Lockup
        name="BeautyBOX lockup"
        style={{
          ...LOCKUP_BOX,
          clipPath: frame < 50 ? "none" : WORDMARK_ONLY,
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
          hubX={icon.hubX}
          hubY={icon.hubY}
          size={icon.size}
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
          ...RULE_BOX,
          scale: interpolate(frame, [50, 62], ["1 1", "0 1"], {
            easing: Easing.bezier(0.7, 0, 0.84, 0),
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

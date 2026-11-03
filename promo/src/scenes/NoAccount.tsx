import { Easing, Interactive, interpolate, useCurrentFrame } from "remotion";

/**
 * S4, 92 frames. Aubergine, with the coral rule left by S3 holding still. "No account / needed."
 * rises, holds, and leaves upward, like the next line of a conversation.
 */
const NoAccountInner = () => {
  const frame = useCurrentFrame();

  return (
    <>
      <Interactive.Div
        name="Coral rule"
        style={{
          position: "absolute",
          left: 96,
          top: 466,
          width: 126,
          height: 14,
          backgroundColor: "#D85F58",
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 240,
          top: 390,
          width: 800,
          height: 148,
          overflow: "hidden",
        }}
      >
        <Interactive.Div
          name="Line 1"
          style={{
            position: "absolute",
            left: 21,
            top: 17,
            fontFamily: "Manrope",
            fontWeight: 700,
            fontSize: 108,
            lineHeight: "108px",
            letterSpacing: "-0.025em",
            color: "#F7F2EC",
            whiteSpace: "nowrap",
            translate: interpolate(
              frame,
              [0, 18, 78, 88],
              ["0px 148px", "0px 0px", "0px 0px", "0px -148px"],
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
          No account
        </Interactive.Div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 240,
          top: 518,
          width: 800,
          height: 148,
          overflow: "hidden",
        }}
      >
        <Interactive.Div
          name="Line 2"
          style={{
            position: "absolute",
            left: 21,
            top: 17,
            fontFamily: "Manrope",
            fontWeight: 700,
            fontSize: 108,
            lineHeight: "108px",
            letterSpacing: "-0.025em",
            color: "#F7F2EC",
            whiteSpace: "nowrap",
            translate: interpolate(
              frame,
              [6, 24, 80, 90],
              ["0px 148px", "0px 0px", "0px 0px", "0px -148px"],
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
          needed.
        </Interactive.Div>
      </div>
    </>
  );
};

export const NoAccount = Interactive.create({
  Component: NoAccountInner,
  componentName: "NoAccount",
  layout: "absolute-fill",
  schema: {
    ...Interactive.backgroundSchema,
  },
});

import { Easing, Interactive, interpolate, useCurrentFrame } from "remotion";

/**
 * S5, 94 frames. Same field, same rule. "Pay with" rises in ivory and "Mobile Money." answers in
 * coral, large on aubergine. Both leave upward and the rule retracts, leaving plain aubergine.
 */
const MobileMoneyInner = () => {
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
          transformOrigin: "0px 7px",
          scale: interpolate(frame, [82, 93], ["1 1", "0 1"], {
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
              [2, 20, 80, 90],
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
          Pay with
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
            color: "#D85F58",
            whiteSpace: "nowrap",
            translate: interpolate(
              frame,
              [8, 26, 82, 92],
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
          Mobile Money.
        </Interactive.Div>
      </div>
    </>
  );
};

export const MobileMoney = Interactive.create({
  Component: MobileMoneyInner,
  componentName: "MobileMoney",
  layout: "absolute-fill",
  schema: {
    ...Interactive.backgroundSchema,
  },
});

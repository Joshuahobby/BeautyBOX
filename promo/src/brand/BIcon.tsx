import type { CSSProperties } from "react";
import { Interactive } from "remotion";

type BIconProps = {
  /** Centre of the ivory hub on screen, in px. The hub is the fixed point the B grows around. */
  readonly hubX: number;
  readonly hubY: number;
  /** Uniform scale of the 180-unit icon. 0.9 sits exactly on the lockup's icon, 3 is the big B. */
  readonly size: number;
  /** Horizontal offsets of the four quarters, in screen px. 0 is the assembled B. */
  readonly topLeft: number;
  readonly topRight: number;
  readonly bottomLeft: number;
  readonly bottomRight: number;
  readonly style?: CSSProperties;
};

/**
 * The supplied BeautyBOX icon, with its two compound paths split verbatim into the four quarters
 * so they can slide apart and back. Nothing is redrawn: the path data, colours, hub and paint
 * order are the original file's. It is sized through the SVG's own width and height (uniform
 * scale only), and the quarters only ever move horizontally, never rotated or faded one by one.
 */
const BIconInner = ({
  hubX,
  hubY,
  size,
  topLeft,
  topRight,
  bottomLeft,
  bottomRight,
  style,
}: BIconProps) => {
  return (
    <svg
      width={180 * size}
      height={180 * size}
      viewBox="0 0 180 180"
      style={{
        position: "absolute",
        // The hub's centre in the icon is (84, 90), so the box is placed from that point.
        left: hubX - 84 * size,
        top: hubY - 90 * size,
        overflow: "visible",
        ...style,
      }}
    >
      {/* Offsets are given in screen px; one SVG unit is `size` px, hence the division. */}
      <path d="M20 18h55v63H20z" fill="#221720" style={{ translate: `${topLeft / size}px 0px` }} />
      <path d="M20 99h55v63H20z" fill="#221720" style={{ translate: `${bottomLeft / size}px 0px` }} />
      <path
        d="M75 18h27c35 0 58 18 58 44 0 12-5 23-15 31-10-8-23-12-43-12H75V18z"
        fill="#D85F58"
        style={{ translate: `${topRight / size}px 0px` }}
      />
      <path
        d="M75 99h27c20 0 33-4 43-12 10 8 15 19 15 31 0 26-23 44-58 44H75V99z"
        fill="#D85F58"
        style={{ translate: `${bottomRight / size}px 0px` }}
      />
      <rect x="66" y="72" width="36" height="36" rx="8" fill="#F7F2EC" />
    </svg>
  );
};

export const BIcon = Interactive.create({
  Component: BIconInner,
  componentName: "BIcon",
});

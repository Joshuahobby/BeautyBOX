/**
 * The end card: the lockup, the coral rule and "Opening soon." It is the film's first frame
 * (S1 starts on it) and its last (S6 settles on it), so both scenes place it from here and the
 * loop cannot develop a seam. Only positions and type live here. Each scene animates these
 * parts itself, inline, so the Studio can still edit those keyframes.
 */

/** The supplied lockup at 0.9 of its 860 x 180 size. */
export const LOCKUP_BOX = {
  position: "absolute",
  left: 78,
  top: 344,
  width: 774,
  height: 162,
} as const;

/**
 * Clips the lockup to its wordmark while its icon is drawn by the split overlay (BIcon). The
 * edge falls in the empty gap between icon and wordmark, never on ink.
 */
export const WORDMARK_ONLY = "inset(0px 0px 0px 166px)";

/** Where BIcon sits exactly on the lockup's own icon: hub centre in px and scale. */
export const ICON_IN_LOCKUP = { hubX: 153.6, hubY: 425, size: 0.9 } as const;

/** The big B at the centre of the frame, between S1 lifting it out and S6 bringing it back. */
export const BIG_B = { hubX: 540, hubY: 540, size: 3 } as const;

type IconPlace = {
  readonly hubX: number;
  readonly hubY: number;
  readonly size: number;
};

/**
 * The B on its way between two places, at eased progress 0 to 1. The scale moves in log space,
 * so every frame grows by the same ratio, and the hub follows the same progress.
 */
export const iconBetween = (
  start: IconPlace,
  finish: IconPlace,
  progress: number,
): IconPlace => ({
  hubX: start.hubX + (finish.hubX - start.hubX) * progress,
  hubY: start.hubY + (finish.hubY - start.hubY) * progress,
  size: Math.exp(
    Math.log(start.size) +
      (Math.log(finish.size) - Math.log(start.size)) * progress,
  ),
});

/** The 14 px coral rule beside the headline, scaled from its left end. */
export const RULE_BOX = {
  position: "absolute",
  left: 96,
  top: 642,
  width: 126,
  height: 14,
  backgroundColor: "#D85F58",
  transformOrigin: "0px 7px",
} as const;

/** The window "Opening soon." rises into and leaves from: words outside it are cut off. */
export const HEADLINE_WINDOW = {
  position: "absolute",
  left: 240,
  top: 569,
  width: 800,
  height: 144,
  overflow: "hidden",
} as const;

/** "Opening soon." in Manrope 700, placed inside HEADLINE_WINDOW. */
export const HEADLINE_TYPE = {
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
} as const;

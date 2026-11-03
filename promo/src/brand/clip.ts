/**
 * Turns the four edges of a rectangle on the 1080 x 1080 frame, given as [top, right, bottom,
 * left] in px from the frame's top-left, into a CSS clip-path. The coral rule and the coral page
 * are one full-frame plane clipped to these edges, so the rule can stretch into a page and close
 * back into a rule without any cut.
 */
export const clipToEdges = ([top, right, bottom, left]: readonly number[]) =>
  `inset(${top}px ${1080 - right}px ${1080 - bottom}px ${left}px)`;

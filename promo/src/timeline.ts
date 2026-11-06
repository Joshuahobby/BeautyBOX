import { BoxOpens } from "./scenes/BoxOpens";
import { Delivered } from "./scenes/Delivered";
import { Essentials } from "./scenes/Essentials";
import { Home } from "./scenes/Home";
import { MobileMoney } from "./scenes/MobileMoney";
import { NoAccount } from "./scenes/NoAccount";

export const FPS = 30;
export const SIZE = 1080;

const IVORY = "#F7F2EC";
const AUBERGINE = "#221720";

/**
 * The six scenes in order, with their lengths. Promo.tsx plays them back to back on one track
 * and Root.tsx gives each its own preview, both from this list: change a scene's length here,
 * and every later scene's start and the film's total follow. The Studio shows these timings
 * read-only; everything inside a scene stays editable there.
 */
const SCENE_LIST = [
  {
    id: "S1-BoxOpens",
    name: "S1 Opening soon, the box opens",
    component: BoxOpens,
    durationInFrames: 125,
    background: IVORY,
  },
  {
    id: "S2-Essentials",
    name: "S2 Your beauty essentials",
    component: Essentials,
    durationInFrames: 116,
    background: IVORY,
  },
  {
    id: "S3-Delivered",
    name: "S3 delivered in Kigali",
    component: Delivered,
    durationInFrames: 112,
    background: AUBERGINE,
  },
  {
    id: "S4-NoAccount",
    name: "S4 No account needed",
    component: NoAccount,
    durationInFrames: 92,
    background: AUBERGINE,
  },
  {
    id: "S5-MobileMoney",
    name: "S5 Pay with Mobile Money",
    component: MobileMoney,
    durationInFrames: 94,
    background: AUBERGINE,
  },
  {
    id: "S6-Home",
    name: "S6 The window, the B, the end card",
    component: Home,
    durationInFrames: 157,
    background: AUBERGINE,
  },
];

let end = 0;
/** Each scene starts where the one before it ends: no gaps, no overlaps. */
export const SCENES = SCENE_LIST.map((scene) => {
  const from = end;
  end += scene.durationInFrames;
  return { ...scene, from };
});

/** 696 frames (23.2 s): the sum of the scenes. */
export const DURATION_IN_FRAMES = end;

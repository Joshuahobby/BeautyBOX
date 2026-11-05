import { Track } from "remotion";
import "./fonts";
import { SCENES } from "./timeline";

/**
 * "The box opens": the BeautyBOX promo for the coming-soon page. 1080 x 1080, 30 fps, 696 frames (23.2 s).
 * Six back-to-back scenes on one track (their lengths are in timeline.ts), so the total is the
 * sum of the scenes. The last frame equals the first, so the film loops without a seam. The
 * poster is frame 96, the icon alone in S1's still hold (POSTER_FRAME in ../src/design/promo/film.ts).
 */
export const Promo = () => {
  return (
    <Track name="Scenes">
      {SCENES.map(
        ({ component: Scene, name, from, durationInFrames, background }) => (
          <Scene
            key={name}
            name={name}
            from={from}
            durationInFrames={durationInFrames}
            style={{ backgroundColor: background }}
          />
        ),
      )}
    </Track>
  );
};

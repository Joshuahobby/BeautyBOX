import { Composition, Folder } from "remotion";
import "./fonts";
import { Promo } from "./Promo";
import { DURATION_IN_FRAMES, FPS, SCENES, SIZE } from "./timeline";

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="BeautyBoxPromo"
        component={Promo}
        durationInFrames={DURATION_IN_FRAMES}
        fps={FPS}
        width={SIZE}
        height={SIZE}
      />
      {/* Each scene on its own, on its background, for previewing in the Studio. */}
      <Folder name="Scenes">
        {SCENES.map(({ id, component, durationInFrames, background }) => (
          <Composition
            key={id}
            id={id}
            component={component}
            durationInFrames={durationInFrames}
            fps={FPS}
            width={SIZE}
            height={SIZE}
            defaultProps={{ style: { backgroundColor: background } }}
          />
        ))}
      </Folder>
    </>
  );
};

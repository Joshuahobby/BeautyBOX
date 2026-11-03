import { Track } from "remotion";
import "./fonts";
import { BoxOpens } from "./scenes/BoxOpens";
import { Delivered } from "./scenes/Delivered";
import { Essentials } from "./scenes/Essentials";
import { Home } from "./scenes/Home";
import { MobileMoney } from "./scenes/MobileMoney";
import { NoAccount } from "./scenes/NoAccount";

/**
 * "The box opens": the BeautyBOX promo for the coming-soon page. 1080 x 1080, 30 fps, 696 frames (23.2 s).
 * Six back-to-back scenes on one track, with no overlaps, so the total is the sum of the scenes.
 * The last frame equals the first, so the film loops without a seam, and frame 0 is the poster.
 */
export const Promo = () => {
  return (
    <Track name="Scenes">
      <BoxOpens
        name="S1 Opening soon, the box opens"
        durationInFrames={125}
        style={{ backgroundColor: "#F7F2EC" }}
      />
      <Essentials
        name="S2 Your beauty essentials"
        from={125}
        durationInFrames={116}
        style={{ backgroundColor: "#F7F2EC" }}
      />
      <Delivered
        name="S3 delivered in Kigali"
        from={241}
        durationInFrames={112}
        style={{ backgroundColor: "#221720" }}
      />
      <NoAccount
        name="S4 No account needed"
        from={353}
        durationInFrames={92}
        style={{ backgroundColor: "#221720" }}
      />
      <MobileMoney
        name="S5 Pay with Mobile Money"
        from={445}
        durationInFrames={94}
        style={{ backgroundColor: "#221720" }}
      />
      <Home
        name="S6 The window, the B, the end card"
        from={539}
        durationInFrames={157}
        style={{ backgroundColor: "#221720" }}
      />
    </Track>
  );
};

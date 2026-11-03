import { Composition, Folder } from "remotion";
import "./fonts";
import { Promo } from "./Promo";
import { BoxOpens } from "./scenes/BoxOpens";
import { Delivered } from "./scenes/Delivered";
import { Essentials } from "./scenes/Essentials";
import { Home } from "./scenes/Home";
import { MobileMoney } from "./scenes/MobileMoney";
import { NoAccount } from "./scenes/NoAccount";

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="BeautyBoxPromo"
        component={Promo}
        durationInFrames={696}
        fps={30}
        width={1080}
        height={1080}
      />
      <Folder name="Scenes">
        <Composition
          id="S1-BoxOpens"
          component={BoxOpens}
          durationInFrames={125}
          fps={30}
          width={1080}
          height={1080}
          defaultProps={{ style: { backgroundColor: "#F7F2EC" } }}
        />
        <Composition
          id="S2-Essentials"
          component={Essentials}
          durationInFrames={116}
          fps={30}
          width={1080}
          height={1080}
          defaultProps={{ style: { backgroundColor: "#F7F2EC" } }}
        />
        <Composition
          id="S3-Delivered"
          component={Delivered}
          durationInFrames={112}
          fps={30}
          width={1080}
          height={1080}
          defaultProps={{ style: { backgroundColor: "#221720" } }}
        />
        <Composition
          id="S4-NoAccount"
          component={NoAccount}
          durationInFrames={92}
          fps={30}
          width={1080}
          height={1080}
          defaultProps={{ style: { backgroundColor: "#221720" } }}
        />
        <Composition
          id="S5-MobileMoney"
          component={MobileMoney}
          durationInFrames={94}
          fps={30}
          width={1080}
          height={1080}
          defaultProps={{ style: { backgroundColor: "#221720" } }}
        />
        <Composition
          id="S6-Home"
          component={Home}
          durationInFrames={157}
          fps={30}
          width={1080}
          height={1080}
          defaultProps={{ style: { backgroundColor: "#221720" } }}
        />
      </Folder>
    </>
  );
};

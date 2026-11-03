/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import { Config } from "@remotion/cli/config";

Config.setRspack(true);
// Brand files come straight from the app's design folder: the supplied lockup (brand/) and the
// site's own Manrope (fonts/). So the film can never drift from what the website uses.
Config.setPublicDir("../src/design");
// Lossless frames reach the encoder, so the flat brand fields and the 14 px coral rule carry no
// JPEG blocking. BT.709 tags keep coral and ivory matching the page's CSS colours in browsers.
Config.setVideoImageFormat("png");
Config.setColorSpace("bt709");
Config.setPixelFormat("yuv420p");
// The film has no sound; a muted file has no audio track to load on the page.
Config.setMuted(true);
Config.setOverwriteOutput(true);
Config.setDefaultPremountInSeconds(2);

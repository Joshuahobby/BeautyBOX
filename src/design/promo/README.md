# Opening film ("The box opens")

The film on "Launching soon" (`src/app/(launch)/launching-soon/LaunchFilm.tsx`). It is silent,
1080 × 1080, 30 fps, 23.2 s (696 frames), and loops seamlessly: its last frame equals its first.

| File | What | Size |
| --- | --- | --- |
| `beautybox-promo.webm` | VP9, CRF 30 (first choice for browsers that play it) | 290 KB |
| `beautybox-promo.mp4` | H.264, CRF 20, preset veryslow, yuv420p, BT.709, index at the front | 296 KB |
| `poster.png` | Frame 96 (3.2 s): the supplied icon alone, in the still hold of frames 87–105 | 31 KB |

The poster is not frame 0 on purpose: frame 0 is the lockup with "Opening soon." beside a coral
rule, which would repeat the page's own logo and headline next to them. The first play starts at
3.2 s, on the poster's frame, so nothing jumps; frame 0 comes round with the loop.

Quality: decoded frames measure 38–43 dB PSNR against lossless renders. Converting those
renders to 4:2:0 colour (what every browser-safe format uses) with no compression at all
already gives 40–45 dB, so most of the difference is colour sampling, not compression.

## Source

A Remotion 4.0.539 project, composition `BeautyBoxPromo`. For now it lives only on the machine it
was made on, at `E:\Joshua Backup\BeautyBOX\beautybox-promo`, with no commits or remote yet. Words are
Manrope (the site's own file); the lockup is the supplied `BeautyBox_Platform_Hub_Lockup.svg`,
with its wordmark drawn in Inter 700 as that file asks. Its `remotion.config.ts` already sets
PNG frames, BT.709, yuv420p and no audio.

To change the film, edit it there and export again from that folder:

```bash
npx remotion still BeautyBoxPromo out/web/poster.png --frame=96
npx remotion render BeautyBoxPromo out/web/beautybox-promo.mp4 --codec=h264 --crf=20 --x264-preset=veryslow
npx remotion render BeautyBoxPromo out/web/beautybox-promo.webm --codec=vp9 --crf=30
```

Then copy the three files here. If the still hold moves, update the poster frame and
`POSTER_SECONDS` in `LaunchFilm.tsx` together. The build hashes the file names
(`next.config.ts`, `turbopack.rules`), so a new export never meets an old cached copy.

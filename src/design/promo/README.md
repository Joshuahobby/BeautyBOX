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

The Remotion project in [`promo/`](../../../promo) at the root of this repository (see its README).
Words are Manrope (the site's own file); the lockup is the supplied
`BeautyBox_Platform_Hub_Lockup.svg`, with its wordmark drawn in Inter 700 as that file asks.
Both are read from this design folder, so the film always uses the site's files.

To change the film, edit it there and export again; the files land here directly:

```bash
npm --prefix promo ci
```

```bash
npm --prefix promo run export
```

If the still hold moves, update the poster frame (`promo/package.json`) and `POSTER_SECONDS` in
`LaunchFilm.tsx` together. The build hashes the file names (`next.config.ts`, `turbopack.rules`),
so a new export never meets an old cached copy.

# BeautyBOX opening film ("The box opens")

The Remotion 4.0.539 project behind the film on "Launching soon". The site serves only its
exports, in `../src/design/promo` (see the README there). This folder is not part of the app:
the app's ESLint skips it and Vercel does not upload it.

Composition `BeautyBoxPromo`: 1080 × 1080, 30 fps, 696 frames (23.2 s), six scenes on one track
in `src/scenes`, 15 words. Scene lengths are set in one place, `src/timeline.ts`; each scene's
start and the total follow from them. Its last frame equals its first, so it loops without a
seam; frames 87–105 are a still hold of the supplied icon, and frame 96 is the poster. The end
card the film starts and ends on is placed from `src/brand/endCard.ts`, used by both S1 and S6.

Brand files are read from the app's own design folder (`remotion.config.ts` sets the public
folder to `../src/design`): the supplied lockup from `brand/` and the site's Manrope from
`fonts/`. The lockup's wordmark is live text in Inter 700, loaded from Google Fonts at render
time (`src/fonts.ts`), so rendering needs a network connection.

## Commands

Run from this folder with Node 22.13 or later on Node 22 (this project's ESLint 10 needs
22.13; the app itself accepts 22.12):

```bash
npm ci
```

```bash
npm run dev
```

opens Remotion Studio to preview and edit.

```bash
npm run export
```

writes the poster (frame 96), the H.264 MP4 (CRF 20, preset veryslow) and the VP9 WebM (CRF 30)
straight into `../src/design/promo`, about five minutes in all. `npm run export:poster`,
`export:mp4` and `export:webm` run one at a time.

```bash
npm run lint
```

checks the film's code (ESLint with Remotion's rules, then TypeScript).

If the still hold moves, change the poster frame in `package.json` (`--frame=`) and
`POSTER_FRAME` in `../src/design/promo/film.ts` together. The app's unit tests fail while the
two differ.

// Timing of the opening film, shared by the page (LaunchFilm.tsx) and its browser tests. The
// poster export in promo/package.json ("--frame=") must name the same frame; a unit test
// (tests/unit/launch-film.test.ts) fails if the two drift apart.

export const FILM_FPS = 30;

/** Frame 96 (3.2 s): the supplied icon alone, in the still hold of frames 87 to 105. */
export const POSTER_FRAME = 96;

export const POSTER_SECONDS = POSTER_FRAME / FILM_FPS;

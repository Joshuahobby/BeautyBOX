"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Pause, Play } from "lucide-react";
import mp4 from "@/design/promo/beautybox-promo.mp4";
import webm from "@/design/promo/beautybox-promo.webm";
import poster from "@/design/promo/poster.png";
import { messages } from "@/messages";
import styles from "../Launch.module.css";

const LOOK_AT_IT = 0.25;
/** The poster is frame 96: the supplied icon alone, large, in the still hold before it opens. */
const POSTER_SECONDS = 96 / 30;
const noChanges = () => () => {};

/** Plays the film, the first time from the poster's frame. */
function play(film: HTMLVideoElement, begun: { current: boolean }, refused: () => void) {
  if (!begun.current) {
    begun.current = true;
    // Before anything has loaded, this sets where playback will start.
    film.currentTime = POSTER_SECONDS;
  }
  film.play().catch(refused);
}

/**
 * The opening film ("The box opens"), made with Remotion (see src/design/promo/README.md). It is
 * silent and loops seamlessly: its last frame is its first.
 *
 * At rest it shows the icon alone rather than the film's opening card, which would repeat the
 * page's logo and headline beside them. The first play starts from that same frame, so nothing
 * jumps; the opening card comes round with the loop.
 *
 * Nothing is downloaded until it plays. It plays muted while at least a quarter of it is on
 * screen, never for people who ask for reduced motion (they see the poster and can press
 * Play), and a visitor's own Pause or Play always wins over scrolling.
 */
export function LaunchFilm() {
  const t = messages.launch;
  const video = useRef<HTMLVideoElement>(null);
  const choice = useRef<"play" | "pause" | null>(null);
  const visible = useRef(false);
  const begun = useRef(false);
  // True in the browser once hydrated, false in the server render.
  const scripted = useSyncExternalStore(
    noChanges,
    () => true,
    () => false,
  );
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const film = video.current;
    if (!film) return;
    film.muted = true;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");

    const sync = () => {
      const wanted = visible.current && (choice.current === "play" || (choice.current === null && !still.matches));
      if (wanted && film.paused) play(film, begun, () => setPlaying(false));
      else if (!wanted && !film.paused) film.pause();
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const observer = new IntersectionObserver(
      (entries) => {
        // Several crossings can arrive at once (a quick fling); the last one is where it is now.
        visible.current = entries[entries.length - 1]?.isIntersecting ?? false;
        sync();
      },
      { threshold: LOOK_AT_IT },
    );

    film.addEventListener("play", onPlay);
    film.addEventListener("pause", onPause);
    still.addEventListener("change", sync);
    observer.observe(film);
    return () => {
      observer.disconnect();
      still.removeEventListener("change", sync);
      film.removeEventListener("play", onPlay);
      film.removeEventListener("pause", onPause);
    };
  }, []);

  function toggle() {
    const film = video.current;
    if (!film) return;
    if (film.paused) {
      choice.current = "play";
      play(film, begun, () => setPlaying(false));
    } else {
      choice.current = "pause";
      film.pause();
    }
  }

  return (
    <figure className={styles.film}>
      <video
        ref={video}
        className={styles.filmVideo}
        width={1080}
        height={1080}
        poster={poster.src}
        preload="none"
        muted
        loop
        playsInline
        disablePictureInPicture
        disableRemotePlayback
      >
        <source src={webm} type="video/webm" />
        <source src={mp4} type="video/mp4" />
      </video>
      <figcaption className="visually-hidden">{t.filmWords}</figcaption>
      {/* Only once the script runs: without it there is nothing for the button to control. */}
      {scripted ? (
        <button type="button" className={styles.filmToggle} onClick={toggle}>
          {playing ? <Pause size={20} strokeWidth={1.75} aria-hidden="true" /> : <Play size={20} strokeWidth={1.75} aria-hidden="true" />}
          <span className="visually-hidden">{playing ? t.filmPause : t.filmPlay}</span>
        </button>
      ) : null}
    </figure>
  );
}

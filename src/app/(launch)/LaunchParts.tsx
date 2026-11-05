import { Fragment, type ReactNode } from "react";
import icon from "@/design/brand/BeautyBox_Platform_Hub_Icon.svg";
// The supplied lockup with its wordmark as Inter outlines (scripts/design/outline-lockup.mjs):
// an <img> cannot load web fonts, so the supplied file's live text fell back to system fonts.
import lockup from "@/design/brand/BeautyBox_Platform_Hub_Lockup_Outlined.svg";
import { currentKigaliYear, messages } from "@/messages";
import styles from "./Launch.module.css";

/** The shared frame of the pre-launch pages (DR-044): the lockup, the page body and a quiet footer. */
export function LaunchFrame({ linkHome = false, footer, children }: { linkHome?: boolean; footer?: ReactNode; children: ReactNode }) {
  const logo = <img src={lockup.src} alt={messages.brand.name} width={200} height={42} className={styles.lockup} decoding="async" fetchPriority="high" />;
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        {linkHome ? (
          <a href="/launching-soon" className={styles.lockupLink}>
            {logo}
          </a>
        ) : (
          logo
        )}
      </header>
      {children}
      <footer className={styles.footer}>
        <p className={styles.copyright}>
          © {currentKigaliYear()} {messages.launch.copyright}
        </p>
        {footer}
      </footer>
    </div>
  );
}

/** Small status label with a live coral dot. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className={styles.eyebrow}>
      <span className={styles.dot} aria-hidden="true" />
      {children}
    </p>
  );
}

/**
 * The page headline beside the coral rule. Each word is its own span so the words can rise in
 * one after another; the spaces stay real text, so the heading reads as one sentence.
 */
export function Headline({ id, children }: { id: string; children: string }) {
  return (
    <h1 id={id} className={styles.heading}>
      {children.split(" ").map((word, i) => (
        <Fragment key={i}>
          {i > 0 ? " " : null}
          <span className={styles.word}>{word}</span>
        </Fragment>
      ))}
    </h1>
  );
}

const PIECES = ["tl", "tr", "bl", "br"] as const;

/**
 * Decorative aubergine stage: the supplied Platform Hub icon assembles from its four cells, then
 * slow rings move out from it. Each piece is the original icon file clipped to one quarter (the
 * artwork is never redrawn), and the whole file fades in on top once the pieces meet, so the
 * resting state is exactly the supplied icon.
 */
export function BrandStage() {
  return (
    <div className={styles.stage} aria-hidden="true">
      <span className={styles.ring} />
      <span className={styles.ring} />
      <span className={styles.ring} />
      <div className={styles.tile}>
        <div className={styles.mark}>
          {PIECES.map((piece) => (
            <img key={piece} src={icon.src} alt="" width={180} height={180} className={styles[piece]} decoding="async" />
          ))}
          <img src={icon.src} alt="" width={180} height={180} className={styles.whole} decoding="async" />
        </div>
      </div>
    </div>
  );
}

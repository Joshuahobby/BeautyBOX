import styles from "./PageFeedback.module.css";

/** Static shells avoid animation and reserve useful content space during reads. */
export function PageLoading({
  title = "Loading BeautyBOX…",
  contained = true,
}: {
  title?: string;
  contained?: boolean;
}) {
  return (
    <section
      className={`${contained ? "container " : ""}${styles.feedback}`}
      aria-busy="true"
      aria-label={title}
    >
      <p role="status">{title}</p>
      <div aria-hidden="true" className={styles.skeletons}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={styles.skeleton} />
        ))}
      </div>
    </section>
  );
}

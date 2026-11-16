"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight } from "lucide-react";
import styles from "./FeatureCarousel.module.css";

const features = [
  {
    emphasis: "Beauty,",
    title: "for every day.",
    body: "Explore skincare, makeup and personal care essentials.",
    link: "/shop",
    cta: "Shop the collection",
    label: "EVERYDAY",
    image: "green-ritual",
    alt: "An emerald jar with cream and green leaves on a pink backdrop",
    portrait: true,
  },
  {
    emphasis: "A little colour,",
    title: "all your own.",
    body: "Find the finishing touches that feel like you.",
    link: "/shop?category=makeup",
    cta: "Explore makeup",
    label: "YOUR WAY",
    image: "lip-hue",
    alt: "Illustrative lip colour on a warm pink background",
    portrait: true,
  },
  {
    emphasis: "Small rituals,",
    title: "good mornings.",
    body: "Make space for your everyday skincare routine.",
    link: "/shop?category=skincare",
    cta: "Find your skincare",
    label: "YOUR RITUAL",
    image: "green-ritual",
    alt: "An emerald skincare jar and botanical leaves",
    portrait: false,
  },
];

/** Manual rotation keeps the first feature still, supports reduced motion and never
 * replaces focused content on a timer. All slides and their CTAs work without autoplay. */
export function FeatureCarousel() {
  const [index, setIndex] = useState(0);
  const feature = features[index]!;
  const change = (delta: number) =>
    setIndex((i) => (i + delta + features.length) % features.length);
  return (
    <section
      className={styles.hero}
      aria-roledescription="carousel"
      aria-label="BeautyBOX featured collections"
    >
      <div className={"container " + styles.heroInner}>
        <p className={styles.heroWord} aria-hidden="true">
          {feature.label}
        </p>
        <div className={styles.composition}>
          <div className={styles.copy + (index ? " " + styles.compact : "")}>
            <h1>
              <span>{feature.emphasis}</span>
              <br />
              <span className={styles.subhead}>{feature.title}</span>
            </h1>
            <p className={styles.body}>{feature.body}</p>
            <Link className={styles.cta} href={feature.link}>
              {feature.cta}
              <ArrowUpRight size={20} aria-hidden="true" />
            </Link>
          </div>
          <div className={styles.art}>
            <img
              className={styles.product}
              src={"/images/editorial/" + feature.image + ".webp"}
              alt={feature.alt}
              width={800}
              height={800}
              fetchPriority="high"
            />
            <img
              className={styles.portrait}
              src={
                "/images/editorial/" +
                (feature.portrait ? "everyday-beauty" : "hibiscus-ritual") +
                ".webp"
              }
              alt={
                feature.portrait
                  ? "Beauty campaign portrait with natural coiled hair and warm sunlight"
                  : "A coral hibiscus blossom with dewdrops"
              }
              width={600}
              height={1000}
            />
          </div>
        </div>
        <div className={styles.controls}>
          <span className={styles.slideCount} aria-hidden="true">
            0{index + 1} / 0{features.length}
          </span>
          <div className={styles.dots}>
            {features.map((item, i) => (
              <button
                key={item.label}
                type="button"
                aria-label={"Show feature " + (i + 1)}
                aria-pressed={index === i}
                className={styles.dot}
                onClick={() => setIndex(i)}
              >
                <span />
              </button>
            ))}
          </div>
          <button
            type="button"
            className={styles.arrow}
            aria-label="Previous feature"
            onClick={() => change(-1)}
          >
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.arrow}
            aria-label="Next feature"
            onClick={() => change(1)}
          >
            <ArrowRight size={18} aria-hidden="true" />
          </button>
          <p className="visually-hidden" role="status">
            Feature {index + 1} of {features.length}: {feature.emphasis}{" "}
            {feature.title}
          </p>
        </div>
      </div>
    </section>
  );
}

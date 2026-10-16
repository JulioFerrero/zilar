'use client';

import { useRef } from 'react';
import { SECTION } from '@/lib/sections';
import { useHeroMotion } from './hero-motion';
import styles from './hero.module.css';

export function Hero() {
  const ref = useRef<HTMLElement | null>(null);
  useHeroMotion(ref);

  return (
    <section id={SECTION.hero} ref={ref} className={styles.hero} aria-label="Zilar">
      <div className={`wrap ${styles.heroGrid}`}>
        <div>
          <h1 className={`display ${styles.title}`} id="hero-title">
            <span className={styles.ln}>Your friends</span>
            <span className={styles.ln}>and your AIs,</span>
            <span className={`${styles.ln} ${styles.silver}`}>in one chat.</span>
          </h1>
          <p className={styles.lede} id="hero-lede">
            A messenger you host yourself. Your server, your keys, your rules.
          </p>
          <div className={styles.cta} id="hero-cta">
            <a className="key key-primary" href="#install">
              Run your own
            </a>
            <a
              className="key key-dark"
              href="https://github.com/JulioFerrero/zilar/releases/latest"
            >
              Android app
            </a>
          </div>
        </div>
        <div className={styles.planetWrap} id="planet-wrap" aria-hidden="true">
          <img src="/icon.webp" alt="" width={400} height={400} />
        </div>
      </div>
      <div className={`wrap ${styles.heroMeta}`} id="hero-meta">
        <span>Scroll</span>
        <span>Open source · MIT</span>
      </div>
    </section>
  );
}

'use client';

import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from '@/lib/gsap';
import { SECTION } from '@/lib/sections';
import styles from './finale.module.css';

export function Finale() {
  const root = useRef<HTMLElement>(null);
  const wordmark = useRef<HTMLHeadingElement>(null);

  useGSAP(
    () => {
      const section = root.current;
      const mark = wordmark.current;
      if (section === null || mark === null) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      gsap.from(mark, {
        yPercent: 40,
        opacity: 0,
        duration: 1.4,
        ease: 'expo.out',
        scrollTrigger: { trigger: section, start: 'top 60%' },
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} id={SECTION.finale} className={`${styles.finale} wrap`} aria-label="Zilar">
      <h2 ref={wordmark} className={`${styles.wordmark} silver`}>
        zilar
      </h2>
      <p>Basque for silver.</p>
      <div className={styles.cta}>
        <a className="key key-primary" href="#install">
          Run your own
        </a>
        <a className="key key-dark" href="https://github.com/JulioFerrero/zilar">
          Source on GitHub
        </a>
      </div>
    </section>
  );
}

'use client';

import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from '@/lib/gsap';
import { SECTION } from '@/lib/sections';
import { useLenis } from '@/components/smooth-scroll';
import styles from './keys.module.css';

// The provider names, off means outlined and on means filled. The second band is
// the same list reversed, so the two rows drift against each other.
const PROVIDERS = [
  { name: 'OpenAI', on: false },
  { name: 'Anthropic', on: true },
  { name: 'Gemini', on: false },
  { name: 'DeepSeek', on: true },
  { name: 'xAI', on: false },
  { name: 'OpenRouter', on: true },
] as const;

const BAND_ONE = [...PROVIDERS, ...PROVIDERS];
const BAND_TWO = [...PROVIDERS.toReversed(), ...PROVIDERS.toReversed()];

function Band({ providers }: { providers: typeof BAND_ONE }) {
  return providers.map((provider, index) => (
    <span key={`${provider.name}-${index}`} className={provider.on ? styles.on : undefined}>
      {provider.name}
    </span>
  ));
}

export function Keys() {
  const root = useRef<HTMLElement>(null);
  const bandOne = useRef<HTMLDivElement>(null);
  const bandTwo = useRef<HTMLDivElement>(null);
  const lenis = useLenis();

  useGSAP(
    () => {
      const section = root.current;
      if (section === null || bandOne.current === null || bandTwo.current === null) return;
      const scrollTrigger = () => ({
        trigger: section,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
      });
      gsap.fromTo(
        bandOne.current,
        { xPercent: 0 },
        { xPercent: -35, ease: 'none', scrollTrigger: scrollTrigger() },
      );
      gsap.fromTo(
        bandTwo.current,
        { xPercent: -35 },
        { xPercent: 0, ease: 'none', scrollTrigger: scrollTrigger() },
      );
    },
    { scope: root },
  );

  // The lean tracks scroll speed, so it only exists when Lenis is driving the
  // page (it is skipped under reduced motion, where Lenis never starts).
  useGSAP(
    () => {
      if (lenis === null || bandOne.current === null || bandTwo.current === null) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const lean = gsap.quickTo([bandOne.current, bandTwo.current], 'skewX', {
        duration: 0.5,
        ease: 'power3',
      });
      const stop = lenis.on('scroll', (instance) => {
        lean(gsap.utils.clamp(-14, 14, -instance.velocity * 0.35));
      });
      return () => {
        stop();
        lean.tween.kill();
      };
    },
    { scope: root, dependencies: [lenis] },
  );

  return (
    <section ref={root} id={SECTION.keys} className={styles.keys} aria-label="Your own keys">
      <div ref={bandOne} className={styles.band} aria-hidden="true">
        <Band providers={BAND_ONE} />
      </div>
      <div ref={bandTwo} className={`${styles.band} ${styles.band2}`} aria-hidden="true">
        <Band providers={BAND_TWO} />
      </div>
      <div className={`wrap ${styles.copy}`}>
        <h2 className="display">
          Your keys.
          <br />
          Your limits.
        </h2>
        <p>
          OpenAI, Anthropic, Gemini, DeepSeek, xAI or OpenRouter. Keys are encrypted with
          AES-256-GCM and only decrypted for the call. Every AI gets a daily spending limit, checked
          before each turn.
        </p>
      </div>
    </section>
  );
}

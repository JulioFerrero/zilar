'use client';

import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from '@/lib/gsap';
import { SECTION, TRIGGER } from '@/lib/sections';
import styles from './computer.module.css';

type Line = {
  prompt: boolean;
  dim: boolean;
  text: string;
  cursor?: boolean;
};

// Without JavaScript the whole terminal shows at once: the reveal is only
// applied by the timeline, so nothing is hidden by default.
const LINES: readonly Line[] = [
  { prompt: true, dim: false, text: 'ls' },
  { prompt: false, dim: true, text: 'notes.md  prices.py  report/' },
  { prompt: true, dim: false, text: 'python3 prices.py --week 42' },
  { prompt: false, dim: true, text: 'fetching through the proxy, 3 approved hosts' },
  { prompt: false, dim: true, text: 'wrote report/week-42.pdf (3 pages)' },
  { prompt: true, dim: false, text: 'sudo apt install htop' },
  { prompt: false, dim: true, text: 'sudo: not allowed in this sandbox' },
  { prompt: true, dim: false, text: '', cursor: true },
];

const FACTS = [
  'One gVisor sandbox per AI',
  'A /workspace that survives restarts',
  'No root',
  'The web only through a proxy, to sites you approved',
];

export function Computer() {
  const root = useRef<HTMLElement>(null);
  const text = useRef<HTMLPreElement>(null);

  useGSAP(
    () => {
      const section = root.current;
      const pre = text.current;
      if (section === null || pre === null) return;
      const lines = Array.from(pre.querySelectorAll<HTMLElement>(`.${styles.ln}`));
      if (lines.length === 0) return;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      gsap.set(lines, { clipPath: 'inset(0 100% 0 0)' });
      const timeline = gsap.timeline({
        scrollTrigger: {
          id: TRIGGER.computer,
          trigger: section,
          start: 'top top',
          end: '+=130%',
          pin: true,
          scrub: reduce ? true : 0.7,
        },
      });
      lines.forEach((line, index) => {
        timeline.to(
          line,
          {
            clipPath: 'inset(0 0% 0 0)',
            ease: 'steps(26)',
            duration: LINES[index]?.dim === true ? 0.25 : 0.6,
          },
          index === 0 ? 0 : '>',
        );
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} id={SECTION.computer} className={styles.computer} aria-label="AI computers">
      <div className={`wrap ${styles.inner}`}>
        <div>
          <div className="eyebrow">AI computers</div>
          <h2 className="display">Its own computer.</h2>
          <p>
            Give an AI a Linux machine on your server. It writes code, runs it and hands the files
            back in the chat.
          </p>
          <ul className={styles.facts}>
            {FACTS.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </div>
        <div className={styles.term}>
          <div className={styles.bar} aria-hidden="true">
            <i />
            <i />
            <i />
            <span>deepseek · /workspace</span>
          </div>
          <pre ref={text}>
            {LINES.map((line, index) => (
              <span key={index} className={line.dim ? `${styles.ln} ${styles.dim}` : styles.ln}>
                {line.prompt ? <span className={styles.pr}>$</span> : null}
                {line.prompt ? ' ' : null}
                {line.text}
                {line.cursor ? <span className={styles.cursor} /> : null}
              </span>
            ))}
          </pre>
        </div>
      </div>
    </section>
  );
}

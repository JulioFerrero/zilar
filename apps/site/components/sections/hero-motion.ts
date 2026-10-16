import { useGSAP } from '@gsap/react';
import type { RefObject } from 'react';
import { gsap } from '@/lib/gsap';
import { TRIGGER } from '@/lib/sections';
import styles from './hero.module.css';

const WHITESPACE = /^\s+$/;

// The CSS module is typed with an index signature, so `noUncheckedIndexedAccess`
// makes every lookup `string | undefined`. The classes below are written in the
// module by hand, so a miss is a bug worth failing on.
function cssClass(name: string): string {
  const value = styles[name];
  if (value === undefined) throw new Error(`Missing hero CSS class: ${name}`);
  return value;
}

const LINE = cssClass('ln');
const WORD = cssClass('wd');
const CHAR = cssClass('ch');

// Wrap one line's words in `.wd` and its letters in `.ch`, so the words never
// break mid-word and every letter can move on its own.
function splitLine(line: HTMLElement, wordClass: string, charClass: string): void {
  const words = (line.textContent ?? '')
    .split(/(\s+)/)
    .filter((part) => part !== '' && !WHITESPACE.test(part));
  line.textContent = '';
  words.forEach((word, index) => {
    const wrapper = document.createElement('span');
    wrapper.className = wordClass;
    for (const character of word) {
      const char = document.createElement('span');
      char.className = charClass;
      char.textContent = character;
      wrapper.appendChild(char);
    }
    line.appendChild(wrapper);
    if (index < words.length - 1) line.appendChild(document.createTextNode(' '));
  });
}

// The hero's intro and pinned breakup. The split runs here, after hydration, so
// the pre-rendered HTML stays plain text; without JavaScript it is never split.
export function useHeroMotion(scope: RefObject<HTMLElement | null>): void {
  useGSAP(
    () => {
      const root = scope.current;
      if (root === null) return;
      const title = root.querySelector<HTMLElement>('#hero-title');
      if (title === null) return;

      if (title.querySelector(`.${CHAR}`) === null) {
        for (const line of title.querySelectorAll<HTMLElement>(`.${LINE}`)) {
          splitLine(line, WORD, CHAR);
        }
      }

      const fade = ['#hero-lede', '#hero-cta', '#hero-meta']
        .map((selector) => root.querySelector<HTMLElement>(selector))
        .filter((element): element is HTMLElement => element !== null);

      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!reduce) {
        gsap.from(title.querySelectorAll(`.${CHAR}`), {
          yPercent: 115,
          duration: 1.2,
          ease: 'expo.out',
          stagger: 0.018,
          delay: 0.15,
        });
        gsap.from(fade, {
          y: 24,
          opacity: 0,
          duration: 1,
          ease: 'power3.out',
          stagger: 0.1,
          delay: 0.7,
        });
      }

      const lineChars = (index: number): Element[] => {
        const line = title.querySelectorAll<HTMLElement>(`.${LINE}`)[index];
        return line === undefined ? [] : Array.from(line.querySelectorAll(`.${CHAR}`));
      };

      gsap
        .timeline({
          scrollTrigger: {
            trigger: root,
            start: 'top top',
            end: '+=130%',
            pin: true,
            scrub: reduce ? true : 0.7,
            id: TRIGGER.hero,
          },
        })
        .to(
          lineChars(0),
          {
            yPercent: -120,
            opacity: 0,
            stagger: { each: 0.012, from: 'start' },
            duration: 0.5,
            ease: 'power2.in',
          },
          0,
        )
        .to(
          lineChars(1),
          {
            yPercent: -120,
            opacity: 0,
            stagger: { each: 0.012, from: 'end' },
            duration: 0.5,
            ease: 'power2.in',
          },
          0.06,
        )
        .to(
          lineChars(2),
          {
            yPercent: -120,
            opacity: 0,
            stagger: { each: 0.012, from: 'center' },
            duration: 0.5,
            ease: 'power2.in',
          },
          0.12,
        )
        .to(fade, { y: -40, opacity: 0, duration: 0.35, ease: 'power1.in' }, 0.05)
        .to({}, { duration: 0.6 });
    },
    { scope },
  );
}

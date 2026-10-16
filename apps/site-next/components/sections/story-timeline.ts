'use client';

import { useRef, type RefObject } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from '@/lib/gsap';
import { TRIGGER } from '@/lib/sections';

// The prototype's three runs of the routine (prototype.html:644). The values
// reach the DOM through element references, never through React state, so the
// scrub does not re-render on every scroll tick.
const FIRST_RUN = { ticks: ['$82,302', '$4,152', '7,744'], edited: 'edited 09:00' } as const;
const RUNS = [
  FIRST_RUN,
  { ticks: ['$82,418', '$4,149', '7,751'], edited: 'edited 09:05' },
  { ticks: ['$82,377', '$4,153', '7,749'], edited: 'edited 09:10' },
] as const;

export function useStoryTimeline(scope: RefObject<HTMLElement | null>): void {
  const lastRun = useRef(0);

  useGSAP(
    () => {
      const root = scope.current;
      if (root === null) return;

      const phone = root.querySelector<HTMLElement>('[data-phone]');
      const ask = root.querySelector<HTMLElement>('[data-ask]');
      const allowed = root.querySelector<HTMLElement>('[data-allowed]');
      const allowKey = root.querySelector<HTMLElement>('[data-allow]');
      const edited = root.querySelector<HTMLElement>('[data-edited]');

      const chapters = Array.from(root.querySelectorAll<HTMLElement>('[data-chapter]'));
      const panels = Array.from(root.querySelectorAll<HTMLElement>('[data-panel]'));
      const [chapter0, chapter1, chapter2, chapter3] = chapters;
      const [panel0, panel1, panel2, panel3] = panels;

      if (
        phone === null ||
        ask === null ||
        allowed === null ||
        allowKey === null ||
        edited === null ||
        chapter0 === undefined ||
        chapter1 === undefined ||
        chapter2 === undefined ||
        chapter3 === undefined ||
        panel0 === undefined ||
        panel1 === undefined ||
        panel2 === undefined ||
        panel3 === undefined
      ) {
        return;
      }

      const bars = Array.from(root.querySelectorAll<HTMLElement>('[data-bar]'));
      const ticks = Array.from(root.querySelectorAll<HTMLElement>('[data-tick]'));
      const panel0Items = Array.from(panel0.querySelectorAll<HTMLElement>('[data-bubble]'));
      const panel1Items = Array.from(panel1.querySelectorAll<HTMLElement>('[data-bubble]'));
      const panel1Steps = Array.from(panel1.querySelectorAll<HTMLElement>('[data-step]'));

      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      gsap.set(chapters.slice(1), { autoAlpha: 0, y: 30 });
      gsap.set(panels.slice(1), { autoAlpha: 0, y: 40 });
      gsap.set(panel0Items, { autoAlpha: 0, y: 14 });
      gsap.set([...panel1Items, ...panel1Steps], { autoAlpha: 0, y: 14 });
      gsap.set(allowed, { autoAlpha: 0, height: 0, paddingTop: 0, paddingBottom: 0 });
      if (!reduce) gsap.set(phone, { rotateY: -14, rotateX: 4 });

      const timeline = gsap.timeline({
        scrollTrigger: {
          id: TRIGGER.story,
          trigger: root,
          start: 'top top',
          end: '+=440%',
          pin: true,
          scrub: reduce ? true : 0.7,
          onUpdate: (self) => {
            const progress = self.progress;
            const k = progress < 0.8 ? 0 : Math.min(2, Math.floor((progress - 0.8) / 0.065));
            if (k !== lastRun.current) {
              lastRun.current = k;
              const run = RUNS[k] ?? FIRST_RUN;
              ticks.forEach((el, index) => {
                const value = run.ticks[index];
                if (value === undefined) return;
                el.textContent = value;
                el.setAttribute('data-flash', '');
                gsap.delayedCall(0.42, () => {
                  el.removeAttribute('data-flash');
                });
              });
              edited.textContent = run.edited;
            }
            bars.forEach((bar, index) => {
              const chapter = Math.floor(index / 4);
              const step = index % 4;
              const filled = Math.max(0, Math.min(1, progress * 4 - chapter));
              bar.style.transform = `scaleX(${step < chapter ? 1 : step === chapter ? filled : 0})`;
            });
          },
        },
      });

      if (!reduce) {
        timeline
          .to(phone, { rotateY: 8, rotateX: 2, duration: 2, ease: 'sine.inOut' }, 0)
          .to(phone, { rotateY: -8, rotateX: 3, duration: 2.4, ease: 'sine.inOut' }, 2)
          .to(
            phone,
            { rotateY: 0, rotateX: 0, scale: 1.04, duration: 1.2, ease: 'sine.inOut' },
            4.4,
          )
          .to(phone, { rotateY: 10, rotateX: 2, scale: 1, duration: 2.2, ease: 'sine.inOut' }, 6.9);
      }

      timeline
        .to(panel0Items, { autoAlpha: 1, y: 0, stagger: 0.22, duration: 0.4 }, 0)
        .to(chapter0, { autoAlpha: 0, y: -30, duration: 0.4 }, 2)
        .to(panel0, { autoAlpha: 0, y: -40, duration: 0.4 }, 2)
        .to(chapter1, { autoAlpha: 1, y: 0, duration: 0.4 }, 2.3)
        .to(panel1, { autoAlpha: 1, y: 0, duration: 0.4 }, 2.3)
        .to(panel1Items, { autoAlpha: 1, y: 0, stagger: 0.35, duration: 0.4 }, 2.6)
        .to(panel1Steps, { autoAlpha: 1, y: 0, stagger: 0.3, duration: 0.3 }, 3)
        .to(chapter1, { autoAlpha: 0, y: -30, duration: 0.4 }, 4.4)
        .to(panel1, { autoAlpha: 0, y: -40, duration: 0.4 }, 4.4)
        .to(chapter2, { autoAlpha: 1, y: 0, duration: 0.4 }, 4.7)
        .to(panel2, { autoAlpha: 1, y: 0, duration: 0.4 }, 4.7)
        .fromTo(
          ask,
          { scale: 0.88, autoAlpha: 0 },
          { scale: 1, autoAlpha: 1, duration: 0.5, ease: 'back.out(1.6)' },
          4.9,
        )
        .to(allowKey, { scale: 0.93, duration: 0.15 }, 5.8)
        .to(allowKey, { scale: 1, duration: 0.15 }, 5.95)
        .to(ask, { autoAlpha: 0, height: 0, paddingTop: 0, paddingBottom: 0, duration: 0.4 }, 6.15)
        .to(
          allowed,
          { autoAlpha: 1, height: 'auto', paddingTop: 12, paddingBottom: 12, duration: 0.4 },
          6.2,
        )
        .to(chapter2, { autoAlpha: 0, y: -30, duration: 0.4 }, 6.9)
        .to(panel2, { autoAlpha: 0, y: -40, duration: 0.4 }, 6.9)
        .to(chapter3, { autoAlpha: 1, y: 0, duration: 0.4 }, 7.2)
        .to(panel3, { autoAlpha: 1, y: 0, duration: 0.4 }, 7.2)
        .to({}, { duration: 1.7 }, 7.6);
    },
    { scope },
  );
}

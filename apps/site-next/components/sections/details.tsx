'use client';

import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from '@/lib/gsap';
import { SECTION, TRIGGER } from '@/lib/sections';
import {
  AuditDemo,
  KillSwitchDemo,
  LimitDemo,
  SearchDemo,
  StickerDemo,
  TopicsDemo,
  UpdaterDemo,
  VoiceDemo,
} from './details-demos';
import styles from './details.module.css';

// The prototype's eight cards, copy included (prototype.html:477).
const CARDS = [
  {
    demo: <TopicsDemo />,
    heading: 'Topics',
    body: 'Each group splits into topics, public or private. You see at a glance where an AI is working.',
  },
  {
    demo: <VoiceDemo />,
    heading: 'Voice notes, transcribed on the phone',
    body: 'A 17 MB model runs on your Android phone. Offline, private and free.',
  },
  {
    demo: <SearchDemo />,
    heading: 'Search that forgives typos',
    body: 'Every chat and topic, straight to the message.',
  },
  {
    demo: <StickerDemo />,
    heading: 'Stickers from your photos',
    body: 'Make a pack in seconds, or bring your packs over from Telegram.',
  },
  {
    demo: <LimitDemo />,
    heading: 'A daily limit per AI',
    body: "At the limit it stops. If usage can't be read, it stops too.",
  },
  {
    demo: <KillSwitchDemo />,
    heading: 'Kill switch',
    body: 'One tap stops an AI everywhere at once. Resume brings it back.',
  },
  {
    demo: <AuditDemo />,
    heading: 'An audit log nobody can edit',
    body: 'The database itself refuses updates and deletes. It keeps ids, never what was said.',
  },
  {
    demo: <UpdaterDemo />,
    heading: 'An app that updates itself',
    body: 'Install the Android app once. New versions download on Wi-Fi and ask to install.',
  },
];

export function Details() {
  const scope = useRef<HTMLElement>(null);
  const pin = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const pinElement = pin.current;
      const trackElement = track.current;
      if (pinElement === null || trackElement === null) return;

      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const distance = () => Math.max(0, trackElement.scrollWidth - window.innerWidth);

      gsap.to(trackElement, {
        x: () => -distance(),
        ease: 'none',
        scrollTrigger: {
          id: TRIGGER.details,
          trigger: pinElement,
          start: 'top top',
          end: () => `+=${Math.max(distance(), window.innerHeight * 0.6)}`,
          pin: true,
          scrub: reduce ? true : 0.7,
          invalidateOnRefresh: true,
        },
      });
    },
    { scope },
  );

  return (
    <section ref={scope} className={styles.strip} aria-label="Details">
      <div ref={pin} id={SECTION.details} className={styles.pin}>
        <div className={`wrap ${styles.head}`}>
          <div className="eyebrow">Details</div>
          <h2 className="display">The rest is already there.</h2>
        </div>
        <div ref={track} className={`wrap ${styles.track}`}>
          {CARDS.map((card) => (
            <article className={styles.feat} key={card.heading}>
              {card.demo}
              <h3>{card.heading}</h3>
              <p>{card.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

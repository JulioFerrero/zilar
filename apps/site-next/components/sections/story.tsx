'use client';

import { useRef } from 'react';
import { SECTION } from '@/lib/sections';
import { StoryPhone } from './story-phone';
import { useStoryTimeline } from './story-timeline';
import styles from './story.module.css';

const CHAPTERS = [
  {
    eyebrow: 'Chat',
    heading: 'A messenger first.',
    body: 'Groups split into topics. Replies, reactions, voice notes and stickers, on the web and on Android.',
  },
  {
    eyebrow: 'AIs',
    heading: 'AIs are members.',
    body: 'Add one like a friend. Mention it, and it works in the open, one step at a time.',
  },
  {
    eyebrow: 'Approvals',
    heading: 'Nothing risky without a yes.',
    body: "New sites and routines wait for an owner's tap. Approvals expire, and each one works once.",
  },
  {
    eyebrow: 'Routines',
    heading: 'Ask once. It keeps the habit.',
    body: 'It writes a small tool, runs it in a sandbox and edits one message each run. Three failures in a row and it pauses itself.',
  },
];

export function Story() {
  const scope = useRef<HTMLElement>(null);
  useStoryTimeline(scope);

  return (
    <section ref={scope} id={SECTION.story} className={styles.stage} aria-label="How it works">
      <div className={`wrap ${styles.stageIn}`}>
        <div className={styles.chapters}>
          {CHAPTERS.map((chapter) => (
            <article className={styles.chapter} data-chapter key={chapter.eyebrow}>
              <div className={styles.steps} aria-hidden="true">
                {[0, 1, 2, 3].map((step) => (
                  <span key={step}>
                    <i data-bar />
                  </span>
                ))}
              </div>
              <div className="eyebrow">{chapter.eyebrow}</div>
              <h2 className="display">{chapter.heading}</h2>
              <p>{chapter.body}</p>
            </article>
          ))}
        </div>
        <StoryPhone />
      </div>
    </section>
  );
}

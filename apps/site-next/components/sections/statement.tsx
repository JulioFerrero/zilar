'use client';

import { useGSAP } from '@gsap/react';
import { useRef } from 'react';
import { gsap } from '@/lib/gsap';
import { SECTION } from '@/lib/sections';
import styles from './statement.module.css';

const WHITESPACE = /^\s+$/;

// The CSS module is typed with an index signature, so `noUncheckedIndexedAccess`
// makes every lookup `string | undefined`. The classes below are written in the
// module by hand, so a miss is a bug worth failing on.
function cssClass(name: string): string {
  const value = styles[name];
  if (value === undefined) throw new Error(`Missing statement CSS class: ${name}`);
  return value;
}

const WORD = cssClass('w');
const GOLD = cssClass('gold');

function wrapWords(text: string, wordClass: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const part of text.split(/(\s+)/)) {
    if (part === '' || WHITESPACE.test(part)) {
      fragment.appendChild(document.createTextNode(part));
      continue;
    }
    const word = document.createElement('span');
    word.className = wordClass;
    word.textContent = part;
    fragment.appendChild(word);
  }
  return fragment;
}

// One `.w` span per word, recursively through inline elements. A `data-gold`
// element marks its words gold.
function splitWords(node: Node, wordClass: string, goldClass: string): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      node.replaceChild(wrapWords(child.textContent ?? '', wordClass), child);
      continue;
    }
    if (child.nodeType === Node.ELEMENT_NODE) {
      const element = child as HTMLElement;
      const gold = element.dataset.gold !== undefined;
      splitWords(element, wordClass, goldClass);
      if (gold) {
        for (const word of element.querySelectorAll(`.${wordClass}`)) {
          word.classList.add(goldClass);
        }
      }
    }
  }
}

export function Statement() {
  const root = useRef<HTMLElement | null>(null);
  const paragraph = useRef<HTMLParagraphElement | null>(null);

  useGSAP(
    () => {
      const target = paragraph.current;
      if (target === null) return;

      // The split runs after hydration, so the pre-rendered paragraph stays
      // plain text for search engines and no-JS visitors.
      if (target.querySelector(`.${WORD}`) === null) {
        splitWords(target, WORD, GOLD);
      }

      gsap.fromTo(
        target.querySelectorAll(`.${WORD}`),
        { opacity: 0.12 },
        {
          opacity: 1,
          stagger: 0.05,
          ease: 'none',
          scrollTrigger: {
            trigger: target,
            start: 'top 78%',
            end: 'bottom 45%',
            scrub: true,
          },
        },
      );
    },
    { scope: root },
  );

  return (
    <section
      id={SECTION.statement}
      ref={root}
      className={`${styles.statement} wrap`}
      aria-label="Ownership"
    >
      <p ref={paragraph}>
        Messages, files and keys live on the server you run. AIs use{' '}
        <span data-gold>your own provider keys</span> and only see the chats you add them to.
      </p>
    </section>
  );
}

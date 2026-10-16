'use client';

import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from '@/lib/gsap';
import { SECTION } from '@/lib/sections';
import { CopyCommand } from './copy-command';
import styles from './install.module.css';

const REQUIREMENTS = [
  { title: 'A server', body: 'Linux with Docker and its Compose plugin' },
  { title: 'A domain', body: 'An A record pointing at it, ports 80 and 443 open' },
  { title: 'Email', body: 'An SMTP account for sign-in codes. There are no passwords.' },
];

const ANDROID_RELEASE = 'https://github.com/JulioFerrero/zilar/releases/latest';

export function Install() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const section = root.current;
      if (section === null) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      gsap.from(section.querySelectorAll<HTMLElement>(`.${styles.rise}`), {
        y: 40,
        opacity: 0,
        stagger: 0.12,
        duration: 0.9,
        ease: 'power2.out',
        scrollTrigger: { trigger: section, start: 'top 75%' },
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} id={SECTION.install} className={styles.install} aria-label="Run your own">
      <div className={`wrap ${styles.inner}`}>
        <div className={styles.rise}>
          <div className="eyebrow">Run your own</div>
          <h2 className="display">
            One line.
            <br />
            Your server.
          </h2>
          <p>
            The chat, the web app, the database and the HTTPS certificate, on one small Linux
            server. Open source under the MIT license, and still early.
          </p>
        </div>
        <div className={styles.rise}>
          <CopyCommand />
          <ul className={styles.need}>
            {REQUIREMENTS.map((requirement) => (
              <li key={requirement.title}>
                <b>{requirement.title}</b>
                {requirement.body}
              </li>
            ))}
          </ul>
          <div className={styles.android}>
            <div>
              <b>Android app</b>
              <span>Signed builds on GitHub. Install once, then it updates itself.</span>
            </div>
            <a className="key key-primary" href={ANDROID_RELEASE}>
              Download
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

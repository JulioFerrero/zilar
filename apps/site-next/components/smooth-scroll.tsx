'use client';

// effect-plain: DOM/scroll wiring for the landing; the Promise edge is document.fonts.ready, not app logic.
import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { gsap, ScrollTrigger } from '@/lib/gsap';
import Lenis from 'lenis';

// The Lenis instance lives outside React: the provider creates it on mount and
// consumers read it through `useLenis()`. `useSyncExternalStore` re-renders them
// once it exists, without a setState inside an effect.
let currentLenis: Lenis | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Lenis | null {
  return currentLenis;
}

function getServerSnapshot(): Lenis | null {
  return null;
}

function setCurrentLenis(value: Lenis | null): void {
  currentLenis = value;
  for (const listener of listeners) listener();
}

const LenisContext = createContext<Lenis | null>(null);

export function useLenis(): Lenis | null {
  return useContext(LenisContext);
}

export function SmoothScroll({ children }: { children: ReactNode }) {
  const lenis = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let instance: Lenis | null = null;
    const tick = (time: number) => {
      instance?.raf(time * 1000);
    };
    if (!reduce) {
      instance = new Lenis({ lerp: 0.085, smoothWheel: true });
      instance.on('scroll', () => ScrollTrigger.update());
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
      setCurrentLenis(instance);
    }

    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'));
    const onClick = (event: MouseEvent) => {
      const anchor = event.currentTarget as HTMLAnchorElement;
      const href = anchor.getAttribute('href');
      if (href === null || href.length < 2) return;
      const target = document.querySelector<HTMLElement>(href);
      if (target === null) return;
      event.preventDefault();
      if (instance !== null) instance.scrollTo(target, { duration: 1.8 });
      else target.scrollIntoView();
    };
    for (const anchor of anchors) anchor.addEventListener('click', onClick);

    const progress = gsap.to('#progress', {
      scaleX: 1,
      ease: 'none',
      scrollTrigger: { start: 0, end: 'max', scrub: true },
    });

    // The display font changes the measured heights once it loads, and the last
    // sections settle after window load, so measure again on both.
    const onLoad = () => {
      ScrollTrigger.refresh();
    };
    void document.fonts.ready.then(onLoad);
    if (document.readyState === 'complete') {
      onLoad();
    } else {
      window.addEventListener('load', onLoad, { once: true });
    }

    return () => {
      for (const anchor of anchors) anchor.removeEventListener('click', onClick);
      window.removeEventListener('load', onLoad);
      progress.kill();
      if (instance !== null) {
        instance.destroy();
        gsap.ticker.remove(tick);
        setCurrentLenis(null);
      }
    };
  }, []);

  return <LenisContext.Provider value={lenis}>{children}</LenisContext.Provider>;
}

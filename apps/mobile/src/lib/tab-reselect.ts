import { useEffect, useRef } from 'react';

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

/**
 * Tells the active tab's list to scroll back to the top (T-1969). Tapping a
 * tab that is already selected does not navigate, so it reuses the tap instead,
 * like Telegram and WhatsApp.
 */
export function emitTabReselect(name: string): void {
  const set = listeners.get(name);
  if (set === undefined) {
    return;
  }
  for (const listener of set) {
    listener();
  }
}

/** Subscribes to re-taps of tab `name`; the returned function unsubscribes. */
export function onTabReselect(name: string, fn: Listener): () => void {
  let set = listeners.get(name);
  if (set === undefined) {
    set = new Set();
    listeners.set(name, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) {
      listeners.delete(name);
    }
  };
}

/**
 * Runs `scrollToTop` when the bar's tab for `name` is tapped while it is
 * active. `name` is undefined for the shared shells' sub-screens, which do not
 * scroll on a root tab's re-tap.
 */
export function useScrollToTopOnReselect(name: string | undefined, scrollToTop: () => void): void {
  const handler = useRef(scrollToTop);
  useEffect(() => {
    handler.current = scrollToTop;
  }, [scrollToTop]);
  useEffect(() => {
    if (name === undefined) {
      return;
    }
    return onTabReselect(name, () => {
      handler.current();
    });
  }, [name]);
}

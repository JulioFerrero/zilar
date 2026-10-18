import { useEffect, useRef } from 'react';

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

/**
 * Tapping the active tab does not navigate, so it reuses the tap to scroll back to the top, like Telegram.
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
 * `name` is undefined for the shared shells' sub-screens, which do not scroll on a root tab's re-tap.
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

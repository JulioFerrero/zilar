import { Effect } from 'effect';
import { useEffect, useSyncExternalStore } from 'react';
import { isBlockedSender, localpartOf } from '@zilar/chat-core';
import { fromApi } from '@/lib/effect/api-effect';
import { listBlockedUsers } from './api';

export { isBlockedSender };

// The lowercased localparts I blocked, kept outside React so every
// MessageList reads the same set without a prop chain. Loads lazily on
// first use and on window focus; a failed load keeps the last good set so
// a flaky network never unhides someone's messages.
let blocked: ReadonlySet<string> = new Set();
// True while the first-use load runs, so mounting many rows loads once.
let loading = false;
let focusListening = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

// One reload. It never fails: any failure keeps the last good set.
const loadBlocked: Effect.Effect<void> = fromApi(() => listBlockedUsers()).pipe(
  Effect.map((people) => {
    const next = new Set<string>();
    for (const person of people) {
      if (person.jid !== null && person.jid.trim() !== '') {
        next.add(localpartOf(person.jid.trim()));
      }
    }
    blocked = next;
    emit();
  }),
  Effect.catchCause(() => Effect.void),
);

const reload = (): Promise<void> => Effect.runPromise(loadBlocked);

function loadOnce(): void {
  if (loading) {
    return;
  }
  loading = true;
  void Effect.runPromise(
    loadBlocked.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          loading = false;
        }),
      ),
    ),
  );
}

function ensureFocusListener(): void {
  if (focusListening || typeof window === 'undefined') {
    return;
  }
  focusListening = true;
  window.addEventListener('focus', () => {
    void reload();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ReadonlySet<string> {
  return blocked;
}

/** The lowercased localparts I blocked; starts loading on first use. */
export function useBlockedJids(): ReadonlySet<string> {
  useEffect(() => {
    ensureFocusListener();
    loadOnce();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Reload the set after a successful block or unblock. */
export function refreshBlockedJids(): Promise<void> {
  return reload();
}

/** Test-only: reset the module state between tests. */
export function resetBlockedJidsForTests(): void {
  blocked = new Set();
  loading = false;
  focusListening = false;
  listeners.clear();
}

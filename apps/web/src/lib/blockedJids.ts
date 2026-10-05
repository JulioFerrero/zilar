import { useEffect, useSyncExternalStore } from 'react';
import { isBlockedSender, localpartOf } from '@zilar/chat-core';
import { listBlockedUsers } from './api';

export { isBlockedSender };

// The lowercased localparts I blocked, kept outside React so every
// MessageList reads the same set without a prop chain. Loads lazily on
// first use and on window focus; a failed load keeps the last good set so
// a flaky network never unhides someone's messages.
let blocked: ReadonlySet<string> = new Set();
let loading: Promise<void> | undefined;
let focusListening = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

async function load(): Promise<void> {
  try {
    const people = await listBlockedUsers();
    const next = new Set<string>();
    for (const person of people) {
      if (person.jid !== null && person.jid.trim() !== '') {
        next.add(localpartOf(person.jid.trim()));
      }
    }
    blocked = next;
    emit();
  } catch {
    // Keep the last good set.
  }
}

function ensureFocusListener(): void {
  if (focusListening || typeof window === 'undefined') {
    return;
  }
  focusListening = true;
  window.addEventListener('focus', () => {
    void load();
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
    if (loading === undefined) {
      loading = load().finally(() => {
        loading = undefined;
      });
    }
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Reload the set after a successful block or unblock. */
export async function refreshBlockedJids(): Promise<void> {
  await load();
}

/** Test-only: reset the module state between tests. */
export function resetBlockedJidsForTests(): void {
  blocked = new Set();
  loading = undefined;
  focusListening = false;
  listeners.clear();
}

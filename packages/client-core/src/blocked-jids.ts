// effect-plain: a React hook; the store is module state so every row reads the same set
import { localpartOf } from '@zilar/chat-core';
import { useEffect, useSyncExternalStore } from 'react';

export interface BlockedJidPerson {
  readonly jid: string | null;
}

export interface BlockedJidsStoreOptions {
  // A failed load keeps the last good set.
  load(): Promise<readonly BlockedJidPerson[]>;
  // Called once, on first use, to register the platform's refresh trigger.
  watchRefresh(refresh: () => void): void;
}

export interface BlockedJidsStore {
  useBlockedJids(): ReadonlySet<string>;
  refresh(): Promise<void>;
  snapshot(): ReadonlySet<string>;
  resetForTests(): void;
}

export function makeBlockedJidsStore({
  load,
  watchRefresh,
}: BlockedJidsStoreOptions): BlockedJidsStore {
  let blocked: ReadonlySet<string> = new Set();
  let loading = false;
  let watching = false;
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  async function refresh(): Promise<void> {
    try {
      const people = await load();
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

  function loadOnce(): void {
    if (loading) {
      return;
    }
    loading = true;
    void refresh().finally(() => {
      loading = false;
    });
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function useBlockedJids(): ReadonlySet<string> {
    useEffect(() => {
      if (!watching) {
        watching = true;
        watchRefresh(() => {
          void refresh();
        });
      }
      loadOnce();
    }, []);
    return useSyncExternalStore(subscribe, () => blocked);
  }

  return {
    useBlockedJids,
    refresh,
    snapshot: () => blocked,
    resetForTests: () => {
      blocked = new Set();
      loading = false;
      watching = false;
      listeners.clear();
    },
  };
}

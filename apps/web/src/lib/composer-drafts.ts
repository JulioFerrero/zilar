import { Effect, Schema } from 'effect';
import { useCallback, useSyncExternalStore } from 'react';
import { useChatSelector } from '@/store/ChatStoreProvider';

/**
 * Per-chat composer drafts (T-1170, WUX-3). Kept outside React so switching
 * chats — which unmounts the composer — does not lose the text, and so the
 * chat list can read the draft of a chat that is not open. Persisted in
 * `localStorage`, one entry per user, capped, as Telegram does it.
 */

const MAX_DRAFTS = 200;
const MAX_DRAFT_LENGTH = 4000;
const WRITE_DELAY_MS = 300;

// The stored value is a JSON object of `chatId -> text`; anything else reads
// as empty.
const decodeStoredDrafts = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
);

/**
 * Runs one localStorage step at this sync edge. A blocked or missing storage
 * gives `fallback`, so composing keeps working without it.
 */
function storageStep<A>(fallback: A, step: (storage: Storage) => A): A {
  return Effect.runSync(
    Effect.try(() => step(window.localStorage)).pipe(Effect.orElseSucceed(() => fallback)),
  );
}

function draftsKey(userId: string): string {
  return `zilar:composerDrafts:${userId}`;
}

// The current user's drafts, keyed by chat id. An empty user id scopes to no
// user: nothing is read or written until the store reports one.
let scopedUserId = '';
let drafts = new Map<string, string>();
const listeners = new Set<() => void>();
let writeTimer: ReturnType<typeof setTimeout> | undefined;
let pendingUserId = '';
let pendingSnapshot: Map<string, string> | undefined;

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function readDrafts(userId: string): Map<string, string> {
  const raw = storageStep<string | null>(null, (storage) => storage.getItem(draftsKey(userId)));
  if (raw === null) {
    return new Map();
  }
  // A corrupt or blocked storage must never break composing.
  const stored = Effect.runSync(
    Effect.try(() => decodeStoredDrafts(raw)).pipe(Effect.orElseSucceed(() => ({}))),
  );
  const entries = Object.entries(stored)
    .filter(([, text]) => text.length > 0)
    .slice(-MAX_DRAFTS);
  return new Map(entries.map(([id, text]) => [id, text.slice(0, MAX_DRAFT_LENGTH)]));
}

function persist(userId: string, snapshot: Map<string, string>): void {
  if (userId === '') {
    return;
  }
  const payload = JSON.stringify(Object.fromEntries(snapshot));
  // Ignore a full or blocked storage, like the topics UI does.
  storageStep<void>(undefined, (storage) => {
    storage.setItem(draftsKey(userId), payload);
  });
}

// Writes the pending draft now, if any. An account switch flushes the user
// leaving, so a keystroke in the last 300 ms is not lost when the new user's
// first change reschedules the single timer.
function flushPersist(): void {
  if (writeTimer === undefined || pendingSnapshot === undefined) {
    return;
  }
  clearTimeout(writeTimer);
  writeTimer = undefined;
  const snapshot = pendingSnapshot;
  pendingSnapshot = undefined;
  persist(pendingUserId, snapshot);
}

// The debounce is per user: the user and the map are captured when the write is
// scheduled, so a switch inside the window still writes the old user's drafts
// to their key (flushed on the switch), and the new user gets their own timer.
function schedulePersist(): void {
  if (writeTimer !== undefined) {
    clearTimeout(writeTimer);
  }
  pendingUserId = scopedUserId;
  pendingSnapshot = new Map(drafts);
  writeTimer = setTimeout(() => {
    writeTimer = undefined;
    const snapshot = pendingSnapshot;
    pendingSnapshot = undefined;
    if (snapshot !== undefined) {
      persist(pendingUserId, snapshot);
    }
  }, WRITE_DELAY_MS);
}

// Scoping to a new user loads their drafts once. The hook below calls it
// during render, before its snapshot is read, so the first paint already shows
// the stored draft.
function scopeToUser(nextUserId: string): void {
  if (nextUserId === scopedUserId) {
    return;
  }
  // Persist the user we are leaving before their timer can be replaced by the
  // new user's first keystroke.
  flushPersist();
  scopedUserId = nextUserId;
  drafts = nextUserId === '' ? new Map() : readDrafts(nextUserId);
}

/** The stored draft for `chatId`, or `""` when there is none. */
export function getDraft(chatId: string): string {
  return drafts.get(chatId) ?? '';
}

/**
 * Stores `chatId`'s draft; an empty text deletes it. A draft longer than
 * `MAX_DRAFT_LENGTH` is truncated and the oldest is evicted past `MAX_DRAFTS`,
 * so one chat can never fill storage.
 */
export function setDraft(chatId: string, text: string): void {
  const next = text.length > MAX_DRAFT_LENGTH ? text.slice(0, MAX_DRAFT_LENGTH) : text;
  if (next === '') {
    if (!drafts.delete(chatId)) {
      return;
    }
  } else {
    if (drafts.get(chatId) === next) {
      return;
    }
    // Re-insert so the newest draft is last, evicting the oldest past the cap.
    drafts.delete(chatId);
    if (drafts.size >= MAX_DRAFTS) {
      const oldest = drafts.keys().next().value;
      if (oldest !== undefined) {
        drafts.delete(oldest);
      }
    }
    drafts.set(chatId, next);
  }
  schedulePersist();
  emit();
}

/** Subscribes to draft changes; used by `useSyncExternalStore` and tests. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current user's draft for `chatId`; re-renders on every change. */
export function useComposerDraft(chatId: string): string {
  const currentUserId = useChatSelector((s) => s.currentUserId);
  // Adjust the module store during render (React's "adjust state when a prop
  // changes"): a different user's drafts are loaded in the same pass.
  scopeToUser(currentUserId);
  const getSnapshot = useCallback(() => getDraft(chatId), [chatId]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

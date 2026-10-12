import { Effect, Schema } from 'effect';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { useChatStore } from '@/store/chat-store-provider';

/**
 * Per-chat composer drafts on mobile (T-1181, MUX-4), the twin of the web
 * store in `apps/web/src/lib/composer-drafts.ts`. Kept outside React so
 * switching chats — which unmounts the composer — does not lose the text, and
 * so the chat list can show the draft of a chat that is not open.
 *
 * Drafts are scoped to the signed-in user and persisted to one JSON file under
 * the app's documents directory, read once and written debounced. A read or
 * write error only costs the persistence: the in-memory drafts keep working.
 */

const MAX_DRAFTS = 200;
const MAX_DRAFT_LENGTH = 4000;
const WRITE_DELAY_MS = 500;
const FILE_NAME = 'zilar-composer-drafts.json';

/** One user's drafts (`chatId -> text`). */
type DraftMap = Map<string, string>;

// The stored file is `userId -> { chatId: text }`; anything else reads as
// empty, so a corrupt or truncated file can never break composing.
const decodeStoredDrafts = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String))),
);

/** Reads the drafts file; a missing file or a platform without a documents
 * directory resolves to null. */
async function readStoredFile(): Promise<string | null> {
  try {
    const { documentDirectory, readAsStringAsync } = await import('expo-file-system/legacy');
    if (documentDirectory === null) {
      return null;
    }
    return await readAsStringAsync(documentDirectory + FILE_NAME);
  } catch {
    return null;
  }
}

/** Writes the drafts file; a read-only or full disk is ignored, so the
 * in-memory drafts keep working. */
async function writeStoredFile(contents: string): Promise<void> {
  try {
    const { documentDirectory, writeAsStringAsync } = await import('expo-file-system/legacy');
    if (documentDirectory === null) {
      return;
    }
    await writeAsStringAsync(documentDirectory + FILE_NAME, contents);
  } catch {
    // Ignore the failure: composing must not depend on the file.
  }
}

// The current user's drafts, keyed by chat id. An empty user id scopes to no
// user: nothing is read or written until the store reports one.
let scopedUserId = '';
let drafts: DraftMap = new Map();
// Every user's drafts as last read or written, so persisting one user never
// drops the others.
let storedAll: Record<string, DraftMap> = {};
const listeners = new Set<() => void>();
let writeTimer: ReturnType<typeof setTimeout> | undefined;
let pendingUserId = '';
let pendingSnapshot: DraftMap | undefined;
let loadPromise: Promise<void> | undefined;
// The file has been read once, so later switches can scope from memory.
let loaded = false;
// The user whose drafts are currently merged into `drafts`; `undefined` until
// the first file read resolves for them.
let hydratedFor: string | undefined;

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Turns the raw file into per-user maps, dropping hostile or oversized data. */
function decodeFile(raw: string | null): Record<string, DraftMap> {
  if (raw === null) {
    return {};
  }
  const parsed = Effect.runSync(
    Effect.try(() => decodeStoredDrafts(raw)).pipe(Effect.orElseSucceed(() => ({}))),
  );
  const decoded: Record<string, DraftMap> = {};
  for (const [userId, byChat] of Object.entries(parsed)) {
    const entries = Object.entries(byChat)
      .filter(([, text]) => text.length > 0)
      .slice(-MAX_DRAFTS);
    decoded[userId] = new Map(
      entries.map(([chatId, text]) => [chatId, text.slice(0, MAX_DRAFT_LENGTH)]),
    );
  }
  return decoded;
}

/** Reads the file once; later calls share the same promise. */
function ensureLoaded(): Promise<void> {
  loadPromise ??= readStoredFile().then(
    (raw) => {
      storedAll = decodeFile(raw);
      loaded = true;
    },
    () => undefined,
  );
  return loadPromise;
}

// Writes the pending draft now, if any. An account switch flushes the user
// leaving, so a keystroke in the last 500 ms is not lost when the new user's
// first change reschedules the single timer.
function flushPersist(): void {
  if (writeTimer === undefined || pendingSnapshot === undefined) {
    return;
  }
  clearTimeout(writeTimer);
  writeTimer = undefined;
  const snapshot = pendingSnapshot;
  const userId = pendingUserId;
  pendingSnapshot = undefined;
  persist(userId, snapshot);
}

function persist(userId: string, snapshot: DraftMap): void {
  if (userId === '') {
    return;
  }
  storedAll[userId] = new Map(snapshot);
  const payload: Record<string, Record<string, string>> = {};
  for (const [id, map] of Object.entries(storedAll)) {
    payload[id] = Object.fromEntries(map);
  }
  void writeStoredFile(JSON.stringify(payload));
}

// The debounce is per user: the user and the map are captured when the write
// is scheduled, so a switch inside the window still writes the old user's
// drafts to their entry (flushed on the switch).
function schedulePersist(): void {
  if (writeTimer !== undefined) {
    clearTimeout(writeTimer);
  }
  pendingUserId = scopedUserId;
  pendingSnapshot = new Map(drafts);
  writeTimer = setTimeout(() => {
    writeTimer = undefined;
    const snapshot = pendingSnapshot;
    const userId = pendingUserId;
    pendingSnapshot = undefined;
    if (snapshot !== undefined) {
      persist(userId, snapshot);
    }
  }, WRITE_DELAY_MS);
}

/**
 * Scopes to a user synchronously, called during render (React's "adjust state
 * when a prop changes", the same way web's store does), so the first paint of a
 * newly signed-in user can never show the previous user's text: the old user's
 * map is dropped before the snapshot is read. Once the file has been read, the
 * new user's drafts come straight from memory.
 */
export function scopeToUser(nextUserId: string): void {
  if (nextUserId === scopedUserId) {
    return;
  }
  flushPersist();
  scopedUserId = nextUserId;
  hydratedFor = loaded ? nextUserId : undefined;
  drafts = loaded ? new Map(storedAll[nextUserId] ?? []) : new Map();
}

/**
 * Reads the file on the first switch to a user and emits, so the composer and
 * the chat rows re-read. It always emits, also when the user has no stored
 * drafts: a subscriber that scoped to an empty map must still be told to
 * render, or it keeps the previous user's snapshot.
 */
export async function loadScopedDrafts(nextUserId: string): Promise<void> {
  if (hydratedFor === nextUserId) {
    return;
  }
  await ensureLoaded();
  if (scopedUserId !== nextUserId || hydratedFor === nextUserId) {
    return;
  }
  // Keep anything typed while the file was being read.
  const merged = new Map(storedAll[nextUserId] ?? []);
  for (const [chatId, text] of drafts) {
    merged.set(chatId, text);
  }
  drafts = merged;
  hydratedFor = nextUserId;
  emit();
}

/** The stored draft for `chatId`, or `""` when there is none. */
export function getDraft(chatId: string): string {
  return drafts.get(chatId) ?? '';
}

/**
 * Stores `chatId`'s draft; an empty text deletes it. A draft longer than
 * `MAX_DRAFT_LENGTH` is truncated and the oldest is evicted past `MAX_DRAFTS`,
 * so one chat can never fill the file.
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
export function useComposerDraft(chatId: string | undefined): string {
  const currentUserId = useChatStore((state) => state.currentUserId);
  // Adjust the module store during render (React's "adjust state when a prop
  // changes"): the first paint after a switch already reads the new user's
  // (empty until loaded) drafts, never the previous user's text.
  scopeToUser(currentUserId);
  const getSnapshot = useCallback(() => (chatId === undefined ? '' : getDraft(chatId)), [chatId]);
  const value = useSyncExternalStore(subscribe, getSnapshot);
  // The file read is async, so the first switch to a user fills their drafts
  // in here; later switches have already scoped from memory.
  useEffect(() => {
    void loadScopedDrafts(currentUserId);
  }, [currentUserId]);
  return value;
}

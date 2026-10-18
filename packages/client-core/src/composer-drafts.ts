import { useCallback, useEffect, useSyncExternalStore } from 'react';

// effect-plain: composer drafts are a React external store; the Promise and
// setTimeout edges are its debounce and async storage, not app logic.
const MAX_DRAFTS = 200;
const MAX_DRAFT_LENGTH = 4000;
type DraftMap = Map<string, string>;

export interface DraftStorage {
  load(userId: string): DraftMap | Promise<DraftMap>;
  save(userId: string, drafts: DraftMap): void;
}
export interface ComposerDrafts {
  getDraft(chatId: string): string;
  setDraft(chatId: string, text: string): void;
  subscribe(listener: () => void): () => void;
  scopeToUser(userId: string): void;
  hydrate(userId: string): Promise<void>;
}
function capDrafts(source: ReadonlyMap<string, string>): DraftMap {
  const entries = [...source].filter(([, text]) => text.length > 0).slice(-MAX_DRAFTS);
  return new Map(entries.map(([chatId, text]) => [chatId, text.slice(0, MAX_DRAFT_LENGTH)]));
}

export function capStoredDrafts(
  stored: Readonly<Record<string, Readonly<Record<string, string>>>>,
): Record<string, DraftMap> {
  return Object.fromEntries(
    Object.entries(stored).map(([id, byChat]) => [id, capDrafts(new Map(Object.entries(byChat)))]),
  );
}

function mergeLoaded(
  stored: DraftMap,
  typed: ReadonlyMap<string, string>,
  cleared: ReadonlySet<string>,
): DraftMap {
  const merged = capDrafts(stored);
  for (const [chatId, text] of typed) merged.set(chatId, text);
  for (const chatId of cleared) merged.delete(chatId);
  return capDrafts(merged);
}

export function createComposerDrafts(
  storage: DraftStorage,
  opts: { writeDelayMs?: number } = {},
): ComposerDrafts {
  let userId = '';
  let drafts: DraftMap = new Map();
  let hydratedFor: string | undefined;
  let loadDone: Promise<void> | undefined;
  let loadData: Promise<DraftMap> | undefined;
  let dirty = false;
  let cleared = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { userId: string; drafts: DraftMap } | undefined;
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of listeners) listener();
  };
  const persist = (forUserId: string, snapshot: DraftMap): void => {
    if (forUserId !== '') storage.save(forUserId, new Map(snapshot));
  };
  function writePending(): void {
    timer = undefined;
    const next = pending;
    pending = undefined;
    if (next !== undefined) persist(next.userId, next.drafts);
  }

  function schedule(): void {
    if (userId === '') return;
    if (hydratedFor !== userId) {
      dirty = true;
      return;
    }
    if (timer !== undefined) clearTimeout(timer);
    pending = { userId, drafts: new Map(drafts) };
    timer = setTimeout(writePending, opts.writeDelayMs ?? 300);
  }

  function startLoad(nextUserId: string): void {
    const loaded = storage.load(nextUserId);
    if (typeof (loaded as Promise<DraftMap>).then !== 'function') {
      drafts = capDrafts(loaded as DraftMap);
      hydratedFor = nextUserId;
      return;
    }
    const data = (loaded as Promise<DraftMap>).catch(() => new Map<string, string>());
    loadData = data;
    loadDone = data.then((stored) => {
      if (userId !== nextUserId || hydratedFor === nextUserId) return;
      drafts = mergeLoaded(stored, drafts, cleared);
      hydratedFor = nextUserId;
      loadDone = undefined;
      loadData = undefined;
      cleared = new Set();
      if (dirty) {
        dirty = false;
        schedule();
      }
      emit();
    });
  }

  function scopeToUser(nextUserId: string): void {
    if (nextUserId === userId) return;
    const leavingId = userId;
    const leavingDrafts = drafts;
    const leavingCleared = cleared;
    const leavingLoad = hydratedFor === leavingId ? undefined : loadData;
    const leavingDirty = dirty;

    if (timer !== undefined) {
      clearTimeout(timer);
      writePending();
    }
    userId = nextUserId;
    drafts = new Map();
    hydratedFor = loadDone = loadData = undefined;
    dirty = false;
    cleared = new Set();
    if (leavingDirty && leavingId !== '' && leavingLoad !== undefined) {
      void leavingLoad.then((stored) => {
        persist(leavingId, mergeLoaded(stored, leavingDrafts, leavingCleared));
      });
    }
    if (nextUserId !== '') startLoad(nextUserId);
  }

  async function hydrate(forUserId: string): Promise<void> {
    if (forUserId === userId) await loadDone;
  }

  function setDraft(chatId: string, text: string): void {
    const next = text.slice(0, MAX_DRAFT_LENGTH);
    if (next === '') {
      cleared.add(chatId);
      if (!drafts.delete(chatId) && hydratedFor === userId) return;
    } else {
      if (drafts.get(chatId) === next) return;
      drafts.delete(chatId);
      if (drafts.size >= MAX_DRAFTS) {
        const oldest = drafts.keys().next().value;
        if (oldest !== undefined) drafts.delete(oldest);
      }
      drafts.set(chatId, next);
      cleared.delete(chatId);
    }
    schedule();
    emit();
  }

  return {
    getDraft: (chatId) => drafts.get(chatId) ?? '',
    setDraft,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    scopeToUser,
    hydrate,
  };
}

export function useComposerDraft(drafts: ComposerDrafts, userId: string, chatId?: string): string {
  drafts.scopeToUser(userId);
  const getSnapshot = useCallback(
    () => (chatId === undefined ? '' : drafts.getDraft(chatId)),
    [drafts, chatId],
  );
  const value = useSyncExternalStore(drafts.subscribe, getSnapshot);
  useEffect(() => {
    void drafts.hydrate(userId);
  }, [drafts, userId]);
  return value;
}

// useAuditActivity: the one paged audit list behind every Activity section. It loads the
// first page for a scope, appends later pages, and refreshes; each app keeps its markup
// and fixed texts. `clearOnRefresh` is true where a refresh shows the skeleton, false
// where the rows stay visible while the first page reloads.
import { Effect } from 'effect';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PublicAuditEntry } from '@zilar/api-contract';
import { AUDIT_PAGE_LIMIT, type AuditApi, type AuditScope } from './settings-api';
import { interruptFiber } from './use-delayed';

export type ActivityStatus = 'loading' | 'ready' | 'error';

export interface ActivityFailure {
  readonly kind: 'load' | 'more';
  readonly error: unknown;
}

interface ActivityState {
  status: ActivityStatus;
  entries: PublicAuditEntry[];
  next: string | null;
  loadingMore: boolean;
  failure: ActivityFailure | undefined;
}

const INITIAL_STATE: ActivityState = {
  status: 'loading',
  entries: [],
  next: null,
  loadingMore: false,
  failure: undefined,
};

export function useAuditActivity(
  api: AuditApi,
  scope: AuditScope,
  options: { clearOnRefresh: boolean },
): ActivityState & { refresh: () => void; loadMore: () => void } {
  const [state, setState] = useState<ActivityState>(INITIAL_STATE);
  const [reloadTick, setReloadTick] = useState(0);
  const { clearOnRefresh } = options;
  const scopeKey = 'aiId' in scope ? `ai:${scope.aiId}` : `group:${scope.groupId}`;
  const scopeRef = useRef(scope);
  useLayoutEffect(() => {
    scopeRef.current = scope;
  });
  // Guarded synchronously so a double tap landing before React re-renders the disabled button cannot fire two page loads.
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    // Unmount, a new scope or a reload interrupts the load, so a late answer never lands.
    const load = Effect.tryPromise({
      try: () => api.listAudit({ ...scopeRef.current, limit: AUDIT_PAGE_LIMIT }),
      catch: (error) => error,
    }).pipe(
      Effect.match({
        onFailure: (error) =>
          setState({
            status: 'error',
            entries: [],
            next: null,
            loadingMore: false,
            failure: { kind: 'load', error },
          }),
        onSuccess: (page) =>
          setState({
            status: 'ready',
            entries: page.entries,
            next: page.next,
            loadingMore: false,
            failure: undefined,
          }),
      }),
    );
    const fiber = Effect.runFork(load);
    return () => {
      interruptFiber(fiber);
    };
  }, [api, scopeKey, reloadTick]);

  const loadMore = (): void => {
    if (state.next === null || state.loadingMore || loadingMoreRef.current) {
      return;
    }
    const cursor = state.next;
    loadingMoreRef.current = true;
    setState((current) => ({ ...current, loadingMore: true }));
    Effect.runFork(
      Effect.tryPromise({
        try: () =>
          api.listAudit({
            ...scope,
            limit: AUDIT_PAGE_LIMIT,
            ...(cursor ? { before: cursor } : {}),
          }),
        catch: (error) => error,
      }).pipe(
        // The server cursor is inclusive on retries, so rows are de-duplicated by id.
        Effect.match({
          onFailure: (error) =>
            setState((current) => ({
              ...current,
              loadingMore: false,
              failure: { kind: 'more', error },
            })),
          onSuccess: (page) =>
            setState((current) => {
              const seen = new Set(current.entries.map((entry) => entry.id));
              const entries = [...current.entries];
              for (const entry of page.entries) {
                if (!seen.has(entry.id)) {
                  entries.push(entry);
                  seen.add(entry.id);
                }
              }
              return {
                ...current,
                entries,
                next: page.next,
                loadingMore: false,
                failure: undefined,
              };
            }),
        }),
        Effect.ensuring(
          Effect.sync(() => {
            loadingMoreRef.current = false;
          }),
        ),
      ),
    );
  };

  const refresh = (): void => {
    if (clearOnRefresh) {
      setState(INITIAL_STATE);
    }
    setReloadTick((tick) => tick + 1);
  };

  return { ...state, refresh, loadMore };
}

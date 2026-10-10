import { Effect } from 'effect';

import { type SearchApi, type SearchPage } from '../../lib/search-api';

/** A clock seam so tests can drive the controller deterministically. */
export interface SearchScheduler {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

type SearchInput = Parameters<SearchApi['searchMessages']>[0];

/**
 * Runs one search request as a fiber. `onPage` or `onError` runs on that fiber
 * once the request settles; an error thrown by `onPage` is not sent to `onError`.
 */
export function settleSearch(
  api: SearchApi,
  input: SearchInput,
  onPage: (page: SearchPage) => void,
  onError: (error: unknown) => void,
): void {
  Effect.runFork(
    Effect.tryPromise({ try: () => api.searchMessages(input), catch: (error) => error }).pipe(
      Effect.matchEffect({
        onSuccess: (page) => Effect.sync(() => onPage(page)),
        onFailure: (error) => Effect.sync(() => onError(error)),
      }),
    ),
  );
}

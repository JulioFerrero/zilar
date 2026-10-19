---
id: T-2165
title: "One GIF search hook in client-core for web and phone (query, debounce, first page, more pages, failure, retry, availability probe); each app keeps only its markup; no behaviour change"
status: merged
milestone: M5
branch: task/T-2165-gif-search-hook
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2165: One GIF search hook for web and phone

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and one place to change each thing. The big-cut plan (`docs/audit/big-cut-plan.md`, "UI twins") moves per-screen logic into client-core so each app keeps only its markup. The shared people search (`packages/client-core/src/people-search.ts`) is the model. It is a plain React hook built on Effect fibers that takes the API functions as parameters.

Today both GIF panels code the same search twice (read at `2044ba9fe`):
- **Phone** `apps/mobile/src/components/chat/gif-panel.tsx`:
  - `fetchGifPageEffect` and the `probeGifsAvailability` probe sit at lines 87–139.
  - The state lives in `GifPanel` at lines 160–287: query, items, nextPos, loading, loadingMore, error and rateLimited, plus the in-flight `AbortController`, the 300 ms debounce fiber and the `loadingMoreRef` guard.
  - Paging starts from `onScroll` (around line 337).
- **Web** `apps/web/src/components/GifPanel.tsx`:
  - `probeProvider`, `probeGifsAvailabilityEffect` and `pageOf` sit at lines 40–67.
  - `GifPanel` keeps typed and searched text, extra pages, the debounce `useQuery`, the first-page `useQuery`, the more-pages `useAction`, `loadMore` and `retry` at lines 144–239.
- **Shared page shape:** `GifPage<T>` in `packages/client-core/src/stickers-api.ts:52`. The `searchGifs` and `trendingGifs` methods there take `(query?, pos?, signal?)`.

### Steps
1. **Add the hook.** Create `packages/client-core/src/gif-search.ts` with `useGifSearch(client, options)`:
   - `client` is `{ searchGifs, trendingGifs }` with the signatures above.
   - `options` is `{ enabled: boolean }`; the phone passes `open`, web passes `true`.
   - It returns `{ query, setQuery, items, loading, loadingMore, failure, loadMore, retry }`.
   - `failure` is `undefined | 'unavailable' | 'rate_limited' | 'error'`.
2. **Keep today's rules in the hook:**
   - A blank query (after trim) loads trending; otherwise it searches the trimmed text.
   - Typing waits `GIF_SEARCH_DEBOUNCE_MS` (from `@zilar/chat-core`), and each keystroke restarts the wait.
   - A new query aborts the request in flight, so a late answer never lands, and it clears the extra pages.
   - `loadMore` does nothing while a first page or another page is loading, or when there is no `nextPos`. A synchronous guard (a ref) stops two scroll events from starting two loads.
   - A `gifs_unavailable` failure calls `setGifsAvailability(false)`.
   - `retry` reloads the first page of the current search.
   - The first load starts on a later tick, never synchronously in an effect body (the phone comment at line 242 says why).
3. **Move the probe.** Put one `probeGifsAvailability(trending)` Effect next to the hook, replacing the phone `probeGifsAvailabilityEffect` (lines 112–139) and the web `probeProvider`/`probeGifsAvailabilityEffect` (lines 40–60).
   - It keeps the cache check through `gifsAvailability()`.
   - It sets `true` when the provider answers, `false` on `gifs_unavailable`, and returns `true` without caching on any other error.
   - Update its two callers: `apps/mobile/src/components/chat/composer-sheet.ts:102` and `apps/web/src/components/StickerPanel.tsx:379`.
4. **Use it in both panels.** Delete the moved code. Each panel keeps its own markup, cells, attribution and error texts:
   - **Phone:** "Too many GIF searches. Try again in a moment." for `rate_limited`, else "Could not load GIFs. Try again.". The unavailable behaviour stays as today.
   - **Web:** `LOAD_ERROR` for any failure except `unavailable`, and the unavailable branch as today.
   - **Phone token:** the session-token fetch for image headers stays in the phone panel.
5. Export the hook and probe from `packages/client-core/src/index.ts`.

### Rules
- No behaviour change: the same texts, debounce, paging, abort and availability rules.
- Keep every "why" comment, once, next to the code it explains.
- No new tests.

### Allowed files
- `packages/client-core/src/gif-search.ts`
- `packages/client-core/src/index.ts`
- `apps/mobile/src/components/chat/gif-panel.tsx`
- `apps/mobile/src/components/chat/composer-sheet.ts`
- `apps/web/src/components/GifPanel.tsx`
- `apps/web/src/components/StickerPanel.tsx`
- `work/T-2165-gif-search-hook.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down; give the net from `git diff main --numstat`, counting the new file.
- **Lead check:**
  - Web mock: the GIFs tab shows trending, a search shows results, scrolling loads more, Retry works.
  - Phone emulator: the composer GIFs tab, the same steps.

---

## Report (written by the worker when done)

### What I did

- Added `packages/client-core/src/gif-search.ts` with `useGifSearch(client, options)` and
  `probeGifsAvailability(trending)`.
  - Trending for a blank (trimmed) query, search otherwise; 300 ms
    `GIF_SEARCH_DEBOUNCE_MS` wait restarted on each keystroke.
  - A new first-page load aborts the request in flight and clears the extra pages; a
    late answer is dropped by the controller check.
  - `loadMore` is a no-op without `nextPos`, or while a first page or another page is
    loading; `loadingRef`/`loadingMoreRef` are the synchronous guards.
  - `gifs_unavailable` calls `setGifsAvailability(false)` and reports `'unavailable'`;
    `rate_limited` and any other failure map to `'rate_limited'` / `'error'`.
  - `retry` reloads the first page of the current search; the first load runs after
    `Effect.yieldNow`, never synchronously in the effect body.
  - The probe keeps the `gifsAvailability()` cache, caches `true` when the provider
    answers, caches `false` on `gifs_unavailable`, and returns `true` without caching on
    any other error.
- Exported the hook, the probe and their types from `packages/client-core/src/index.ts`.
- Phone `gif-panel.tsx`: removed the local fetch/probe/state machine and its
  `AbortController`/debounce/refs; it now calls the hook with `{ enabled: open }`. Kept
  the markup, cells, attribution, the phone error texts and the session-token fetch.
  Exported `defaultGifsApi` for the composer's probe.
- Phone `composer-sheet.ts`: probes through the shared
  `probeGifsAvailability((gifsApi ?? defaultGifsApi()).trendingGifs)` instead of the
  removed local promise.
- Web `GifPanel.tsx`: removed `probeProvider`, `probeGifsAvailabilityEffect`, `pageOf`,
  the debounce/first-page/more-pages queries and `loadMore`/`retry`; it now calls
  `useGifSearch({ searchGifs, trendingGifs }, { enabled: true })`. Kept markup, cells,
  `LOAD_ERROR`, attribution and the unavailable branch.
- Web `StickerPanel.tsx`: imports `gifsAvailability` from `@zilar/chat-core` and
  `probeGifsAvailability` from `@zilar/client-core`, and probes with `trendingGifs`.

Net product lines, from `git diff main --numstat` plus the new file's 218 lines:
`56 added + 218 new - 323 deleted = -49` (the task file's own 161 lines are
excluded). Per file: `composer-sheet.ts +3/-2`, `gif-panel.tsx +29/-207`,
`GifPanel.tsx +10/-105`, `StickerPanel.tsx +5/-9`, `index.ts +9/-0`, new
`gif-search.ts` 218.

### Checks run

- `pnpm install`: completed (1155 packages, done in 22.3s).
- First `pnpm gate`: FAIL at `format` on
  `apps/mobile/src/components/chat/gif-panel.tsx` only; fixed with
  `pnpm exec prettier --write apps/mobile/src/components/chat/gif-panel.tsx`.
- Final `pnpm gate` from the repo root:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (1.1s)
  PASS  lint  (0.9s)
  PASS  typecheck  (0.8s)
  PASS  effect  (0.5s)
  PASS  build @zilar/server  (0.5s)
  PASS  tests @zilar/client-core  (2.5s)
  PASS  tests @zilar/mobile  (1.2s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  WARN  size: apps/web/src/components/StickerPanel.tsx: 527 lines (main 531); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
  size: no changed source file is over 800 lines
  comments: no task IDs in added comments
  GATE PASS
  ```
- No single test file was run: no test file was added or touched; the gate ran the
  nearest tests for `@zilar/client-core` and `@zilar/mobile`.

### Notes for the lead

- No new tests, per the spec.
- The hook keeps `retry` and `loadMore` on the latest typed query (`queryRef`), matching
  today's phone panel and the web retry-after-search behaviour.
- A fresh first page now clears `items` and `nextPos` before the request. Today both
  panels hide the list behind the loading/error branch at that point, so no visible
  change.
- The phone's persisted typed query across close/reopen is unchanged: reopening still
  loads trending while the field keeps the old text.
- Not run: the lead's web mock and phone emulator checks (trending, search, scroll,
  Retry).

## Review (written by Claude)

Approved; the pre-review was clean. 1 nit: Retry within the 300 ms debounce reloads the newest keystrokes rather than the last shown search, which is harmless.

Net −49. One `useGifSearch` hook and one `probeGifsAvailability` in client-core now serve both panels. Every "why" comment moved with the code: the abort, the scroll guard, the later-tick first load, the debounce and the probe rules.

**Web mock**, identical to main: 6 trending cells, "danc" → 1 (🐱 dancing), cleared → 6, Giphy attribution. No page errors. Paging can't be exercised; the mock has 6 GIFs.

**Phone emulator:** the smoke passed. In the composer the GIFs tab shows the trending tiles, and "danc" narrows them to one tile.

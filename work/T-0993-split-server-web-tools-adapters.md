---
id: T-0993
title: "Size split T55: apps/server/src/web-tools/adapters.ts (606 lines) into web-tools/{shared,fetch-adapter,wikipedia-adapter,price-adapter,feed-adapter,search-adapter}.ts; one withWebRateLimit"
status: merged
milestone: M5
branch: task/T-0993-split-server-web-tools-adapters
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-0993: Split `web-tools/adapters.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/web-tools/adapters.ts` is 606 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #51 (task T55). The new files go in `apps/server/src/web-tools/`:
- `shared.ts`;
- `fetch-adapter.ts`, `wikipedia-adapter.ts`, `price-adapter.ts`, `feed-adapter.ts`, `search-adapter.ts`.

`adapters.ts` keeps `buildWebToolsAdapters`, the deps types and every export it has today. The folder already holds `feed.ts`, `guarded-fetch.ts`, `html.ts`, `prices.ts` and `search.ts`; leave them as they are.

The in-file Dedup is in scope: the five `checkWebRateLimit` preambles become one `withWebRateLimit(state, fn)`.
- **The rate limit:** it must run before every fetch, exactly as now, with the same limit and the same error.
- **The proof:** the Report quotes each `execute` before and after.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #51, and `apps/server/src/web-tools/adapters.ts`.

### Allowed files
`apps/server/src/web-tools/adapters.ts`, `apps/server/src/web-tools/shared.ts`, `apps/server/src/web-tools/fetch-adapter.ts`, `apps/server/src/web-tools/wikipedia-adapter.ts`, `apps/server/src/web-tools/price-adapter.ts`, `apps/server/src/web-tools/feed-adapter.ts`, `apps/server/src/web-tools/search-adapter.ts`, `work/T-0993-split-server-web-tools-adapters.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/server/src/web-tools/adapters.ts` (606 lines) into one barrel plus six
files, following `docs/audit/split-rules.md` and the §2.2 #51 ranges:

- `shared.ts` — constants, `WebSearchProviderName`, `BuildWebToolsAdaptersDeps`,
  `WebToolsState`, `createWebToolsState`, `duckduckgoProvider`, `wikipediaUserAgent`,
  `webRateLimitKey`, `withWebRateLimit`, `guardedOptions`, `failureResult`, `hostOf`.
- `fetch-adapter.ts`, `wikipedia-adapter.ts`, `price-adapter.ts`, `feed-adapter.ts`,
  `search-adapter.ts` — the five adapters, one each.
- `adapters.ts` — kept as the barrel with `buildWebToolsAdapters`; it re-exports every
  name it exported before (constants, types, `wikipediaHost`, `WikipediaArticle`,
  `parseWikipediaSearch`, `parseWikipediaExtract`, `formatFeedItems`).

Everything is moved unchanged except the in-scope Dedup: the five
`checkWebRateLimit(state, ctx)` preambles plus the `ctx as ActionContext` casts became
one `withWebRateLimit(state, fn)`. No importer changed (`apps/server/src/main.ts` still
imports `buildWebToolsAdapters` from `./web-tools/adapters`). No new tests; the folder
has no kept tests, so the gate reported "no nearby test files".

**Effect marker:** `shared.ts` is a new `needs-effect` file (it has `async`/`await`,
`try`/`catch`) moved out of an `adapters.ts` the base counts as `effect`, so it carries
`// effect-plain: moved unchanged from apps/server/src/web-tools/adapters.ts (size split)`
in its first line (split-rules item 6). The five adapter files import `Schema` from
`effect` as a value, so they classify as `effect`; the barrel has no signals and is
`plain`. The `pnpm gate` effect step passed.

### Files changed

- `apps/server/src/web-tools/adapters.ts` (rewritten as the barrel)
- `apps/server/src/web-tools/shared.ts` (new)
- `apps/server/src/web-tools/fetch-adapter.ts` (new)
- `apps/server/src/web-tools/wikipedia-adapter.ts` (new)
- `apps/server/src/web-tools/price-adapter.ts` (new)
- `apps/server/src/web-tools/feed-adapter.ts` (new)
- `apps/server/src/web-tools/search-adapter.ts` (new)
- `work/T-0993-split-server-web-tools-adapters.md` (this file)

### Size (split-rules item 8)

```
old: apps/server/src/web-tools/adapters.ts   606

new:
  53  apps/server/src/web-tools/adapters.ts
 141  apps/server/src/web-tools/shared.ts
  72  apps/server/src/web-tools/fetch-adapter.ts
 159  apps/server/src/web-tools/wikipedia-adapter.ts
 103  apps/server/src/web-tools/price-adapter.ts
  82  apps/server/src/web-tools/feed-adapter.ts
  51  apps/server/src/web-tools/search-adapter.ts
```

Every new file and the barrel are under 400 lines, and no `max-lines` warning appears.

### Export list before and after (split-rules item 8)

`grep -nE "^export"` on `main:apps/server/src/web-tools/adapters.ts`:

```
export const WEB_ACTIONS_PER_HOUR = 30;
export const WEB_ACTION_WINDOW_MS = 60 * 60 * 1000;
export const MAX_FETCH_URL_CHARS = 2048;
export const MAX_FETCH_CHARS = 16000;
export const DEFAULT_FETCH_CHARS = 8000;
export const MAX_FEED_LIMIT = 20;
export const DEFAULT_FEED_LIMIT = 10;
export const MAX_SEARCH_QUERY_CHARS = 200;
export const MAX_WIKIPEDIA_EXTRACT_CHARS = 3000;
export type WebSearchProviderName = 'duckduckgo-html' | 'none';
export interface BuildWebToolsAdaptersDeps {
export function buildWebToolsAdapters(
export function wikipediaHost(lang: string): string {
export interface WikipediaArticle {
export function parseWikipediaSearch(body: string): { title: string } | null {
export function parseWikipediaExtract(body: string): WikipediaArticle | null {
export function formatFeedItems(
```

The barrel's public surface after the split — all 17 names, same names and kinds:

```
export {
  DEFAULT_FETCH_CHARS, DEFAULT_FEED_LIMIT, MAX_FETCH_CHARS, MAX_FETCH_URL_CHARS,
  MAX_FEED_LIMIT, MAX_SEARCH_QUERY_CHARS, MAX_WIKIPEDIA_EXTRACT_CHARS,
  WEB_ACTIONS_PER_HOUR, WEB_ACTION_WINDOW_MS,
} from './shared';
export type { BuildWebToolsAdaptersDeps, WebSearchProviderName } from './shared';
export { formatFeedItems } from './feed-adapter';
export { parseWikipediaExtract, parseWikipediaSearch, wikipediaHost } from './wikipedia-adapter';
export type { WikipediaArticle } from './wikipedia-adapter';
export function buildWebToolsAdapters(
```

New, module-internal exports the split introduced (not re-exported by the barrel): from
`shared.ts` `WebToolsState`, `createWebToolsState`, `duckduckgoProvider`,
`wikipediaUserAgent`, `withWebRateLimit`, `guardedOptions`, `failureResult`, `hostOf`;
`webFetchAdapter`, `webWikipediaAdapter`, `webPriceAdapter`, `webFeedAdapter`,
`webSearchAdapter` from their files. Net: the barrel's export list is unchanged.

### Dedup proof: each `execute` before and after

The new shared helper (adds the gate, same limit, same error):

```ts
export function withWebRateLimit(
  state: WebToolsState,
  fn: (args: unknown) => Promise<ActionResult>,
): (ctx: unknown, args: unknown) => Promise<ActionResult> {
  return async (ctx, args) => {
    const actionCtx = ctx as ActionContext;
    if (!state.webLimiter.allow(webRateLimitKey(actionCtx))) {
      return { summary: 'web limit reached, try later' };
    }
    return fn(args);
  };
}
```

**web.fetch** — before:

```ts
execute: async (ctx, args) => {
  const actionCtx = ctx as ActionContext;
  const parsed = args as { url: string; maxChars?: number };
  const limited = checkWebRateLimit(state, actionCtx);
  if (limited !== null) {
    return { summary: limited };
  }
  let host: string;
  ...
```

after:

```ts
execute: withWebRateLimit(state, async (args) => {
  const parsed = args as { url: string; maxChars?: number };
  let host: string;
  ...
```

**web.wikipedia** — before:

```ts
execute: async (ctx, args) => {
  const actionCtx = ctx as ActionContext;
  const parsed = args as { query: string; lang?: string };
  const limited = checkWebRateLimit(state, actionCtx);
  if (limited !== null) {
    return { summary: limited };
  }
  const host = wikipediaHost(parsed.lang ?? 'en');
  ...
```

after:

```ts
execute: withWebRateLimit(state, async (args) => {
  const parsed = args as { query: string; lang?: string };
  const host = wikipediaHost(parsed.lang ?? 'en');
  ...
```

**web.price** — before:

```ts
execute: async (ctx, args) => {
  const actionCtx = ctx as ActionContext;
  const parsed = args as { symbols: string[] };
  const limited = checkWebRateLimit(state, actionCtx);
  if (limited !== null) {
    return { summary: limited };
  }
  const cryptoSymbols: string[] = [];
  ...
```

after:

```ts
execute: withWebRateLimit(state, async (args) => {
  const parsed = args as { symbols: string[] };
  const cryptoSymbols: string[] = [];
  ...
```

**web.feed** — before:

```ts
execute: async (ctx, args) => {
  const actionCtx = ctx as ActionContext;
  const parsed = args as { url: string; limit?: number };
  const limited = checkWebRateLimit(state, actionCtx);
  if (limited !== null) {
    return { summary: limited };
  }
  let host: string;
  ...
```

after:

```ts
execute: withWebRateLimit(state, async (args) => {
  const parsed = args as { url: string; limit?: number };
  let host: string;
  ...
```

**web.search** — before:

```ts
execute: async (ctx, args) => {
  const actionCtx = ctx as ActionContext;
  const parsed = args as { query: string };
  const limited = checkWebRateLimit(state, actionCtx);
  if (limited !== null) {
    return { summary: limited };
  }
  // One attempt per call, never a retry loop: the provider returns
  // `[]` on any failure and the adapter answers "unavailable".
  let results: WebSearchResult[];
  ...
```

after:

```ts
execute: withWebRateLimit(state, async (args) => {
  const parsed = args as { query: string };
  // One attempt per call, never a retry loop: the provider returns
  // `[]` on any failure and the adapter answers "unavailable".
  let results: WebSearchResult[];
  ...
```

In all five, everything after the quoted head (the `...`) is byte-identical between the
before and after versions — the only change is the header line, the removal of the
`ctx as ActionContext` / `parsed` preamble, and the closing `}),`. The gate therefore
runs before every fetch, with the same `WEB_ACTIONS_PER_HOUR` / `WEB_ACTION_WINDOW_MS`
budget and the same `web limit reached, try later` summary.

### Commands run

- `pnpm install` — done first, as asked: "Done in 46s", 1262 resolved, 1 deprecated
  subdependency warning (`uuid@7.0.3`), one mobile peer-dependency warning
  (`@types/react-dom` unmet peer). No lockfile change.
- No single-file test run: `apps/server/src/web-tools/` has no test files, so there is
  nothing to run with the quiet reporter (verified with `find`/`grep`).
- `pnpm gate` — see below.

### Gate (from the repo root)

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (0.8s)
PASS  lint  (0.9s)
PASS  typecheck  (4.9s)
PASS  effect  (1.8s)
SKIP tests @zilar/server (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

The 8 changed files are the 7 files above plus this task file. No file outside the
Allowed list.

### Deviations from the spec

- §2.2 #51 says `adapters.ts` keeps "the deps types". `BuildWebToolsAdaptersDeps`,
  `WebSearchProviderName` and the `WebToolsState` interface now live in `shared.ts` and
  the barrel re-exports the two public ones. Keeping them in the barrel would make
  `shared.ts` (which needs them) import the barrel while the barrel imports the adapter
  files, a cycle; split-rules item 3 says to avoid that. The public export list is
  unchanged, so no importer sees a difference.
- The plan's line ranges place `createWebToolsState` (101-113) and `duckduckgoProvider`
  (115-130) inside `shared.ts`'s 48-162 range; they are there.
- `checkWebRateLimit` is gone, replaced by `withWebRateLimit`, as the Dedup requires.
  The bodies no longer needed `ctx`, so the wrapper takes only `(args)`.

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `web-tools/adapters.ts` (606 lines) becomes `buildWebToolsAdapters` plus `shared` and five adapter files, the largest `wikipedia-adapter.ts` at 159.
- **The rate limit, checked by the lead:** `withWebRateLimit` (`shared.ts:97`) runs `webLimiter.allow` before the adapter body, with the same "web limit reached, try later" summary as main's `checkWebRateLimit`. All five adapters use it.
- **Check:** the gate passed.

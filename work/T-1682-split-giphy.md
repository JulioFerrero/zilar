---
id: T-1682
title: "Size split of apps/server/src/gifs/giphy.ts (397 lines): move GIPHY_MEDIA_HOSTS and the response parser (schemas, toItem, parseGiphyResponse) into a new gifs/giphy-parse.ts, re-export them from giphy.ts, and delete the unused createFakeGifProvider and paginate"
status: merged
milestone: M5
branch: task/T-1682-split-giphy
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1682: Split the Giphy response parser out of giphy.ts

## Spec (written by Claude, do not edit)

### Why
`apps/server/src/gifs/giphy.ts` is 397 of 400 lines. The Giphy response parser is a self-contained first half, and the fake provider at the end has no callers.

### Facts (the lead read them on 2026-10-16)
- **`giphy.ts` layout:**
  - the imports (`:1-8`);
  - the comment and `export const GIPHY_MEDIA_HOSTS = [...]` (`:10-24`);
  - `GIPHY_API_HOST :26`, `GIPHY_RATINGS :28` and `GiphyRating :30`;
  - **the parser:** from the comment `// Unknown keys are kept, like the old zod .loose()` (`:32`) through `passthrough :34`, `renditionSchema :36`, `gifObjectSchema :50`, `giphyResponseSchema :59`, `decodeRendition :76`, `positiveInt :81`, `httpsOnAllowlist :89` (uses `GIPHY_MEDIA_HOSTS` at `:100`), `toItem :110` (uses `gifItemSchema` at `:152`) and `parseGiphyResponse :160-178`;
  - **the provider:** `GiphyProviderOptions :180` (uses `GiphyRating`), `GiphyError :192`, `GiphyFetcher :199`, `defaultResolver :209`, `giphyRequestEffect :219` and `createGiphyProvider :264` (uses `GIPHY_API_HOST` and `parseGiphyResponse` at `:320`);
  - **dead code:** `createFakeGifProvider :354-389` and `paginate :391-397`.
- **Callers:**
  - `git grep createFakeGifProvider` finds only old `work/` task files, so the fake provider and `paginate` have no callers;
  - `apps/server/src/gifs/api.ts:35` imports `{ GIPHY_MEDIA_HOSTS, createGiphyProvider } from './giphy'`;
  - nothing outside `giphy.ts` imports `parseGiphyResponse`.
- **The folder `apps/server/src/gifs/`** holds `api.ts`, `giphy.ts`, `provider.ts`, `routes.ts` and `token.ts`; there's no `giphy-parse.ts` and no gifs test.

### Steps
1. **Create `apps/server/src/gifs/giphy-parse.ts`** with `GIPHY_MEDIA_HOSTS` (with its comment) and the whole parser block (`:32-178`), moved **word for word**.
   - Export `GIPHY_MEDIA_HOSTS` and `parseGiphyResponse`.
   - Bring the imports the block needs (`Schema`, `Exit`, `struct`, `gifItemSchema`, the `GifPage` type).
   - It must not import from `./giphy`, so there's no cycle.
2. **`giphy.ts`:**
   - imports `parseGiphyResponse` and `GIPHY_MEDIA_HOSTS` from `./giphy-parse`;
   - adds `export { GIPHY_MEDIA_HOSTS, parseGiphyResponse } from './giphy-parse';` so `api.ts` keeps working unchanged;
   - deletes `createFakeGifProvider` and `paginate`;
   - drops the imports it no longer uses.
3. **No behaviour change, no new tests.**

### Allowed files
- `apps/server/src/gifs/giphy-parse.ts`
- `apps/server/src/gifs/giphy.ts`
- `work/T-1682-split-giphy.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **`giphy.ts` is about 190 lines,** and `giphy-parse.ts` holds the parser unchanged.
- **The server typecheck passes,** and `api.ts` is unchanged.

---

## Report (written by the worker when done)

### What I did
- Created `apps/server/src/gifs/giphy-parse.ts` (168 lines): moved `GIPHY_MEDIA_HOSTS` (with its comment) and the whole parser block (`// Unknown keys are kept…` through `parseGiphyResponse`) **word for word**, with the needed imports (`Exit`, `Schema`, `struct`, `gifItemSchema`, `GifPage`). It does not import from `./giphy`.
- `apps/server/src/gifs/giphy.ts` is now 190 lines. It imports `GIPHY_MEDIA_HOSTS` and `parseGiphyResponse` from `./giphy-parse`, re-exports both so `api.ts` stays unchanged, and drops the now-unused imports (`Exit`, `struct`, `gifItemSchema`).
- Deleted the unused `createFakeGifProvider` and `paginate`.
- `api.ts` was not touched and still imports `{ GIPHY_MEDIA_HOSTS, createGiphyProvider } from './giphy'`.
- Verified the move is byte-for-byte: `diff` of the original `giphy.ts` `:10-24` against `giphy-parse.ts` `:6-20`, and `:32-178` against `:22-168`, both print nothing (identical).
- No behaviour change, no new tests (as specified; no gifs test exists).

### Checks run
- `pnpm install`: Done.
- `pnpm gate` (repo root):
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (0.8s)
  PASS  lint  (1.7s)
  PASS  typecheck  (5.6s)
  PASS  effect  (1.4s)
  SKIP tests @zilar/server (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test file was run: there is no test near `gifs/`, and the gate reported `SKIP tests @zilar/server (no nearby test files)`.

### Notes for the lead
- **Deviation from the spec's exact re-export form.** Step 2 asked for both `import { parseGiphyResponse, GIPHY_MEDIA_HOSTS } from './giphy-parse'` and `export { GIPHY_MEDIA_HOSTS, parseGiphyResponse } from './giphy-parse'`. Importing `GIPHY_MEDIA_HOSTS` there would make it an unused local (lint error), so instead I imported both bindings and re-exported those same bindings with `export { GIPHY_MEDIA_HOSTS, parseGiphyResponse };` (line 10). The observable effect for `api.ts` is identical; both names resolve from `./giphy`.
- `giphy.ts` is 190 lines and `giphy-parse.ts` is 168, both under the 400-line limit.

## Review (written by Claude)

**Approved and merged.** A pure size split, plus a dead-code removal.

- **Pre-review:** clean; 1 nit, accepted: the re-export form.
- **The lead's check:** the removed lines equal `giphy-parse.ts` word for word; the only lines not carried over are the unused `createFakeGifProvider` and `paginate`.
- **Result:** `giphy.ts` drops from 397 to 190 lines.


---
id: T-0992
title: "Size split T56: apps/server/src/stickers/api.ts (595 lines) into stickers/{api-handlers,api-decode,api-upload}.ts, api.ts keeps the group and mount"
status: merged
milestone: M5
branch: task/T-0992-split-server-stickers-api
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-0992: Split `stickers/api.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/stickers/api.ts` is 595 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #52 (task T56): `stickers/api-handlers.ts`, `stickers/api-decode.ts`, `stickers/api-upload.ts`, under `apps/server/src/`.

- **`api.ts` keeps:** the interface, the group declaration, the layer, the mount, and every export it has today.
- **Move unchanged:** move the code as it is, and skip the Dedup, because it crosses files.
- **The upload limits:** the size cap and the type checks stay byte for byte the same.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #52, and `apps/server/src/stickers/api.ts`.

### Allowed files
`apps/server/src/stickers/api.ts`, `apps/server/src/stickers/api-handlers.ts`, `apps/server/src/stickers/api-decode.ts`, `apps/server/src/stickers/api-upload.ts`, `work/T-0992-split-server-stickers-api.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Size split of `apps/server/src/stickers/api.ts` (595 lines) into the three
files the plan §2.2 #52 names, following `docs/audit/split-rules.md`:

- `api.ts` keeps the interface, the group declaration (`StickersApi`), the
  layer and the mount, and exports the same two names it did before.
- `api-handlers.ts` holds the setup shared by the handlers (logger, `now`, the
  bot-token resolver, the Telegram import limiter, `serviceDeps`, `importDeps`)
  and the `HttpApiBuilder.group` layer with all 14 routes.
- `api-decode.ts` holds `DiscoverQuery`/`STRICT_PAYLOAD`/`FavoriteBody`,
  `parseJsonOrNull`, `discoverQueryRecord`, `favoriteQueryRecord`,
  `renderSchemaError`, `isEmptyRecord`, `matchSchemaErrorMessage`,
  `spendTelegramImportBudget` and `decodePathId`.
- `api-upload.ts` holds the upload handler body (`runUploadSticker`) and
  `readCapped`.

The moved code is unchanged; the only new glue is that the handler layer is now
built by `createStickersGroupLayer(StickersApi, deps)` (so the concrete `api`
instance stays in `api.ts` and no module cycle is created) and the upload route
calls `runUploadSticker(request, user, serviceDeps)` instead of an inline
`Effect.gen`. The upload size cap and type checks are byte for byte the same
(`STICKER_MAX_BYTES`, `STICKER_MAX_BYTES + 64 * 1024`, `emoji.length > 8`).
The Dedup items in §2.2 #52 were skipped on purpose: they cross files (shared
request-decode/error handler and the Telegram capped-read helper), which the
spec says to skip.

No importer changed: `apps/server/src/app.ts` still imports `createStickersApi`
from `./stickers/api`, and the two public names are unchanged.

### Files changed

- `apps/server/src/stickers/api.ts` (modified, 595 → 95 lines)
- `apps/server/src/stickers/api-handlers.ts` (new, 284 lines)
- `apps/server/src/stickers/api-decode.ts` (new, 136 lines)
- `apps/server/src/stickers/api-upload.ts` (new, 140 lines)

### `wc -l` (split-rules item 8)

```
old  apps/server/src/stickers/api.ts          595
new  apps/server/src/stickers/api.ts           95
new  apps/server/src/stickers/api-handlers.ts 284
new  apps/server/src/stickers/api-decode.ts   136
new  apps/server/src/stickers/api-upload.ts   140
```

All new files and the barrel are well under 400 lines.

### Export diff (split-rules item 8)

`grep -E '^export'` on the old file (main) vs. the barrel plus the new files:

```
== OLD (main: apps/server/src/stickers/api.ts) ==
export interface StickersApiDependencies extends StickersRoutesDependencies {
export function createStickersApi(deps: StickersApiDependencies): EffectApiMount {

== NEW (api.ts barrel) ==
export interface StickersApiDependencies extends StickersRoutesDependencies {
export function createStickersApi(deps: StickersApiDependencies): EffectApiMount {

== NEW (internal files, not re-exported by api.ts) ==
api-handlers.ts: export function createStickersGroupLayer(
api-decode.ts:   export const DiscoverQuery / STRICT_PAYLOAD / FavoriteBody
                 export function parseJsonOrNull / discoverQueryRecord /
                 favoriteQueryRecord / spendTelegramImportBudget / decodePathId
                 export const renderSchemaError
api-upload.ts:   export interface UploadStickerRequest
                 export function runUploadSticker
```

The original path exports the same two names with the same kinds (an interface
and a function) as before. The extra exports live only in the new internal
modules and are not re-exported through `apps/server/src/stickers/api.ts`, so no
importer changes.

### Commands run

- `pnpm install` — done, no errors.
- `pnpm exec prettier --write` on the four files — only the new layout changed.
- `pnpm gate` (from the repo root) — real result:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (0.7s)
PASS  lint  (0.9s)
PASS  typecheck  (3.7s)
PASS  effect  (0.9s)
SKIP tests @zilar/server (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

No single test file was run: there are no tests in
`apps/server/src/stickers/` and no test anywhere imports `stickers/api` or
`createStickersApi` (checked with grep), so the gate selected no nearby tests.

### Effect ratchet (split-rules item 6)

None of the three new files trip the ratchet: each imports `effect` as a value
(`api-decode` and `api-handlers` import `Effect`/`Schema`; `api-upload` imports
`Effect`/`Stream`), so all three classify as `effect`, not `needs-effect`. No
`// effect-plain:` marker was added and the gate's `effect` step passed.

### Problems / deviations / open questions

- Deviation: the plan lists `api-handlers.ts` as lines 215–536 excluding the
  upload. To keep `StickersApi` in `api.ts` (as the spec requires) without a
  module cycle, `createStickersGroupLayer` takes the `api` value as its first
  argument instead of closing over it. Behaviour is identical.
- The upload limiter stays in `api.ts` because only the api layer uses it (the
  upload handler never touches it); the Telegram import limiter stays in
  `api-handlers.ts` because only the import handler uses it. This keeps each
  limiter next to its only consumer.
- No open questions.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The split:** `stickers/api.ts` (595 lines) keeps the group and the mount, plus `api-handlers` (284), `api-upload` (140) and `api-decode` (136).
- **The upload caps, checked by the lead:** the declared-size check (`STICKER_MAX_BYTES + 64 KiB`) and the buffer check (`STICKER_MAX_BYTES`) are the same as on main, each with the same 413.
- **The nit:** a dead `void DiscoverQuery;` line. It's harmless and left for the F dedup pass.
- **Check:** the gate passed.

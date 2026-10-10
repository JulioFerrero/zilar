---
id: T-0958
title: "Size split T8: apps/server/src/stickers/service.ts (1,388 lines) into stickers/{schemas,packs,panel,favorites,storage,telegram}.ts, the old path a barrel; its own 8 runPromise sites onto runSql"
status: merged
milestone: M5
branch: task/T-0958-split-server-stickers-service
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0958: Split `stickers/service.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/stickers/service.ts` is 1,388 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.1 #5 (task T8): `stickers/schemas.ts`, `stickers/packs.ts`, `stickers/panel.ts`, `stickers/favorites.ts`, `stickers/storage.ts`, `stickers/telegram.ts`, under `apps/server/src/`. `stickers/service.ts` becomes the barrel. The existing `stickers/telegram-import.ts` stays as it is.

The entry's Dedup is in scope, because it stays inside this file: the 8 `sqlRuntimeFor(deps.db).runPromise(…)` sites move onto `runSql` from `apps/server/src/effect/sql.ts:111`, the way the other services already call it (see any `*/service.ts` that imports `runSql`). The behaviour, including errors, must stay the same.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.1 #5, `apps/server/src/stickers/service.ts`, and `apps/server/src/effect/sql.ts`.

### Allowed files
`apps/server/src/stickers/service.ts`, `apps/server/src/stickers/schemas.ts`, `apps/server/src/stickers/packs.ts`, `apps/server/src/stickers/panel.ts`, `apps/server/src/stickers/favorites.ts`, `apps/server/src/stickers/storage.ts`, `apps/server/src/stickers/telegram.ts`, `work/T-0958-split-server-stickers-service.md`.

### Checks
```bash
pnpm gate
```
The gate runs the nearest server tests.

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for, plus the 8 `runSql` sites with their old and new lines.

---

## Report (written by the worker when done)

### What I did

Split `apps/server/src/stickers/service.ts` into `schemas.ts`, `storage.ts`,
`packs.ts`, `panel.ts`, `favorites.ts`, `telegram.ts`; `service.ts` is now a
thin barrel that re-exports the same 51 names with the same kinds. All moved
code is unchanged. The 8 `sqlRuntimeFor(deps.db).runPromise(…)` sites were
moved onto `runSql` (behaviour, including the `HttpError` propagation, is
identical). `stickers/telegram-import.ts` was not touched.

Module layout (drawn from `size-plan.md` §2.1 #5):

- `schemas.ts` — contract/limit constants, `stickerVisibilitySchema`,
  view + deps types, `mapStickerError`, the body schemas (`create`, `patch`,
  `reorder` stays in `panel.ts`, `favorite` stays in `favorites.ts`, `emoji`).
- `storage.ts` — storage-dir resolution, pack access guards, view mappers
  (`toStickerView`/`toPackView`), `toAuditEntry`, `escapeLike`, `uploadSticker`,
  `deleteSticker`, `readStickerFile`.
- `packs.ts` — `listPanelPacks`, `createPack`, `patchPack`, `deletePack`,
  `discoverPacks`.
- `panel.ts` — `addPanelPack`, `removePanelPack`, `reorderPanelBodySchema`,
  `reorderPanelPacks`.
- `favorites.ts` — favorites constants/schema and the three favorites functions.
- `telegram.ts` — the Telegram import constants/types, `importTelegramPack`,
  `toImportHttpError`, `storeImportedSticker`.

### Files changed

- `apps/server/src/stickers/service.ts` (barrel)
- `apps/server/src/stickers/schemas.ts` (new)
- `apps/server/src/stickers/storage.ts` (new)
- `apps/server/src/stickers/packs.ts` (new)
- `apps/server/src/stickers/panel.ts` (new)
- `apps/server/src/stickers/favorites.ts` (new)
- `apps/server/src/stickers/telegram.ts` (new)
- `work/T-0958-split-server-stickers-service.md`

### Line counts (`wc -l`)

| file | lines |
| --- | --- |
| old `service.ts` | 1388 |
| `schemas.ts` | 139 |
| `storage.ts` | 353 |
| `packs.ts` | 302 |
| `panel.ts` | 139 |
| `favorites.ts` | 135 |
| `telegram.ts` | 399 |
| barrel `service.ts` | 61 |

Every new file and the barrel are at most 400 lines (largest: `telegram.ts`,
399).

### Export diff

Public surface (the barrel): 51 exported names before, 51 after, none added,
none removed. Checked by parsing `grep -E "^export"` of
`git show HEAD:apps/server/src/stickers/service.ts` against the new barrel:
`ONLY IN OLD: []`, `ONLY IN BARREL: []`.

Adding the new files to the comparison (as `split-rules.md` item 8 asks) the
only extra `export`s are internal helpers promoted to module scope so the
sibling modules can import them; the barrel does **not** re-export them, so the
public surface is unchanged:

- added (submodule-level only): `emojiSchema`, `mapStickerError`,
  `requireOwnedPack`, `requireVisiblePack`, `toAuditEntry`
- removed: none

### The 8 `runSql` sites (old → new)

| old `service.ts` | new file:line | function |
| --- | --- | --- |
| 360 | `packs.ts:85` | `createPack` |
| 422 | `packs.ts:148` | `patchPack` |
| 588 | `panel.ts:20` | `addPanelPack` |
| 672 | `panel.ts:105` | `reorderPanelPacks` |
| 777 | `favorites.ts:78` | `addFavorite` |
| 870 | `storage.ts:208` | `uploadSticker` |
| 1081 | `telegram.ts:90` | `importTelegramPack` |
| 1320 | `telegram.ts:330` | `storeImportedSticker` |

Each old form `await sqlRuntimeFor(deps.db).runPromise(` became
`await runSql(\n      deps.db,`. Verified no `sqlRuntimeFor`/`.runPromise`
remains in the stickers modules (the one `Effect.runPromise` left,
`telegram-import.ts:500`, is in the untouched imported module).

### Commands and results

- `pnpm install` → `Done in 12s`, 1172 packages, `@types/node`/etc. as expected.
- `pnpm exec prettier --write <the 7 changed .ts files>` (targeted formatting of
  my new files only, so the gate's `format` step would pass) → 2 files
  reformatted (`favorites.ts`, `service.ts`), 5 unchanged.
- `pnpm gate` (repo root, `--base main`) → summary:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.0s)
  PASS  lint  (1.1s)
  PASS  typecheck  (2.9s)
  PASS  effect  (0.8s)
  SKIP tests @zilar/server (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

No single test file was run: there is no `*.test.ts` under
`apps/server/src/stickers/` and none elsewhere in the repo references stickers
(`grep -rln sticker apps/server --include=*.test.ts` is empty), so the gate's
nearest-test rule selected nothing and skipped the server tests. The change is
verified by the gate's format, lint, typecheck and effect steps.

### Deviations / notes

- **The two fixed 503 envelopes were not folded into `errors.ts`.** That Dedup
  item crosses files (`errors.ts` is outside the Allowed files), and
  `split-rules.md` item 2 says only dedup that stays inside this file is in
  scope; the task spec puts only the 8 `runSql` sites in scope. Left as-is.
- No `// effect-plain:` marker was needed: every new file imports Effect, so the
  effect ratchet's `effect` step passed without markers.
- `requireVisiblePack`/`requireOwnedPack` and `toAuditEntry`/the view mappers
  were placed in `storage.ts` (the lower, shared layer) because `packs.ts`,
  `panel.ts` and `favorites.ts` all use them and the plan's line ranges did not
  name 257–301 explicitly; this keeps the dependency graph acyclic
  (`schemas ← storage ← {packs, panel, favorites, telegram}`).
- Reformatting `telegram.ts` to a single merged `./image` import left it at 399
  lines (the plan's range is 373 lines of body plus imports).
- Security checklist: pure move, no behaviour change, no new routes, no new
  writes, no secrets involved.

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The split:** `stickers/service.ts` (1,388 lines) becomes a barrel plus `schemas`, `packs`, `panel`, `favorites`, `storage` and `telegram`, the largest `telegram.ts` at 399.
- **The 8 `sqlRuntimeFor(deps.db).runPromise` sites** are now `runSql`, which is exactly that call (`apps/server/src/effect/sql.ts:111-116`), so behaviour is unchanged.
- **Check:** the gate passed. No server test covers stickers since the test cut.

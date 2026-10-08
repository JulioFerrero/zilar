---
id: T-0636
title: "effect/sql: stickers/service.ts part B, favorites, upload, delete sticker, read file and the Telegram import (find-or-create pack, known ids, per-sticker store), transactions with their advisory locks and caps; same errors, 503 mapping and pack_full outcome; the file then has no drizzle; tests unchanged"
status: merged
milestone: M5
branch: task/T-0636-effect-sql-sticker-files
model: auto
effort: low
depends_on: [T-0633]
estimate: 1 day
---

# T-0636: sticker favorites, files and import on effect/sql (part B)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. This is the second half of F8 in the T-0626 audit. Part A (T-0633, merged) moved the pack and panel functions in this same file. Reuse its private `runSql` and `mapStickerError` and its `sql.withTransaction` + `Effect.fail(HttpError)` pattern (for example `createPack`, around lines 360-410).

### Verified facts (do not re-derive; read lines 60-100 and 700-1320)
- **`apps/server/src/stickers/service.ts`:** drizzle imports at 6 and 11 are used only by part B now. After this task the file keeps **no value import** from `drizzle-orm` or `db/schema`; the row types become type-only.
- **Convert these:**
  - `listFavorites` (717-743): the user's favorites ordered by `added_at, sticker_id`, then one `id IN (…)` read (an early return when there are none, so the list is never empty), restored to link order;
  - **`addFavorite`** (745-791):
    - a 404 `Sticker not found` read;
    - then **one transaction**:
      - `pg_advisory_xact_lock(hashtext('sticker-favorites:' || userId))`;
      - an exists check (idempotent, even at the cap);
      - a count against `STICKER_FAVORITES_MAX` (400 `favorites_full`);
      - an insert with `ON CONFLICT DO NOTHING`;
    - an `HttpError` is rethrown, anything else becomes 503 `xmpp_unavailable`;
  - `removeFavorite` (793-803): a delete;
  - **`uploadSticker`** (814-901):
    - the checks before the transaction stay as they are;
    - **one transaction**: `pg_advisory_xact_lock(hashtext(packId))`, a count against `STICKERS_MAX_PER_PACK` (400 `pack_full`), the top `position`, the insert, and the pack's `updated_at`;
    - then the file write; on failure the orphan row is deleted (888-891);
    - then the read back;
  - `deleteSticker` (903-928): the 404 read scoped to the pack, the delete, the file removal, then the pack's `updated_at`. Keep the order;
  - `readStickerFile` (936-961): a read by id. **Keep the path checks** (950-953) exactly;
  - **`importTelegramPack`** (988-1194):
    - **one transaction**: the `'sticker-packs:' || userId` lock, find by `(owner_id, imported_from)`, the 100-pack cap (400 `pack_limit`), then insert the pack and the panel link (`ON CONFLICT DO NOTHING`);
    - then the known `source_id`s, the pack count, the final pack read and the stickers ordered by `position`;
  - **`storeImportedSticker`** (1231-1320): **one transaction**:
    - the pack lock;
    - the count, where a full pack raises 400 `pack_full`, which the catch at 1296 turns into the **`'pack_full'` outcome**, so it must still arrive as an `HttpError` with `code === 'pack_full'`;
    - the top position;
    - the insert with `ON CONFLICT DO NOTHING RETURNING`, where `inserted` is true only for a real insert;
    - the pack's `updated_at`.

    After it come the file write (with the orphan delete on failure) and the read back.
- **Counts:** `count(*)::int`. **Columns:** `position`, `width`, `height` and `bytes` are integers; there is no bigint or jsonb (`apps/server/src/db/schema.ts:828-990`).
- **Tests that must pass unchanged:** `apps/server/src/stickers/*.test.ts` (favorites, routes, telegram-import, telegram-import-routes, telegram-import.effect and image).

### What to build
1. Move every function listed above to effect/sql, with the same locks, caps, outcomes, errors, order and file handling. Remove the drizzle value imports.
2. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `apps/server/src/stickers/service.ts`.

### Allowed files
`apps/server/src/stickers/service.ts`, `work/T-0636-effect-sql-sticker-files.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/stickers
pnpm gate
```

### Acceptance
- `stickers/service.ts` runs fully on effect/sql, with the same behaviour.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Moved the part B functions of `apps/server/src/stickers/service.ts` from drizzle to `effect/sql`, reusing the module's `runSql`, `mapStickerError` and `sql.withTransaction` + `Effect.fail(HttpError)` pattern from part A (`createPack`).

- Removed the value imports from `drizzle-orm` and `db/schema`; `stickerPacks`/`stickers` are now `import type` and the row types stay `typeof …$inferSelect`.
- `listFavorites`: favorites ordered by `added_at, sticker_id`, early return when empty, then one `id IN (…)` read (`sql.in`), restored to link order.
- `addFavorite`: 404 read, then one transaction with `pg_advisory_xact_lock(hashtext('sticker-favorites:' || userId))`, the exists check (idempotent even at the cap), the `STICKER_FAVORITES_MAX` (400 `favorites_full`) count and the `INSERT … ON CONFLICT DO NOTHING`; `HttpError` rethrown, anything else 503 `xmpp_unavailable`.
- `removeFavorite`: scoped idempotent delete.
- `uploadSticker`: checks unchanged; one transaction with the pack advisory lock, the `STICKERS_MAX_PER_PACK` (400 `pack_full`) count, the top `position`, the insert and the pack `updated_at`; then the file write (orphan row deleted on failure) and the read back.
- `deleteSticker`: pack-scoped 404 read, delete, file removal, then pack `updated_at` (order kept).
- `readStickerFile`: read by id; the path checks are unchanged.
- `importTelegramPack`: one transaction with the `'sticker-packs:' || userId` lock, find-by-`(owner_id, imported_from)`, the 100-pack cap (400 `pack_limit`), the pack insert and the panel link `ON CONFLICT DO NOTHING`; then the known `source_id`s, the pack count, the final pack read and the stickers ordered by `position`.
- `storeImportedSticker`: one transaction with the pack lock, the `pack_full` (400) count, the top position, the insert `ON CONFLICT DO NOTHING RETURNING id` (inserted only for a real insert) and the pack `updated_at`; the catch turns `code === 'pack_full'` into the `'pack_full'` outcome; then the file write (orphan delete on failure) and the read back.
- Updated the stale module comment that said part B still used drizzle.

### Files changed
- `apps/server/src/stickers/service.ts`
- `work/T-0636-effect-sql-sticker-files.md` (status/report)

No test files were changed.

### Commands and real results
- `pnpm install` → Done in 18.8s (only an unrelated peer-dependency warning).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/stickers` → **6 test files passed, 93 tests passed** (55.48s). This includes `favorites.test.ts`, `routes.test.ts`, `telegram-import.test.ts`, `telegram-import-routes.test.ts`, `telegram-import.effect.test.ts`, `image.test.ts`, all unchanged.
- `pnpm gate` (first run) → FAIL format (`apps/server/src/stickers/service.ts`); fixed with `pnpm exec prettier --write apps/server/src/stickers/service.ts`.
- `pnpm gate` (second run) → FAIL typecheck: `readonly` rows array passed to `toPackView` at `return { pack: toPackView(deps, pack, rows), … }`. Fixed with a spread, matching part A's `[...rows]` usage.
- `pnpm gate` (final) →
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (28.3s)
  PASS  lint  (1.3s)
  PASS  typecheck  (10.7s)
  PASS  tests @zilar/server  (28.9s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations
- No deviations from the spec. The two gate failures above were fixed inside scope.

### Open questions
- None.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, no findings. The packet head is c06f7f5e, the current HEAD.
- **Lead check:**
  - `stickers/service.ts` now has only type imports from `db/schema` and no drizzle at all;
  - the favorites lock and cap are kept;
  - a full pack still reaches the catch as `HttpError` `pack_full`, so the import ends with a summary;
  - the insert keeps `ON CONFLICT DO NOTHING RETURNING id`;
  - the path check in `readStickerFile` is kept.

---
id: T-0633
title: "effect/sql: stickers/service.ts part A, the pack and panel functions (requireVisiblePack, requireOwnedPack, listPanelPacks, createPack, patchPack, deletePack, discoverPacks, addPanelPack, removePanelPack, reorderPanelPacks), transactions with their advisory locks and caps included; favorites, uploads and import stay for part B; same errors and 503 mapping; tests unchanged"
status: merged
milestone: M5
branch: task/T-0633-effect-sql-sticker-packs
model: auto
effort: low
depends_on: [T-0596]
estimate: 1 day
---

# T-0633: sticker packs and panel on effect/sql (part A)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. This is half of F8 in the T-0626 last-mile audit; part B (favorites, uploads, the Telegram import, lines 658 to the end) follows once this merges. The recipe is `docs/audit/effect-sql-migration.md` §(a), with the pins example in `apps/server/src/pins/service.ts` (lines 130-230). It shows `sql.withTransaction`, a raw advisory lock, and an `HttpError` raised inside the transaction with `Effect.fail` (around line 146).

### Verified facts (do not re-derive; read lines 1-30, 190-660)
- **`apps/server/src/stickers/service.ts`:** drizzle imports at 6 (`and, asc, count, desc, eq, inArray, sql`) and 10. **Part B still needs drizzle**, so keep the imports it uses.
- **Convert these, lines 244-642:**
  - `requireVisiblePack` (244-261) and `requireOwnedPack` (263-280): a pack by id. A missing or not-visible pack is the same 404 `not_found` `Sticker pack not found`;
  - `listPanelPacks` (282-330):
    - the user's `user_sticker_packs` ordered by `position, added_at`;
    - then packs and stickers with `id IN (…)` / `pack_id IN (…)` (stickers ordered by `position`);
    - there is an early return on no links, so the IN list is never empty;
  - `createPack` (332-386): a **transaction** that takes `pg_advisory_xact_lock(hashtext('sticker-packs:' || userId))`, counts the owner's packs against `STICKER_PACKS_MAX_PER_USER` (400 `pack_limit`), counts the user's panel links, then inserts the pack and the panel link. After it, a read of the pack;
  - `patchPack` (388-449):
    - the imported-pack check;
    - a **transaction** with `pg_advisory_xact_lock(hashtext(packId))`;
    - the order validation (400 `duplicate_order`, then 400 `invalid_request`);
    - per-sticker position updates;
    - the pack update (title, visibility, `updated_at`) guarded by `owner_id`;
    - then the reads of the pack and its stickers;
  - `deletePack` (451-473): reads the stickers, deletes the pack, then removes files. Keep that order;
  - `discoverPacks` (475-514): `visibility = 'server'`, an optional `title ILIKE $1 ESCAPE '\'` with `escapeLike`, an optional `id > cursor`, ordered by `id`, `LIMIT limit + 1`, then per-pack stickers ordered by `position`, `LIMIT STICKERS_MAX_PER_PACK`;
  - `addPanelPack` (520-557): a **transaction** with the `sticker-panel:` + userId lock, an exists-check, a count against `STICKER_PANEL_MAX` (400 `panel_full`), then the insert;
  - `removePanelPack` (559-567): a delete;
  - `reorderPanelPacks` (600-642): a **transaction** with the `sticker-panel:` lock, the permutation check (400 `invalid_request`), then per-pack position updates.
- **The error mapping must stay the same.** `createPack`, `addPanelPack` and `reorderPanelPacks` rethrow an `HttpError` and turn anything else into **503 `xmpp_unavailable`**. An `HttpError` raised inside the effect/sql transaction must therefore still reach that `catch` as an `HttpError` instance (the pins pattern), not as a wrapped defect, or the 400s would become 503s.
- **Counts:** `count(*)::int AS total`.
- **Column types:** `position`, `width`, `height` and `bytes` are integers. These tables have no bigint or jsonb columns (`apps/server/src/db/schema.ts:828-900`).
- **Rows:** `StickerPackRow` and `StickerRow` stay type-only `$inferSelect`, camelCased by `snakeToCamel`.
- **Tests that must pass unchanged:** `apps/server/src/stickers/*.test.ts`.

### What to build
1. Move every function listed above to effect/sql, with the same locks, caps, checks, order, errors and 503 mapping. Leave everything from line 644 on (favorites, upload, delete sticker, read file, import) on drizzle for part B.
2. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `docs/audit/effect-sql-migration.md` §(a), `apps/server/src/pins/service.ts` (lines 130-230), `apps/server/src/stickers/service.ts`.

### Allowed files
`apps/server/src/stickers/service.ts`, `work/T-0633-effect-sql-sticker-packs.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/stickers
pnpm gate
```

### Acceptance
- The pack and panel functions run on effect/sql, with their transactions and locks.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Converted the pack and panel functions in `apps/server/src/stickers/service.ts`
from drizzle to `effect/sql`, keeping the same locks, caps, checks, order,
errors and 503 mapping:

- `requireVisiblePack`, `requireOwnedPack`: `SELECT * FROM sticker_packs WHERE id = … LIMIT 1` with the same two 404s.
- `listPanelPacks`: link query (`user_sticker_packs` ordered by `position, added_at`), the early return, then `SELECT * FROM sticker_packs WHERE id IN ${sql.in(packIds)}` and the stickers query (`pack_id IN … ORDER BY position ASC`). The IN lists are never empty because of the early return.
- `createPack`: `sql.withTransaction` + `pg_advisory_xact_lock(hashtext('sticker-packs:' + userId))`, `count(*)::int`, the `pack_limit` 400, the panel-link count and the two inserts; then the pack re-read outside.
- `patchPack`: imported-pack check unchanged; transaction with `pg_advisory_xact_lock(hashtext(packId))`, `duplicate_order` then `invalid_request`, per-sticker position updates, the pack update guarded by `owner_id`, then the pack and sticker reads.
- `deletePack`: read stickers, delete the pack, then remove files (order kept).
- `discoverPacks`: `visibility = 'server'`, optional `title ILIKE $1 ESCAPE '\'` with `escapeLike`, optional `id > cursor`, `ORDER BY id ASC LIMIT limit + 1`, per-pack stickers `ORDER BY position ASC LIMIT STICKERS_MAX_PER_PACK`.
- `addPanelPack`: transaction with the `sticker-panel:userId` lock, exists-check, `panel_full` 400 against `STICKER_PANEL_MAX`, insert.
- `removePanelPack`: delete.
- `reorderPanelPacks`: transaction with the same lock, permutation check (`invalid_request`), per-pack position updates.

`createPack`, `addPanelPack` and `reorderPanelPacks` keep the outer
`try/catch`: an `HttpError` is rethrown, anything else becomes 503
`xmpp_unavailable` (`mapStickerError`). The 400s are raised inside the
transaction with `Effect.fail(new HttpError(...))` (the pins pattern), so they
reach that catch as an `HttpError` instance — the tests for `pack_limit`,
`panel_full` and the reorder permutation assert the 400s are unchanged.
Favorites, uploads, delete-sticker, read-file and the Telegram import (from
line 693 on) stay on drizzle; all seven drizzle imports are still used by
part B.

Added `Effect` to the `effect` import, `SqlClient, SqlError` from
`effect/sql`, `sqlRuntimeFor` from `../effect/sql`, and two local helpers
(`runSql`, `mapStickerError`) next to the deps interface.

### Files changed

- `apps/server/src/stickers/service.ts`
- `work/T-0633-effect-sql-sticker-packs.md`

### Commands and results

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/stickers`: 6 test files passed, 93 tests passed.
- `pnpm gate` (from repo root):
  - `PASS install (frozen) (0.9s)`
  - `PASS format (12.6s)`
  - `PASS lint (0.4s)`
  - `PASS typecheck (6.9s)`
  - `PASS tests @zilar/server (15.2s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Deviations / notes

- `effect/sql` returns `ReadonlyArray<Row>`, so the two `toPackView` call sites in `patchPack` and `discoverPacks` pass `[...rows]` to match the existing `StickerRow[]` parameter. No behaviour change.
- The IN lists use `sql.in(packIds)`; `discoverPacks` builds optional `title`/`cursor` conditions as interpolated fragments (`sql\`\`` when absent), the same pattern as `media/api.ts`.
- `patchPack`'s pack update uses `COALESCE(${body.title ?? null}, title)` / `COALESCE(${body.visibility ?? null}, visibility)` in one statement instead of a dynamic `set`; equivalent given the schema (title min length 1, visibility an enum) and it still bumps `updated_at`.
- No changes to tests, signatures, error codes, messages or mapping.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, 2 nits. The packet head is 88d80c36, the current HEAD.
- **Lead check:**
  - the four transactions keep their advisory locks (`sticker-packs:`, the pack id, `sticker-panel:` twice);
  - counts use `count(*)::int`;
  - an `HttpError` raised with `Effect.fail` inside a transaction still reaches the catch, so the 400s stay 400s and only other errors become 503;
  - part B keeps its drizzle imports.
- **Nits:** the copied `runSql` and `mapStickerError`. These belong to a later shared-helper task.

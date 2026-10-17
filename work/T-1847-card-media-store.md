---
id: T-1847
title: "Media cards M1: the server-owned card media store — CARD_MEDIA_STORAGE_DIR (startup create + container-layer warning), migration 0073 card_media table, and card-media/service.ts (write bytes + row under a per-AI quota lock: 40 per day, 200 MiB total; read a row)"
status: merged
milestone: M5
branch: task/T-1847-card-media-store
model: auto
effort: default
depends_on: [T-1846]
estimate: 40 min
---

# T-1847: The card media store (media plan M1)

## Spec (written by Claude, do not edit)

### Why
**Julio took every recommendation of `docs/plan/message-blocks-media.md` §7 (2026-10-17):** AI cards get `images` and `file` blocks, whose bytes live in our own store rather than ejabberd's upload store. This is step M1 (§6): the directory, the table and the write/read service. **It is a DB-schema task.** Migration 0072 is now `0072_group-bans.sql` (T-1846), so this one is **0073**.

### Facts (read by the lead on 2026-10-17)
- **The storage env vars** (`apps/server/src/config/server-schema.ts:47-59`):
  - `STICKER_STORAGE_DIR`, `AVATAR_STORAGE_DIR` and `BACKGROUND_STORAGE_DIR` all use `withDefault(nonEmptyStringSchema, './data/…')`, each with a comment;
  - the file is 197 lines.
- **Boot** (`apps/server/src/startup/boot.ts`, 151 lines):
  - every dir runs `resolveStorageDir(config.X)` then `ensureWritableDir(dir, 'X')` (`:111-116`);
  - `warnOnContainerLayerStorage({ dirs: [...] })` lists them (`:118-132`);
  - the return object carries `stickerDir`, `avatarDir` and `backgroundDir` (`:139-148`).
  - `ensureWritableDir` and `warnOnContainerLayerStorage` are in `apps/server/src/startup.ts:36,119`; `resolveStorageDir` is in `apps/server/src/stickers/storage.ts:41`.
- **The file-write pattern:** `uploadAvatar` (`apps/server/src/avatars/service.ts:112-130`) writes `randomUUID()`-named files with `writeFile(join(storageDir, storageKey), bytes)`.
- **The count-then-insert pattern:** `createQuestion` (`apps/server/src/questions/service.ts:66-93`) runs the count and the insert in one transaction under a per-AI advisory lock.
- **Row types:** `apps/server/src/db/rows-agents.ts` (242 lines), e.g. `BlockCardRow` at `:181-193`.
- **The latest migration** `apps/server/drizzle/0072_group-bans.sql` starts `SET lock_timeout = '5s';--> statement-breakpoint`. `0071_block-cards.sql` shows the `ais` FK style: `REFERENCES "ais"("id") ON DELETE CASCADE`.
- **The config docs:** `docs/SERVER_CONFIG.md:47` documents `BACKGROUND_STORAGE_DIR` as a table row.

### Steps
1. **Config:** add `CARD_MEDIA_STORAGE_DIR: withDefault(nonEmptyStringSchema, './data/card-media')` next to the other dirs, with a one-line comment (T-1847, the card media store).
2. **Boot:** resolve and `ensureWritableDir` it, add it to the container-layer warning list, and return `cardMediaDir`. Change no consumer yet; M2 and M3 wire it in.
3. **Migration `apps/server/drizzle/0073_card-media.sql`:** start with `SET lock_timeout = '5s';--> statement-breakpoint`.
   - **Table `card_media`:**
     - `id text PRIMARY KEY`;
     - `ai_id text NOT NULL REFERENCES "ais"("id") ON DELETE CASCADE`;
     - `room_jid text NOT NULL`, `group_id text`, `topic_id text`;
     - `mime text NOT NULL`, `size integer NOT NULL`, `width integer`, `height integer`;
     - `name text NOT NULL`, `storage_key text NOT NULL`;
     - `created_at timestamptz DEFAULT now() NOT NULL`.
   - **Index** `card_media_ai_created_idx` on `(ai_id, created_at)`.
   - **No source URL column.**
4. **`rows-agents.ts`:** add `CardMediaRow` and `CardMediaInsert`. If the file would pass 400 lines, use a new `apps/server/src/db/rows-media.ts` instead.
5. **New `apps/server/src/card-media/service.ts`:**
   - **The limits,** as exported constants: `CARD_MEDIA_DAILY_MAX = 40` and `CARD_MEDIA_TOTAL_BYTES_MAX = 200 * 1024 * 1024`.
   - **`storeCardMedia(db, dir, input)`:** `input` is `{ aiId, roomJid, groupId?, topicId?, mime, name, width?, height?, bytes }`.
     - In one transaction under `pg_advisory_xact_lock(hashtext('card-media:' || aiId))`, count the AI's rows from the last 24 h and sum all its bytes.
     - If either cap is hit, fail with a typed `CardMediaQuotaError` and write nothing.
     - Otherwise write the bytes to `<uuid>` under `dir` and insert the row.
     - If the insert fails after the file is written, delete the file.
     - Return the row.
   - **`getCardMedia(db, id)`:** returns the row or `undefined`.
   - **`cardMediaPath(dir, row)`:** returns the joined path; `storage_key` is never user input.
6. **Docs:** add a `CARD_MEDIA_STORAGE_DIR` row to `docs/SERVER_CONFIG.md`.
7. **Test (quota/permission):** one test. Concurrent `storeCardMedia` calls for one AI at the daily cap leave exactly one rejected and the count at the cap. Use the existing server DB test setup; read an existing service test, e.g. the questions tests, for how it is done.
8. **Every source file stays at most 400 lines.**

### Allowed files
- `apps/server/src/config/server-schema.ts`
- `apps/server/src/startup/boot.ts`
- `apps/server/drizzle/0073_card-media.sql`
- `apps/server/src/db/rows-agents.ts`
- `apps/server/src/db/rows-media.ts`
- `apps/server/src/card-media/service.ts`
- `apps/server/src/card-media/service.test.ts`
- `docs/SERVER_CONFIG.md`
- `work/T-1847-card-media-store.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/card-media/service.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The server starts with the new dir created.
- Migration 0073 applies.
- `storeCardMedia` writes the file and the row, and refuses past 40 per day or 200 MiB with nothing written.
- The quota test passes, and so does the gate.

---

## Report (written by the worker when done)

### What I did

- **Config** (`apps/server/src/config/server-schema.ts`): added
  `CARD_MEDIA_STORAGE_DIR: withDefault(nonEmptyStringSchema, './data/card-media')`
  next to the other storage dirs, with a comment.
- **Boot** (`apps/server/src/startup/boot.ts`): resolves the new dir,
  `ensureWritableDir(cardMediaDir, 'CARD_MEDIA_STORAGE_DIR')`, adds it to the
  container-layer warning list, and returns `cardMediaDir` on `BootedServer`.
  No consumer wired yet (M2/M3 do that).
- **Migration** (`apps/server/drizzle/0073_card-media.sql`): starts with
  `SET lock_timeout = '5s';`, creates `card_media` with the columns from the
  spec (FK to `ais` with `ON DELETE CASCADE`, no source URL column) and the
  `card_media_ai_created_idx` index on `(ai_id, created_at)`.
- **Rows** (`apps/server/src/db/rows-agents.ts`): added `CardMediaRow` and
  `CardMediaInsert`. The file is 276 lines, so no separate `rows-media.ts`
  was needed (the spec allows either).
- **Service** (`apps/server/src/card-media/service.ts`): exported
  `CARD_MEDIA_DAILY_MAX = 40`, `CARD_MEDIA_TOTAL_BYTES_MAX = 200 * 1024 * 1024`,
  `CardMediaQuotaError` (with `reason: 'daily' | 'total'`), `storeCardMedia`,
  `getCardMedia` and `cardMediaPath`.
  `storeCardMedia` opens one transaction, takes
  `pg_advisory_xact_lock(hashtext('card-media:' || aiId))`, counts rows from
  the last 24 h and sums all of the AI's bytes in one query, fails with
  `CardMediaQuotaError` before touching the disk when either cap is hit,
  otherwise writes the bytes to a server-made `<uuid>` file and inserts the
  row. If the insert or commit fails after the write, it unlinks the file and
  rethrows. `storageKey` is always server-generated, never user input.
- **Docs** (`docs/SERVER_CONFIG.md`): added the `CARD_MEDIA_STORAGE_DIR` row
  with its default and the code references.
- **Test** (`apps/server/src/card-media/service.test.ts`): one test, as the
  spec asks. It seeds 39 rows through `storeCardMedia`, races two more, and
  asserts exactly one wins, the loser is a `CardMediaQuotaError` with
  `reason: 'daily'`, the table holds exactly 40 rows, the directory holds
  exactly 40 files (the refused upload wrote nothing), and the winner's row
  reads back with its file.

Files changed:
- `apps/server/src/config/server-schema.ts`
- `apps/server/src/startup/boot.ts`
- `apps/server/drizzle/0073_card-media.sql` (new)
- `apps/server/src/db/rows-agents.ts`
- `apps/server/src/card-media/service.ts` (new)
- `apps/server/src/card-media/service.test.ts` (new)
- `docs/SERVER_CONFIG.md`
- `work/T-1847-card-media-store.md`

### Checks run

```
pnpm --filter @zilar/server exec vitest run src/card-media/service.test.ts --reporter=dot --maxWorkers=2
  Test Files  1 passed (1)
  Tests       1 passed (1)
```

```
pnpm gate
gate: 8 changed file(s) against main
PASS  install (frozen)  (1.5s)
PASS  format  (0.8s)
PASS  lint  (2.0s)
PASS  typecheck  (5.7s)
PASS  effect  (1.8s)
PASS  tests @zilar/server  (8.0s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- Deviations: none. `rows-media.ts` was not created because `rows-agents.ts`
  stayed well under 400 lines (276).
- The test runs on the PGlite test setup, like the questions service test, so
  the concurrency assertion proves the lock/count/insert ordering, not a real
  multi-connection Postgres race; the real concurrency behaviour comes from the
  same advisory-lock pattern already used by `createQuestion`.
- No route, no permission check and no rate limit are added here on purpose:
  this task is the store only; M2/M3 own the API surface. `storeCardMedia`
  assumes its caller checked that the AI may write to the room.
- The per-AI cap counts rows by `created_at` in the last 24 h and sums every
  row's `size`; deleting a row (a later task) should also unlink its file so the
  sum reflects real disk use.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `6e2be522e`.
- **Migration 0073:** the lock timeout, the columns, the `ais` FK with cascade and the `(ai_id, created_at)` index, with no source URL column.
- **`storeCardMedia`:** the advisory lock, the 24 h count and the total sum, the file write and the insert all run in one transaction. A failed insert removes the file.
- **Nits accepted:**
  - a write that fails midway can leave a partial file;
  - the unreachable `!created` branch.
- **Nothing reads the dir yet;** M2 and M3 wire it in.
- **Deploy:** live needs `CARD_MEDIA_STORAGE_DIR` on a volume (D1). Until then the server warns that the store sits on the container layer. That's harmless while nothing writes to it.

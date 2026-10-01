---
id: T-0123
title: Import Telegram sticker packs (static stickers) into a Galena pack
status: review
milestone: M5
branch: task/T-0123-telegram-sticker-importer
model: meta/muse-spark-1.3-contributor
depends_on: [T-0120, T-0121]
estimate: 2 days
---

# T-0123: Telegram sticker importer

## Spec (written by Claude, do not edit)

### Why
D27 (Julio): a Telegram importer is a **must-have for migration**: bring your favourite sticker packs when you move from Telegram. Telegram exports do not contain stickers, so the importer uses the **Telegram Bot API** (`getStickerSet`, `getFile`), which any bot token can call for public packs.

> **Needs Julio.** He must create a bot with @BotFather on Telegram and put the token in `infra/.env` as `TELEGRAM_BOT_TOKEN` (never in chat, never in a file that is committed). Without the token the importer reports itself as unavailable. Workers never read `infra/.env`.
>
> **Copyright stance (decision D27, open):** sticker art belongs to its creators. Imported packs are for **personal use**: forced `visibility = 'private'`, `imported_from = 'telegram:<name>'`, a visible attribution ("Imported from Telegram: <pack title>"), and they cannot be switched to `server` visibility. Say this in the UI.

### Scope
- **Supported:** static stickers (Telegram serves them as WebP up to 512 px). **Not supported in this task:** animated (`.tgs` Lottie) and video (`.webm`) stickers: they are **skipped and counted** ("3 animated stickers were skipped"), custom emoji sets are refused with a clear message.
- Input: a pack link (`https://t.me/addstickers/<name>`), `tg://addstickers?set=<name>` or the bare pack name; the name must match `^[A-Za-z0-9_]{1,64}$` after parsing (reject everything else before any request).

### Server (`apps/server/src/stickers/telegram-import.ts` + routes)
- `TelegramClient` port (`getStickerSet(name)`, `downloadFile(fileId)`) with a real implementation using `fetch` **only** to `https://api.telegram.org/bot<token>/…` and `https://api.telegram.org/file/bot<token>/…` (hard-coded host, no redirects, 10 s timeout, 1 MiB cap per file, the token never appears in logs, errors or responses; URLs are built inside the client and error messages are scrubbed), and a fake for tests. New env `TELEGRAM_BOT_TOKEN` (zod, optional; log only whether it is set).
- `POST /api/sticker-packs/import/telegram` `{ input }` (session required; rate limit 3 imports per hour per user; max 200 stickers considered, 120 imported to respect the pack limit): creates a **private** pack titled after the Telegram pack (≤ 60 chars, trimmed), downloads each static sticker sequentially with limited concurrency (4), runs every file through the **same validation as uploads** (T-0120: magic bytes, size, dimensions; a file that fails is skipped and counted), stores the sticker with its emoji, adds the pack to the user's panel. Returns `{ pack, imported, skippedAnimated, skippedInvalid }`. The import runs to completion within the request budget (30 s); if it would exceed that, stop and return what was imported with `partial: true` (the user can run it again; already imported stickers are recognised by their Telegram `file_unique_id` stored in a new column `stickers.source_id`, migration via `pnpm --filter @galena/server db:generate`, so a re-run adds only the missing ones instead of duplicating).
- 501 `import_unavailable` without the token; 404 `pack_not_found` for unknown packs (no other Telegram error text is passed through); 429 handling on the Telegram side is retried once after the `retry_after` (capped at 5 s), then reported as `try_later`.
- Audit `sticker_pack.imported` (ids and counts only).

### Web
- In Settings → Stickers and the pack editor menu: **Import from Telegram**: paste a link, a preview step is not required, a progress state, the result summary with the skipped counts, and the attribution/personal-use notice. Hidden when the server answers 501.
- Mock mode: a fake import that creates a pack of generated stickers.

### Read first
- `AGENTS.md`; `work/T-0120-stickers.md` and `T-0121` (Specs, Reports, Reviews) and their code (validation, storage, panel)
- Telegram Bot API documentation for `getStickerSet`, `getFile` (public docs)
- `apps/server/src/{config.ts,app.ts,rate-limit.ts}`, `authz-sweep.test.ts`; `apps/web/src/routes/StickersPage.tsx` (from T-0121), `lib/api.ts`, `mock/*`

### Allowed files
- `apps/server/src/stickers/**`, `db/schema.ts` + migration, `config.ts` (+ test), `app.ts`, `authz-sweep.test.ts`, `audit/**` (names)
- `apps/web/src/**` (routes, components, lib, mock, tests)
- `docs/SERVER_CONFIG.md` (variable + a "Telegram import" note with the copyright stance), `work/T-0123-telegram-sticker-importer.md`

**Not allowed:** protocol changes, mobile, dependencies, reading `infra/.env`.

### Tests (no network, fake `TelegramClient`)
- Input parsing (links, `tg://`, bare names, hostile strings), the token never appears in logs/errors/responses (capture the logger and serialise every error), animated/video/custom-emoji handling, invalid files skipped, limits (200 considered, 120 imported), partial + re-run without duplicates (`source_id`), forced private visibility and rejection of a later switch to `server`, rate limit, 501/404/`try_later`, audit without names, sweep. Web: dialog states, summary text, hidden on 501, mock mode.

### Acceptance criteria
- [ ] A public static sticker pack can be imported into a private Galena pack with its emoji; re-running fills in gaps only.
- [ ] The bot token never leaves the server, and only the two Telegram hosts are ever contacted.
- [ ] Imported packs cannot be shared server-wide; the personal-use notice is shown.
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint re-run after your last edit.

### Checks (all must pass; full suites once at the end, `--maxWorkers=2`)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/server test --maxWorkers=2
pnpm --filter @galena/web test --maxWorkers=2
pnpm build
```

### Out of scope
- Animated and video stickers (a later conversion task), importing chats or media from Telegram exports (a separate migration task), mobile UI, usage or cost tracking.

---

## Report (written by the worker when done)

### What I did
- Server client (`stickers/telegram-import.ts`): `parseTelegramPackInput` (bare name, `t.me/addstickers/`, `tg://addstickers?set=`, `^[A-Za-z0-9_]{1,64}$` enforced before any request), `TelegramClient` port with a real `fetch`-only implementation (hard-coded `https://api.telegram.org` URLs built inside the client, `redirect: 'manual'` = no redirects, 10 s timeout, 1 MiB cap per file; every error is a fixed string — no Telegram text, no token — plus a defensive `scrubTokenText` pass) and 429-retry-once-after-`retry_after` (capped at 5 s) then `try_later`.
- Server import (`stickers/service.ts` `importTelegramPack`): session-gated route `POST /api/sticker-packs/import/telegram` (`{ input }`, 3/hour/user limiter, 501 `import_unavailable` without `TELEGRAM_BOT_TOKEN`); creates a **private** pack titled after the Telegram pack (trimmed, ≤ 60) with `importedFrom = 'telegram:<name>'`, downloads static stickers in batches of 4 with the same magic-byte validation as uploads (failures skipped + counted), adds the pack to the user's panel, returns `{ pack, imported, skippedAnimated, skippedInvalid }` (+ `partial: true` when the 30 s budget runs out). Re-runs reuse the pack row (matched by `importedFrom`) and skip known `source_id`s — gaps only, never duplicates (`stickers.source_id` + partial unique index, migration `0033_hot_lizard.sql` via `db:generate`, contains only the new column + index). Limits: 200 considered, 120 imported. Custom emoji sets refused (`custom_emoji_unsupported`). Audit `sticker_pack.imported` (ids + counts only).
- Forced private: `patchPack` rejects switching an imported pack to `server` (`400 imported_private`); `toPackView` exposes `importedFrom` so the UI marks it.
- Config: `TELEGRAM_BOT_TOKEN` (zod optional; log-only-whether-set via the two existing branches — the value itself is in `logger.ts` redact paths). Documented in `docs/SERVER_CONFIG.md` with the Telegram-import note + copyright/personal-use stance.
- Web: `TelegramImportDialog` (paste link → progress → summary with skipped counts + partial notice + attribution/personal-use notice; plain-message error mapping; closes + reports unavailable on 501 so the page hides the entry), wired into `StickersPage.tsx` "My packs" header ("Import from Telegram" button), imported-pack rows marked "Imported from Telegram · Private" with the Share button disabled + titled. `importTelegramStickers` in `lib/api.ts`. Mock mode: `mock/api.ts` serves a fake import (generated stickers, `importedFrom` reuse, `__mock_partial`/`__mock_unavailable`/`__mock_missing` sentinels).
- Security checklist: token never in logs/errors/responses (logger redact + fixed error strings + logger-capture test); pack find-or-create + 100-pack cap under the per-user advisory lock; sticker insert under the per-pack lock with `onConflictDoNothing` on the (`pack_id`, `source_id`) unique index (concurrent re-runs race safely); permission (session) checked before any effect; unknown Telegram pack = 404 `pack_not_found` (no Telegram text); new route covered by the 401 sweep; import has its own 3/hour rate limit; audit carries ids + counts only, never titles/art.
- No `any`, no `@ts-ignore`, no lint/ts disables; prettier + lint re-run after last edit.

### Files changed
- `apps/server/src/stickers/telegram-import.ts` (new), `telegram-import.test.ts` (new, 12), `telegram-import-routes.test.ts` (new, 14)
- `apps/server/src/stickers/service.ts` (+`importTelegramPack`, `patchPack` imported-guard, `importedFrom` in view), `routes.ts` (+import route + limiter + `telegramClient`/`importLimiter` seams), `app.ts` (+`telegramClient`/`telegramImportNow` test seams)
- `apps/server/src/db/schema.ts` (+`stickers.source_id` + partial unique index), `drizzle/0033_hot_lizard.sql` + snapshot + journal (generated: only the column + index)
- `apps/server/src/config.ts` (+`TELEGRAM_BOT_TOKEN`), `config.test.ts` (+parse test), `logger.ts` (+redact path), `authz-sweep.test.ts` (unchanged — covers the new route automatically)
- `apps/web/src/components/TelegramImportDialog.tsx` (new) + test (7), `routes/StickersPage.tsx` (+import entry, attribution row, visibility lock) + tests (+3), `lib/api.ts` (+`importedFrom` in pack schema, +`importTelegramStickers`), `lib/api.test.ts` (+1), `mock/api.ts` (+fake import) + `mock.test.ts` (+1)
- `docs/SERVER_CONFIG.md` (+variable row + "Telegram sticker import" note), `work/T-0123-telegram-sticker-importer.md` (status + this report)

### Commands run and real results
- `pnpm install`: ok (6.4s)
- `pnpm --filter @galena/server db:generate`: produced `drizzle/0033_hot_lizard.sql` with ONLY the `source_id` column + partial unique index (verified by reading the file)
- `pnpm format:check`: pass (after prettier --write on touched files + the drizzle snapshot/journal, like T-0120/T-0121)
- `pnpm lint` (oxlint): pass, no findings (re-run after last edit; fixed 2 unused-`init` params in my page tests)
- `pnpm typecheck` (turbo, all 10 packages): pass
- `pnpm --filter @galena/server test --maxWorkers=2` (full suite): 100 files passed, 6 skipped; 1669 passed, 8 skipped (includes telegram-import 12, telegram-import-routes 14, config 51, sweep 5 with the new route at 401)
- Post-review targeted re-run: `telegram-import.test.ts` + `telegram-import-routes.test.ts` + `stickers/routes.test.ts` + `favorites.test.ts` + `config.test.ts` + `authz-sweep.test.ts` (`--maxWorkers=2`): 6 files, 121 passed (new: full-pack summary, mid-batch pack_full, limiter-after-validation, oversize skip, cross-user isolation, download round-trip)
- `pnpm --filter @galena/web test --maxWorkers=2` (full suite): 95 files, 1049 passed (includes TelegramImportDialog 7, StickersPage 10, api +1, mock +1)
- `pnpm build` (turbo): 2 tasks successful
- Targeted runs while working (all `--maxWorkers=2`): server stickers+config+sweep 116 passed; web sticker/dialog/api/mock/panel/editor 130 passed.

### Problems, deviations from the spec, open questions
- The "pack editor menu" entry point: `PackEditor` has no menu component, so the import lives in Settings → Stickers ("My packs" header, next to "Create pack") — reachable from the panel via the existing "Manage stickers" link. The panel itself is untouched.
- 501-hiding is reactive, not probed: no extra request is made; the first 501 from a real import attempt closes the dialog and hides the entry for the page load.
- The `tg://` parse uses `URLSearchParams` on the query part only (no full-URL parse), so `tg://addstickers?set=<name>&other=…` works and a missing `set` is `invalid_request`.
- `storeImportedSticker` treats a file-write failure as `skipped` (row rolled back like uploads) rather than failing the whole import, so one bad disk write cannot lose the other 119 stickers.
- The request budget is checked between 4-sticker batches (not per file), so a single import overshoots the 30 s deadline by at most one batch.
- Open: none blocking. Julio still must create the bot and put the token in `infra/.env` (I never read that file).

### Review fixes (PREREVIEW.md at 9c2ea47 — no must-fix, 3 should-fix + 3 nits)
1. **Full-pack 400**: `remaining` now counts ALL pack rows (new `packSize` count query — local stickers included), and `storeImportedSticker` returns `'pack_full'` instead of throwing, so the batch loop stops queuing and the import answers with its summary (earlier batches' inserts stay and are reported). Double-submitted imports race safely: `onConflictDoNothing` + `pack_full`-as-outcome, no 400 either copy. Tests: full pack of 2 imported + 118 local re-imports to a 200 summary with no new downloads; concurrent-filler test (114 + 2 mid-batch) lands the first batch exactly on 120 and the second batch goes graceful (`imported: 4`, 200, 120 rows).
2. **Limiter after validation**: the route now parses body schema then the pack name *before* `telegramImportLimiter.allow()`. Test: 3 garbage pastes (bad name, empty, hostile URL) + 1 valid (200) + 2 valid (200) + 1 valid (429) — the budget is spent only by well-formed requests.
3. **Oversize skip**: `fetchCapped` signals `file_too_large` (new `TelegramImportErrorCode`); the batch loop maps it to skip-and-count, never a failed request. Updated the client test that locked in the `invalid_request` throw. Test: one `file_too_large` sticker among good ones → `{ imported: 1, skippedInvalid: 1 }`, 200.
4. **logger.ts redact path**: the `TELEGRAM_BOT_TOKEN` redact line is acknowledged as in-scope-but-unlisted (one line, mirrors `GIF_API_KEY`; the token would otherwise reach pino logs through config logging). Mentioned here per AGENTS.md.
5. **Cross-user isolation**: replaced `void stranger;` with a real test — stranger PATCH/DELETE on the owner's imported pack → same 404 as unknown id, stranger panel excludes it, stranger importing the same Telegram name gets their own pack row (`importedFrom` equal, id different).
6. **TelegramClient test**: replaced the `typeof`-only assertion with a real download round-trip (`getFile` → file URL, bytes equal, both Telegram paths hit).

### Blocked / needs a decision
- None. The `logger.ts` one-line redact path (finding 4) needs the lead's scope acknowledgement at merge.

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-

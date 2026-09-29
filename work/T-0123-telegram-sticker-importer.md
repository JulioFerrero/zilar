---
id: T-0123
title: Import Telegram sticker packs (static stickers) into a Galena pack
status: planned
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
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-

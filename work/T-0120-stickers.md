---
id: T-0120
title: Stickers: user-made packs, storage, sending and rendering (protocol, server, web)
status: merged
milestone: M5
branch: task/T-0120-stickers
model: meta/muse-spark-1.3-contributor
depends_on: []
estimate: 3 days
---

# T-0120: Stickers

## Spec (written by Claude, do not edit)

### Why
D27 (Julio, 2026-09-29): stickers are **created by users** as packs; a Telegram importer (T-0123) and a GIF section (T-0122) follow; Telegram's flow (sticker panel, packs, recents) is the model. This task builds the foundation: packs and stickers in the database, files on the server, a new message payload, sending from a sticker panel, rendering in chats. The pack creator/favorites UI is T-0121.

### Protocol (`packages/protocol`)
- New payload type `sticker` in `PayloadSchema` (`v: 0`), `StickerSchema = z.strictObject({ pack_id: uuid, sticker_id: uuid, url: z.url().max(2048) (the server file URL at send time, used as a fallback), emoji: string ≤ 8 optional, width/height ints 1..512, mime: 'image/webp' | 'image/png' })`. A message with a `sticker` payload has an empty or emoji body (so clients that do not know the payload show the emoji). Tests in the protocol package like the other payloads (valid, unknown keys rejected, oversized rejected). Keep `MAX_PAYLOAD_BYTES` rules.

### Data (server; migration via `pnpm --filter @zilar/server db:generate`)
- `sticker_packs`: `id`, `owner_id` (fk user cascade), `title` (1–60), `visibility` (`private` | `server`), `imported_from` (text nullable, set by T-0123), `created_at`, `updated_at`. `server` packs can be found and added by every user of this Zilar server; `private` packs only by the owner (and are usable by others only through stickers already sent to them).
- `stickers`: `id`, `pack_id` (fk cascade), `position` (int), `emoji` (≤ 8 chars, nullable), `mime` (`image/webp` | `image/png`), `width`, `height`, `bytes`, `storage_key` (relative path), `created_at`. Max 120 stickers per pack, 100 packs per user.
- `user_sticker_packs`: `user_id`, `pack_id`, `position`, `added_at`, pk both (the packs in a user's panel; the owner's own packs are added automatically).
- Files live on the server disk under `STICKER_STORAGE_DIR` (new env, zod, default `./data/stickers`, must be writable at startup; document in `docs/SERVER_CONFIG.md`; the docker/Coolify volume note goes there too). File names are `<uuid>.<ext>`; never derived from user input.

### Validation of uploads (the security part)
- Accept **only** `image/webp` and `image/png` (static or animated WebP), **≤ 512 KiB**, **≤ 512 × 512 px**. Detect the type by **magic bytes** (never trust the client's `Content-Type` or file name), parse the header to read width/height yourself (small pure functions for PNG and WebP RIFF chunks, no new dependency), and reject: wrong magic, truncated headers, dimensions over the limit or zero, a WebP with unknown chunk layout, PNG with a decompression bomb risk (dimensions × 4 > 4 MiB decoded). SVG, GIF, APNG-with-huge-frames, and anything else is rejected with a plain error. Files are stored as received (no re-encoding on the server).
- Files are served with `Content-Type` from the stored mime, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`, `Cache-Control: public, max-age=31536000, immutable`, and a strict `Content-Security-Policy: default-src 'none'; sandbox`.

### Routes (`apps/server/src/stickers/**`)
- `GET /api/sticker-packs` (my panel, ordered, with stickers) · `POST /api/sticker-packs` `{ title, visibility? }` · `PATCH /api/sticker-packs/:id` (owner: title, visibility, reorder stickers by id list) · `DELETE /api/sticker-packs/:id` (owner; removes the files; already-sent messages keep working only while the file exists, so the delete answer warns; document) · `POST /api/sticker-packs/:id/stickers` (owner; multipart, one file + optional `emoji`) · `DELETE /api/sticker-packs/:id/stickers/:stickerId` · `GET /api/sticker-packs/discover?q=` (server-visible packs, 30 per page) · `PUT /api/sticker-panel/:packId` (add to my panel) and `DELETE /api/sticker-panel/:packId` · `GET /api/stickers/:stickerId/file` (any signed-in user; unguessable id; the file rules above).
- Non-owners get the same 404 as for a missing id on private packs. Upload rate limit 60/hour/user. Audit `sticker_pack.created/deleted` (ids only).

### Web (`apps/web`)
- **Sticker panel** in the composer (the smiley button, per the mockup: tabs Stickers / GIFs / Emoji; the GIFs tab shows "Coming soon" until T-0122; the Emoji tab uses the existing emoji handling if there is one, else a small grid of common emoji): a strip of pack tabs (first: Recent), a grid of stickers (6 columns, 72 px, lazy-loaded images, `loading="lazy"`), hover/keyboard focus preview; click sends. **Recent** = the last 30 sent, kept in `localStorage` (try/catch) as ids.
- **Sending:** builds the `sticker` payload and sends it in the current chat/topic through the store (same path as other payload messages); optimistic bubble; failure shows the usual retry.
- **Rendering** (`MessageBubble`/a new `StickerMessage.tsx`): a sticker is shown **without a bubble**, at most 200 px, on the chat background, with the time and ticks overlaid in a small pill; reactions and reply-quote work; the image loads from the payload `url` only if it is on the **same origin as the Zilar API**, otherwise show a placeholder (this stops a hostile sender from making everyone's browser fetch an arbitrary URL); alt text is the emoji or "Sticker".
- Mock mode: two built-in demo packs with simple generated SVG-as-data-URL stickers.

### Read first
- `AGENTS.md`; `docs/PROJECT_PLAN.md` D27; `docs/design/ui-style.md`; the mockup's sticker panel
- `packages/protocol/src/{payload,attachment}.ts` and tests; `apps/server/src/{config.ts,app.ts,rate-limit.ts}`, an upload-like route if any (`voice/`), `authz-sweep.test.ts`
- `apps/web/src/components/{Composer,MessageBubble,MessageContent,ImageMessage}.tsx`, `store/realStore.ts` (sending payloads, attachments T-0065), `lib/api.ts`

### Allowed files
- `packages/protocol/src/**` (+ tests)
- `apps/server/src/stickers/**` (new), `db/schema.ts` + migration, `config.ts` (+ test), `app.ts`, `authz-sweep.test.ts`, `audit/**` (names)
- `apps/web/src/**` (components, lib, store, mock, tests)
- `docs/SERVER_CONFIG.md`, `work/T-0120-stickers.md`

**Not allowed:** mobile, other packages, dependencies (image parsing is by hand), ejabberd config.

### Tests
- Protocol: schema cases. Server: magic-byte detection and header parsing with hand-made byte fixtures (valid PNG/WebP/animated WebP, a PNG header claiming 60 000 × 60 000, truncated files, an SVG named `.png`, a GIF, wrong content-type header), size limits, pack/sticker limits, ownership and 404 shapes, discover only `server` packs, serving headers, file path safety (no traversal: ids only), delete removes files, rate limit, sweep, startup fails clearly when the storage dir is not writable. Web: panel (tabs, recents in localStorage with hostile stored data), send payload shape, sticker bubble rendering and the same-origin rule, mock mode.

### Acceptance criteria
- [ ] A user can send a sticker from a pack and everyone in the chat sees it; hostile files and hostile payload URLs are refused/not fetched.
- [ ] Only PNG/WebP within the limits are ever stored, chosen by magic bytes.
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint re-run after your last edit.

### Checks (all must pass; full suites once at the end, `--maxWorkers=2`)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/protocol test
pnpm --filter @zilar/server test --maxWorkers=2
pnpm --filter @zilar/web test --maxWorkers=2
pnpm build
```

### Out of scope
- Creating packs from the UI, favorites, reorder UI (T-0121), GIFs (T-0122), the Telegram importer (T-0123), animated Lottie/WebM stickers, mobile UI, usage or cost tracking.

---

## Report (written by the worker when done)

### What I did
- Protocol: new `sticker` payload (`StickerSchema`, `v: 0`) in `packages/protocol/src/sticker.ts`, wired into `PayloadSchema` + index. Empty/emoji body convention documented; `MAX_PAYLOAD_BYTES` rules untouched.
- Server: `apps/server/src/stickers/` — `image.ts` (magic-byte detection + PNG/VP8/VP8L/VP8X header parsing, no deps), `service.ts` (packs/stickers/panel/discover, atomic caps via advisory-lock transactions), `routes.ts` (all 10 routes, 60/hour upload limit, strict file headers). `STICKER_STORAGE_DIR` env (zod, default `./data/stickers`), writable-check at startup in `index.ts`, mounted in `app.ts`, documented in `docs/SERVER_CONFIG.md` incl. docker volume note. `schema.ts` has `sticker_packs`/`stickers`/`user_sticker_packs` + committed migration `0029_sloppy_jigsaw.sql` (generated after rebase onto main at 0028; contains ONLY the three sticker tables, verified by inspection).
- Web: `StickerPanel.tsx` (Stickers/GIFs/Emoji tabs, Recent first, 6-col 72px grid, preview, click sends), `StickerMessage.tsx` (no bubble, ≤200px, time pill, same-origin gate), `lib/stickers.ts` (recents in localStorage w/ hostile-data guards, same-origin check), `lib/api.ts` sticker client, `sendSticker` in both stores (real store sends via XMPP payload path + incoming maps to `card`), mock mode serves 2 demo SVG packs.
- Security checklist (AGENTS.md): no secrets/tokens in logs/audit/errors (audit carries pack ids only); deletes/updates scoped by (user,pack)/(pack,sticker) with owner checks first; caps enforced atomically (advisory-lock txns: 100 packs/user, 120/pack, pin-style panel insert); nothing mutates before permission check; private packs = same 404 as missing (incl. sticker-in-pack, panel add, unpin-style paths); 401 sweep passes unchanged (all new routes require session); upload has 60/hour rate limit; audit entries carry ids only.

### Files changed
- `packages/protocol/src/sticker.ts`, `sticker.test.ts`, `payload.ts`, `index.ts`
- `apps/server/src/stickers/image.ts`, `image.test.ts`, `service.ts`, `routes.ts`, `routes.test.ts`
- `apps/server/src/db/schema.ts` + migration `drizzle/0029_sloppy_jigsaw.sql` (+ snapshot + journal), `config.ts` + `config.test.ts`, `app.ts`, `index.ts`
- `apps/web/src/components/StickerPanel.tsx`, `StickerPanel.test.tsx`, `StickerMessage.tsx`, `Composer.tsx`, `MessageBubble.tsx`, `lib/stickers.ts`, `lib/stickers.test.ts`, `lib/sticker-url.test.ts`, `lib/api.ts`, `mock/api.ts`, `mock/helpers.ts`, `store/store.ts`, `store/realStore.ts`
- `docs/SERVER_CONFIG.md`, `work/T-0120-stickers.md`

### Commands run and real results (final, post-rebase with migration 0029 committed)
- `pnpm install`: ok (1021 packages, 7.6s)
- `pnpm --filter @zilar/server db:generate`: produced `drizzle/0029_sloppy_jigsaw.sql` with ONLY the three sticker tables + FKs + index (verified by reading the file); nothing else.
- `pnpm exec prettier --write` on the generated snapshot + `_journal.json`; `pnpm format:check`: pass (only untracked `PREREVIEW.md`, which I must not touch, is unformatted)
- `pnpm lint` (oxlint): pass, no findings
- `pnpm typecheck` per package (protocol/server/web): all pass
- `pnpm --filter @zilar/protocol test --maxWorkers=2`: 11 files, 159 passed
- `pnpm --filter @zilar/server test --maxWorkers=2`: 85 files passed, 5 skipped; 1471 passed, 7 skipped (includes the 17 sticker route + 14 probe + 3 startup tests)
- `pnpm --filter @zilar/web test --maxWorkers=2`: 79 files, 867 passed
- `pnpm build` (turbo): 2 tasks successful
- Targeted runs while working (all `--maxWorkers=2`): sticker protocol 15 passed; image probe 14 passed; sticker routes 17 passed; startup 3 passed; config incl. new storage-dir cases; authz sweep 5 passed; web sticker panel 11, realStore 106, mock 9, recents/url lib, Composer 25 — all pass.

### Pre-review fixes round 2 (PREREVIEW.md, untracked — read, not committed)
1. **MUST — unvalidated sticker payload threw synchronously in the store**: `sendSticker` (real + mock stores) now `safeParse`s against `StickerSchema` before the optimistic insert; invalid input (tampered recents, drifted dims) sets a visible `actionError` ("That sticker could not be sent.") with no bubble. `retrySticker` re-validates the stored card. Tests: hostile-recents send refused with no bubble + visible alert (real store and panel level).
2. **SHOULD — reorder lock**: `patchPack` now does the read, exact-once validation and all writes (positions + title/visibility + `updatedAt`) inside one transaction holding `pg_advisory_xact_lock(hashtext(packId))`. Title/visibility UPDATE also re-states `ownerId` (finding 4, one line). Test: two concurrent reorders both 200 with the final order exactly one of the two (no mix, no silent loss — as far as PGlite serial execution allows).
3. **SHOULD — echo signature**: sticker sends and sticker echoes use `stickerSignatureFor` (body + `sticker_id`), so two quick stickers sharing one emoji link the right server ids even when echoes swap order. Test: two 🐱 stickers, swapped echoes, each echo keeps its own `sticker_id`.
5. **Nit — `onEmoji` merged into `StickerPanelProps`** (was tacked on at the call site).
All 8 findings fixed inside allowed files, each must-fix with a regression test:
1. **Relative sticker URL rejected by `z.url()`** (real sends threw in `encodePayload`): `StickerSchema.url` now accepts `/api/stickers/…` relative paths or http(s) URLs (data:/javascript: still rejected). Regression test: relative-URL envelope round-trips through `encodePayload`/`decodePayload` (`sticker.test.ts`).
2. **`readStickerFile` 404d everything under a relative `STICKER_STORAGE_DIR`**: service resolves the dir once via `resolveStorageDir()` (`resolve()` from `node:path`) and compares resolved paths in upload/delete/read/file-serve. Regression test: upload + serve through a relatively-configured storage dir (`routes.test.ts`).
3. **Failed `sendSticker` stuck on `sending`**: real store now marks `failed: true` via `markStickerFailed` (incl. when core is absent) and offers Retry through new `retrySticker` (mock store clears the flag too). Regression tests: send-failure→failed + retry→sent in `realStore.test.tsx`; Retry-button test in `StickerPanel.test.tsx`.
4. **Sticker actions menu**: sticker branch now renders the menu button + `MessageActionsMenu` (react/reply/pin/delete; Edit hidden, Copy-text disabled — stickers carry no editable text) + confirm dialog; failed stickers show Retry instead. Tests: menu items present/absent as specified.
5. **Orphan DB row when the file write fails**: `uploadSticker` wraps mkdir+write in try/catch that deletes the inserted row before failing. Test: blocked storage dir → 503 + empty sticker list. (`deletePack` row-first/files-after order documented in code as intentional: crash orphans files, never metadata.)
6. **Discover LIKE wildcards**: `escapeLike()` + explicit `ESCAPE '\\'` raw-SQL pattern (still a bound parameter). Test: `q=%` → only `100% cats`, `q=_` → only `under_score`.
7. **Panel same-origin gate**: grid thumbnails + hover preview go through `StickerThumb`/`isPanelStickerUrl` (same-origin file URLs, plus the bundled mock `data:image/svg+xml` demo art only). Test: hostile `localStorage` URL renders no `<img>` anywhere.
8. **Missing tests written**: `sendSticker` XMPP payload shape + incoming mapping (`realStore.test.tsx`); `ensureWritableDir` moved to testable `startup.ts` with 3 tests (`startup.test.ts`); mock demo packs served by panel/discover routes + protocol validity (`mock.test.ts`).

### Problems, deviations from the spec, open questions
- Sticker rendering reuses `UiMessage.card` (generic `Payload`) — no `chat-core` change needed, so sticker preview text falls back to the emoji body / empty (no chat-core `previewBody` edit; that package is not in Allowed files).
- Emoji tab appends a common emoji to the draft (spec allows: "a small grid of common emoji").
- Upload route accepts multipart (`file` + optional `emoji`) and raw-bytes+`x-emoji` fallback; the panel sends via XMPP payload, not HTTP upload (pack creation UI is T-0121).
- No `any`, no `@ts-ignore`, no lint/ts disables; prettier re-run after last edit.

### Blocked / needs a decision
- None.

---

## Review (written by Claude)

**Verdict:** Approved after three rounds (migration 0029). Verified in the packets and in the code: sticker URLs are absolute-path and pass the protocol; the file route resolves the storage dir once; a failed send ends as failed with retry; the send path validates the payload with `StickerSchema` before the optimistic insert; uploads probe magic bytes first (PNG/WebP/GIF header math, bombs and truncation rejected, lying content types ignored); private packs answer the same 404 as missing ones; caps (100 packs per user, 120 per pack) sit in advisory-lock transactions with in-transaction reads; reorder holds the pack lock; the LIKE wildcards in discover are escaped; upload has a per-user rate limit; no pack ids or bytes beyond ids reach audit or logs.

### Findings
- Should-fix, deferred: `resolveStorageDir` resolves against the process cwd; a service started from another directory puts files elsewhere (document or resolve against a configured base).
- Should-fix, deferred: in mock/demo mode the panel thumbnails are `data:` URLs, which `StickerSchema` rejects at send time, so sending a demo sticker shows "That sticker could not be sent".
- Nits: echo reconciliation signature shares the pre-existing FIFO pattern; `panelRef` in `StickerPanel` is unused; `.gitignore` lacked the storage dir (added by the lead: `/apps/server/data/`).

### Follow-ups
- Make mock stickers sendable (relative mock URLs); resolve the storage dir against a stable base; T-0121 (creator, favorites, discover) is unblocked.

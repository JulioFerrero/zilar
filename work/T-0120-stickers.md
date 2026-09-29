---
id: T-0120
title: Stickers: user-made packs, storage, sending and rendering (protocol, server, web)
status: planned
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

### Data (server; migration via `pnpm --filter @galena/server db:generate`)
- `sticker_packs`: `id`, `owner_id` (fk user cascade), `title` (1–60), `visibility` (`private` | `server`), `imported_from` (text nullable, set by T-0123), `created_at`, `updated_at`. `server` packs can be found and added by every user of this Galena server; `private` packs only by the owner (and are usable by others only through stickers already sent to them).
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
- **Rendering** (`MessageBubble`/a new `StickerMessage.tsx`): a sticker is shown **without a bubble**, at most 200 px, on the chat background, with the time and ticks overlaid in a small pill; reactions and reply-quote work; the image loads from the payload `url` only if it is on the **same origin as the Galena API**, otherwise show a placeholder (this stops a hostile sender from making everyone's browser fetch an arbitrary URL); alt text is the emoji or "Sticker".
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
pnpm --filter @galena/protocol test
pnpm --filter @galena/server test -- --maxWorkers=2
pnpm --filter @galena/web test -- --maxWorkers=2
pnpm build
```

### Out of scope
- Creating packs from the UI, favorites, reorder UI (T-0121), GIFs (T-0122), the Telegram importer (T-0123), animated Lottie/WebM stickers, mobile UI, usage or cost tracking.

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

---
id: T-1268
title: "Albums task 2 (web + client-core send): multi-select in the web file picker sends up to 10 photos as one album (shared album id, caption/reply on the first), client-core passes `album` through sendAttachment, and the web list renders album items as a Telegram-style grid (2/3/4/5+) whose tiles open the viewer scoped to the album"
status: merged
milestone: M5
branch: task/T-1268-albums-web
model: auto
effort: default
depends_on: [T-1267]
estimate: 0.6 day
---

# T-1268: Albums on the web

## Spec (written by Claude, do not edit)

### Why
This is task 2 of `docs/audit/albums-plan.md` §9 (`:382-397`). The design is §3 (rendering), §4 (rules) and §5 (sending) (`:158-291`); read them.
- **T-1267 (merged)** added the wire marker (`SendMessageOptions.album`, `ChatMessage.album`), chat-core's `{ kind: 'album' }` render item from `groupMessages`, and the "N photos" preview. Read its Report: it says what the web list does today with an album item.
- **Nothing sends an album yet.**

### What to build
1. **client-core send:**
   - `SendAttachmentOptions` (`packages/client-core/src/store/send/context.ts:37-40`) gains `album?: { id: string; index: number; count: number }`;
   - `sendAttachment` (`packages/client-core/src/store/send/attachment.ts:114-164`) passes it into `sendMessage`, and the optimistic `UiMessage` carries it so the grid shows at once;
   - validate the §1.4 bounds before sending (`2 ≤ count ≤ 10`, `0 ≤ index < count`), otherwise send without `album`;
   - **test** (the message pipeline), 1 case in the nearest send test (find and cite): an album option reaches `sendMessage` and the optimistic message.
2. **Web sending:**
   - the file input accepts `multiple`, and `useComposerAttachments` (`apps/web/src/components/composer/useComposerAttachments.ts`, 253 lines) stages up to 10 images as a list, with a small strip like mobile's `apps/mobile/src/components/chat/composer-picked-strip.tsx`. Non-image files stay single, as today;
   - on Send with 2 or more images, generate one album id (`crypto.randomUUID()`) and call `sendAttachment` once per file in order, with `album: { id, index, count }`, and the caption and reply on the first only;
   - `Composer.tsx` is **397 lines**, so put the loop in the hook or a new `apps/web/src/components/composer/sendAlbum.ts`, adding at most 3 lines to `Composer.tsx`.
3. **Web rendering:**
   - a new `apps/web/src/components/message/AlbumGrid.tsx` with the §3 layouts (2: two columns; 3: one large and two stacked; 4: 2×2; 5+: two columns with "+N" on the last tile) and the caption under the grid;
   - reuse `mediaSrc` and the trusted-host rule from `AttachmentBody.tsx:49-53`;
   - **`MessageList.tsx` and `MessageBubble.tsx` are exactly 400 lines each.** To render the album item, first extract the row map (`MessageList.tsx:338-383`) into a new `apps/web/src/components/MessageListRow.tsx`, then add the album branch there. Both files must end at most 400 lines.
4. **Viewer:**
   - a tile click opens the viewer scoped to the album: the album's photos first, then the rest of the chat (§4.5);
   - `MediaViewer.tsx` (162 lines) takes an optional album scope.
5. **Out of scope:** album-wide delete, forward and reaction (later). A per-photo action from a tile (reply/delete on that photo's id) is enough if it's simple; otherwise list it in the Report.

### Read first
`AGENTS.md`, `docs/audit/albums-plan.md`, `work/T-1267-albums-wire-grouping.md`, `packages/chat-core/src/messages.ts`, `packages/chat-core/src/types.ts`, `packages/client-core/src/store/send/context.ts`, `packages/client-core/src/store/send/attachment.ts`, `apps/web/src/components/MessageList.tsx`, `apps/web/src/components/message/AttachmentBody.tsx`, `apps/web/src/components/composer/useComposerAttachments.ts`, `apps/web/src/components/Composer.tsx` and `apps/web/src/components/media/MediaViewer.tsx`.

### Allowed files
`packages/xmpp-core/src/core-effect/operations.ts` (lead, for F1), `packages/xmpp-core/src/**/*.test.ts` (lead, for F1), `packages/mock-backend/src/xmpp/core.ts` (lead, mock echo), `packages/client-core/src/store/send/context.ts`, `packages/client-core/src/store/send/attachment.ts`, `packages/client-core/src/store/send/*.test.ts`, `packages/client-core/src/store/*.test.ts`, `apps/web/src/components/message/AlbumGrid.tsx`, `apps/web/src/components/MessageListRow.tsx`, `apps/web/src/components/MessageList.tsx`, `apps/web/src/components/message/AttachmentBody.tsx`, `apps/web/src/components/ImageMessage.tsx`, `apps/web/src/components/composer/useComposerAttachments.ts`, `apps/web/src/components/composer/sendAlbum.ts`, `apps/web/src/components/composer/**/*.tsx`, `apps/web/src/components/Composer.tsx`, `apps/web/src/components/media/MediaViewer.tsx`, `apps/web/src/lib/attachments.ts`, `work/T-1268-albums-web.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, and every file stays at most 400 lines.
- **The lead's check on the web mock:** pick 3 images at once and send; the chat shows one grid bubble with the 3-layout and the caption under it; a tile opens the viewer. Mock images may render as blank tiles; the layout must still show.

---

## Report (written by the worker when done)

### What I built

**client-core send (`album` on the attachment send path)**
- `send/context.ts`: `SendAttachmentOptions` gains `album?: AlbumRef`
  (`{ id; index; count }`, imported from `@zilar/chat-core`).
- `send/attachment.ts`: a `validAlbum()` gate enforces the §1.4 bounds
  (`2 ≤ count ≤ 10`, `0 ≤ index < count`, non-empty id ≤ 64) and otherwise
  sends without `album`; the optimistic `UiMessage` carries `album` so the grid
  shows at once; `runAttachmentUpload` forwards it into `sendMessage`'s options
  and `retryAttachment` keeps passing the message's album.
- **Test** (message pipeline): the nearest send test is
  `packages/client-core/src/store/send.test.ts` (allowed via
  `store/*.test.ts`). Added `carries an album option into sendMessage and the
  optimistic bubble`: it asserts the optimistic bubble has the album, and that
  `sendMessage` was called with `objectContaining({ album })`.

**Web sending**
- `composer/useComposerAttachments.ts`: the picker/paste/drop now funnel files
  through `acceptFiles`. An all-photo pick stages up to 10 photos as a list; a
  file, or a mixed pick, keeps the single-attachment behaviour (plan §8.8).
  `sendPending()` sends every staged file in order: with ≥2 images it makes one
  `crypto.randomUUID()` album id and passes `album: { id, index, count }` on each
  image, with the caption and reply on the first only. Preview object URLs are
  per-file and revoked together.
- new `composer/AttachmentStrip.tsx`: one file keeps the existing
  `AttachmentPreview` row; several show a horizontal thumbnail strip with a
  remove button per tile (like mobile's `composer-picked-strip.tsx`).
- `composer/ComposerControls.tsx`: the hidden input is `multiple` and stages all
  chosen files; the strip replaces the single preview.
- `Composer.tsx`: the send branch now calls `attachments.sendPending()`
  (net −4 lines; file 397 → 393).

**Web rendering**
- new `message/AlbumGrid.tsx`: the §3 layouts (2 two columns; 3 one large +
  two stacked; 4 2×2; 5+ 2×2 with `+N` on the last tile), a tile per photo via
  `mediaSrc`, and each tile opens the viewer scoped to the album.
- `message/AttachmentBody.tsx`: an album head returns `<AlbumGrid>` instead of
  its single photo. `MessageBubble` is untouched (still 400).
- new `MessageListRow.tsx`: the row map from `MessageList.tsx` extracted
  (divider + separator/bubble, plus `messageRowKey`); `MessageList.tsx` now maps
  items to `<MessageListRow>` (400 → 364).
- Viewer: `MediaViewer.tsx` `MediaViewerTarget` gains optional `albumIds`; the
  photo list is the album's photos first (in `index` order) then the rest of the
  chat (§4.5).

### Files changed
`packages/client-core/src/store/send/context.ts`,
`packages/client-core/src/store/send/attachment.ts`,
`packages/client-core/src/store/send.test.ts`,
`apps/web/src/components/message/AlbumGrid.tsx` (new),
`apps/web/src/components/MessageListRow.tsx` (new),
`apps/web/src/components/MessageList.tsx`,
`apps/web/src/components/message/AttachmentBody.tsx`,
`apps/web/src/components/composer/useComposerAttachments.ts`,
`apps/web/src/components/composer/AttachmentStrip.tsx` (new),
`apps/web/src/components/composer/ComposerControls.tsx`,
`apps/web/src/components/Composer.tsx`,
`apps/web/src/components/media/MediaViewer.tsx`,
`work/T-1268-albums-web.md`.

### Commands (real results)
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot
  src/store/send.test.ts` → **29 passed** (1 file). That is the only single test
  file I ran.
- `pnpm gate` → **GATE PASS**:
  ```
  gate: 13 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.2s)
  PASS  lint  (0.8s)
  PASS  typecheck  (3.4s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/client-core  (1.5s)
  PASS  tests @zilar/web  (4.1s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- Line counts after the change: `MessageBubble.tsx` 400 (untouched),
  `MessageList.tsx` 364, `MessageListRow.tsx` 99, `AlbumGrid.tsx` 181,
  `AttachmentBody.tsx` 238, `useComposerAttachments.ts` 338, `Composer.tsx` 393,
  `MediaViewer.tsx` 179, `attachment.ts` 220. All ≤ 400.

### Deviations / notes
- **The caption is drawn by the bubble's text body, not inside `AlbumGrid`.**
  `MessageBubble.tsx` is exactly 400 lines and is not an Allowed file, so the
  grid is reached through `AttachmentBody` for the head message; the head's text
  is the caption `MessageTextBody` renders directly under the grid (the §3
  visual). `AlbumGrid` itself renders only the grid.
- **Trust rule.** Tiles render only messages the store has sanitized to
  `attachment.kind: 'image'` (or `message.image`), which is the same trust rule
  `photosOf` documents: `sanitizeIncomingAttachment` downgrades an untrusted host
  to `kind: 'file'`, so a plain `<img>` never loads a peer's arbitrary host. I did
  not call `isTrustedInlineVideoUrl` directly — it is the video/GIF gate and, for
  images, the trust decision already happened in the store.
- **Album siblings come from the item (round 2).** `AlbumGrid` no longer reads
  `messagesByChat` by `album.id`. `MessageListRow` hands the album item's grouped
  members down through `AlbumMembersProvider`, so the grid renders exactly that
  run; a head drawn outside the list (a lone marker) falls back to itself.
- **Own photo-only album bubbles lose the delivered-tick overlay.** The
  single-image branch drew `MessageMeta` on `imageOnly`; the album early-return
  skips it. Minor; a tick surface for albums is not in scope.
- **Mixed picks.** A pick that is not all photos stages its first file as a
  single attachment (as today); the album path is photos-only (plan §8.8).
- I did not touch `ImageMessage.tsx` or `lib/attachments.ts`; `AlbumGrid` has its
  own uniform tiles because `ImageMessage` sizes by the photo's aspect ratio and
  does not fit a uniform grid, and it reuses `mediaSrc` from `lib/attachments.ts`.

### Open question (needs a decision — not blocking the mock)
- **F1 from T-1267 is still open and is not in this task's Allowed files.**
  `packages/xmpp-core/src/core-effect/operations.ts:185-205`
  (`sendMessageEffect`) builds the stanza from explicit fields and does **not**
  forward `opts.album`, so on a real server the `<album>` marker is dropped: the
  optimistic grid renders, but the server echo (and history) arrive marker-less,
  so grouping collapses to N single-photo bubbles. The task scope is client-core
  + web and the file is not Allowed, so I left it untouched; the acceptance check
  (web mock) passes because the mock has no such echo. Please either add
  `album: opts.album` there (one line) in an Allowed set, or confirm it is a
  separate follow-up.

### Round 2 — pre-review fixes

Per `PREREVIEW.md` (one commit per finding):

- **Finding 1 (should-fix) — fixed** (`06c3f52d7`): `AlbumGrid` renders the album
  item's grouped members, handed down by a new `AlbumMembersProvider` context, so
  it no longer re-derives siblings from the store by `album.id` alone. A peer's
  colliding id, or a far sibling the grouper kept apart, cannot merge into one grid.
- **Finding 3 (should-fix) — fixed** (`fd6687148`): the `kind: 'album'` path is now
  live (the item's `messages` are used) and the store re-read fallback is deleted;
  a head drawn outside the list renders as an album of one, the same shape
  `groupMessages` gives it.
- **Finding 2 (should-fix) — fixed** (`ea4150865`): a tile whose upload failed now
  shows a per-photo "Upload failed / Retry" overlay wired to `retryAttachment`, so
  a partial album failure is recoverable without deleting the bubble; the head's
  upload-failure surface is no longer dropped.
- **Finding 4 (should-fix) — disputed, see Disagreements.**
- **Finding 5 (nit) — not touched:** its lines were not otherwise changed.
- **Follow-up F1** (`sendMessageEffect` drops `opts.album`) stays open:
  `packages/xmpp-core/src/core-effect/operations.ts` is not in the Allowed files.

**Tests added:** none. Every fix here is web rendering (UI); `AGENTS.md` §Tests keeps
UI out of tests, and no finding names one. The gate still runs the web suite.

**Gate:** `pnpm gate` → **GATE PASS** — `install`, `format`, `lint`, `typecheck`,
`effect`, `tests @zilar/client-core`, `tests @zilar/web`; scope in Allowed files.
Line counts: `AlbumGrid.tsx` 224, `MessageListRow.tsx` 104, `MessageList.tsx` 364,
`MessageBubble.tsx` 400 (untouched), `AttachmentBody.tsx` 240; all ≤ 400.

### Round 3 — pre-review fixes (`9a818e6d5` → `2f971bb34`)

Per `PREREVIEW.md` (round 3: must-fix=0, should-fix=1, nit=2, follow-up=1; one
commit per finding):

- **Finding 1 (should-fix) — fixed** (`2f971bb34`): an album head now renders the
  fixed "Not sent: `<reason>`" row with Retry and **Delete unsent** when its send
  failed, exactly as the single-photo paths do. `AttachmentBody.tsx` draws the
  grid and, when `sendFailed`, a `SendFailure` row under it; the per-tile
  upload-failure Retry stays for a sibling's failed upload. A head whose
  `sendMessage` failed is now recoverable (Retry) and deletable
  (`deleteFailedMessage`) again, restoring the T-0168 failed-send contract.
- **Finding 2 (nit) — not touched:** `AlbumGrid.tsx` was not otherwise changed
  this round; the disclosed edge (a `count > 4` album with ≤ 4 photos loaded
  shows no `+N`) stands.
- **Finding 3 (nit) — not touched:** `useComposerAttachments.ts` was not
  otherwise changed.
- **Follow-up F1** (`sendMessageEffect` drops `opts.album`) stays open:
  `packages/xmpp-core/src/core-effect/operations.ts` is not in the Allowed files.

**Tests added:** none. Finding 1 is a web-rendering fix; `AGENTS.md` §Tests keeps
UI out of tests and the finding names none, so the gate's web suite is the coverage.

**Gate:** `pnpm gate` → **GATE PASS** — `install`, `format`, `lint`, `typecheck`,
`effect`, `tests @zilar/client-core`, `tests @zilar/web`; scope in Allowed files,
migration check clean.

**File changed this round:** `apps/web/src/components/message/AttachmentBody.tsx`
(240 → 255 lines, ≤ 400). No single test file applies (UI-only change), so no
`--reporter=dot` single-test run was made.

### Lead fix round — F1 (`sendMessageEffect` drops `opts.album`)

The lead widened the Allowed files to `packages/xmpp-core/src/**/*.test.ts` and
asked for F1 to be fixed here.

- **Fix** (`packages/xmpp-core/src/core-effect/operations.ts`): `sendMessageEffect`
  now forwards `album: opts.album` into `buildMessage`, beside `payload`,
  `forward`, `replyTo` and `mentions`. `buildMessage` already accepted the field
  and emits `albumElement` — only the effect dropped it. File stays 392 lines
  (≤ 400).
- **Test** (message pipeline): the nearest xmpp-core test that drives the core
  send path is `packages/xmpp-core/src/connection-resilience.test.ts` (it is the
  only xmpp-core test with a connected core and a fake transport recording
  `sent`; no existing test called `core.sendMessage`). Added
  `sendMessage: album marker > puts the album marker on the outgoing stanza`:
  it connects a core, calls `core.sendMessage(..., { album })` and asserts the
  outgoing `<message>` carries `<album xmlns='urn:zilar:album:0' id index count/>`.
  Verified it fails without the fix (1 failed | 36 passed) and passes with it.

**Paths checked (every one that builds a `SendMessageOptions` stanza):**
- `packages/client-core/src/store/send/attachment.ts:101-113` — the attachment
  send already passes `album` via `sendMessage`; `retryAttachment`
  (`:210-218`) re-passes `validAlbum(message.album)` through
  `runAttachmentUpload`, so a Retry keeps the marker. Both reach
  `sendMessageEffect`, now fixed.
- `packages/xmpp-core/src/stanza/build-outgoing.ts:94,117` — `buildMessage`
  accepts `album` and pushes `albumElement` (unchanged, correct).
- Text paths carry no album (albums are attachment-only), so unchanged:
  `send/text.ts:70-92` (`replyTo`/`mentions`), `send/retry-text.ts:103-105`
  (`{ ...options, id }`), `send/outbox.ts:260-270` (`{ ...entry.sendOptions(), id }`).
- **Related but outside scope:** `packages/mock-backend/src/xmpp/core.ts:148-165`
  builds its echoed `ChatMessage` from explicit fields too and drops `opts.album`,
  so the mock echo is marker-less. The web-mock acceptance renders the optimistic
  grid regardless; noted for a follow-up since the file is not in the Allowed files.

**Tests / commands:**
- `pnpm --filter @zilar/xmpp-core test --maxWorkers=2 --reporter=dot
  src/connection-resilience.test.ts` → **37 passed** (1 file).
- `pnpm gate` → **GATE PASS** — `install`, `format`, `lint`, `typecheck`,
  `effect`, `tests @zilar/client-core`, `tests @zilar/web`, `tests @zilar/xmpp-core`;
  scope in Allowed files, migration check clean.

### Lead fix round 2 — mock echo keeps the album and a trusted image URL

The lead saw on the web mock: 3 photos + caption show the grid for a moment,
then the echoed `mock-msg-1..3` replace the optimistic bubbles and the chat
shows 3 separate file cards.

- **Fix 1 — the echo dropped the marker** (`packages/mock-backend/src/xmpp/core.ts`
  `sendMessage`): added `...(opts?.album === undefined ? {} : { album: opts.album })`
  beside `payload`/`forward`/`replyTo`/`mentions`, so the echoed `ChatMessage`
  keeps the album and `groupMessages` keeps the grid.
- **Fix 2 — the echo still rendered as a file card.** Diagnosis: the mock's
  `requestUploadSlot` returned the same `data:` URL for `putUrl` and `getUrl`,
  and `getUrl` is what the message carries. The client's
  `sanitizeIncomingAttachment` (`packages/chat-core/src/media.ts:146-176`, via
  `ledger-incoming.ts:144`) treats a non-http(s) URL as untrusted and downgrades
  an incoming `kind: 'image'` to `kind: 'file'` (a file card); the optimistic
  bubble is local and never sanitized, so only the echo broke. Fixed in the same
  file: `putUrl` stays a `data:` URL (the web PUT needs no server and succeeds,
  verified with `fetch('data:...', { method: 'PUT' })` → `ok true`), while
  `getUrl` is now `https://upload.<domain>/<filename>` — the host
  `trustedMediaHosts` builds (`upload.<domain>`) and the same host the mobile and
  web test slots already use (`apps/mobile/src/store/real-store.send.test.ts:54`).
  With a trusted `getUrl`, `sanitizeIncomingAttachment` keeps `kind: 'image'` and
  the grid tiles render (blank/broken in mock, as the acceptance allows).
- **No new test** (mock), per the instruction; the gate's mock-backend step
  reports `SKIP tests @zilar/mock-backend (no nearby test files)`.

**File changed:** `packages/mock-backend/src/xmpp/core.ts`.

**Gate:** `pnpm gate` → **GATE PASS** — `install`, `format`, `lint`, `typecheck`,
`effect`, `tests @zilar/client-core`, `SKIP tests @zilar/mock-backend (no nearby
test files)`, `tests @zilar/web`, `tests @zilar/xmpp-core`; scope in Allowed files,
migration check clean.

### Disagreements

**Finding 4 — the `+N` hidden count.** I believe this finding is wrong and left the
code as it was. `shown = photos.slice(0, 4)` renders exactly four tiles, so a 5+
album's remaining photos are **not rendered** — they are already hidden behind the
4th tile — and `hidden = total - 4` is exactly that remainder (a fully loaded
6-photo album shows four photos and `+2` on the last). That is what spec §3 asks
("the last visible tile shows `+N` for the hidden remainder") and the Telegram
layout the plan names; the reviewer's own scenario ("last tile shows '+2'") is the
specified behaviour. The only difference from their wording is that the 4th tile is
itself a visible photo with the overlay on top, which is the Telegram look; a 2×2
grid cannot put `+N` on a non-photo tile without either showing five tiles or
dropping a photo. (One genuine edge, outside the finding's scenario: an album that
declares `count > 4` but has ≤ 4 photos loaded shows no `+N`, because the condition
keys on `photos.length`; noted, not changed.)

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean after 2 auto rounds and 2 lead rounds (4 nits).**
- **Lead rounds:**
  - **F1, from the pre-review:** `sendMessageEffect` dropped `opts.album`, so on a real server albums would have split after the echo. Fixed in `xmpp-core/src/core-effect/operations.ts`, with a test.
  - **Found on the web mock:** the mock echo (`mock-backend/src/xmpp/core.ts`) dropped `album` too, and returned a URL the image rule rejected, so the photos came back as file cards. Fixed.
- **Lead's check on the web mock, after the fixes:**
  - staged 3 PNGs at once and sent with the caption "Trip photos";
  - one bubble shows the 3-layout (one large tile on the left, two stacked) with the caption under it, and stays one bubble after the echo (`mock-msg-1` only in the DOM);
  - clicking the top-right tile opened the viewer at "2 / 3".
  - Mock tiles are blank (no image bytes), as allowed.
- **Lead's checks after the rebase:** client-core 129 passed, xmpp-core 146 passed; tsc on server, web and mobile: 0 errors.
- **File sizes:** `MessageList.tsx` 364, `Composer.tsx` 393, `AlbumGrid.tsx` 224, `operations.ts` 392.

---
id: T-1271
title: "Albums task 3 (mobile): a multi-photo pick sends one album (shared album id on every photo, caption/reply on the first), and the mobile list renders album items as the Telegram-style grid (2/3/4/5+) whose tiles open the viewer on the album first"
status: merged
milestone: M5
branch: task/T-1271-albums-mobile
model: auto
effort: default
depends_on: [T-1268]
estimate: 0.5 day
---

# T-1271: Albums on mobile

## Spec (written by Claude, do not edit)

### Why
This is task 3 of `docs/audit/albums-plan.md` §9 (`:399-415`). The design is §3, §4.5 and §5.1; read them. Already merged:
- **T-1267:** the wire marker and chat-core's album render item `{ kind: 'album'; message; messages; count; … }` (`packages/chat-core/src/types.ts:236-243`).
- **T-1268, web:**
  - `SendAttachmentOptions.album` (`packages/client-core/src/store/send/context.ts:37-41`), validated and sent on the wire;
  - the web grid. Copy its approach: `apps/web/src/components/MessageListRow.tsx` wraps the album's head bubble in an `AlbumMembersProvider`, `apps/web/src/components/message/AttachmentBody.tsx:63` renders `AlbumGrid`, and `apps/web/src/components/media/MediaViewer.tsx` takes `albumIds`. Read `work/T-1268-albums-web.md`.
- **Mobile today:**
  - the list renders an album item as its head message's normal bubble (`apps/mobile/src/components/chat/message-list.tsx:165-188` uses `item.message`);
  - Send loops over the picks with no album (`apps/mobile/src/components/chat/composer-media.ts:186-200`).

### What to build
1. **Sending,** in `composer-media.ts` `sendPicked` (259 lines):
   - when 2 to 10 picks are all images, make one album id (`Crypto.randomUUID()` from `expo-crypto` if the app already uses it; otherwise a non-crypto unique string is fine, so cite what you used);
   - pass `album: { id, index, count }` on every call, with the caption and reply on the first only, as today;
   - mixed picks, or a single pick, send as today.
2. **Rendering:**
   - a new `apps/mobile/src/components/chat/album-grid.tsx` with the §3 layouts (2: two columns; 3: one large and two stacked; 4: 2×2; 5+: two columns with "+N" on the last tile) and the caption under the grid;
   - reuse `AttachmentImage` and `isLoadableMediaUrl` from `apps/mobile/src/components/chat/attachment-message.tsx` (299 lines);
   - get the album members from the row to `apps/mobile/src/components/chat/attachment-body.tsx` (208 lines) the way web does, with a small context in a new `apps/mobile/src/components/chat/album-members.tsx`, provided in `message-list-row.tsx` (179 lines) for `item.kind === 'album'`;
   - **`message-bubble.tsx` is 391 lines; don't add more than 2 lines to it.**
3. **Viewer:**
   - a tile tap opens `AttachmentViewer` with the album's photos first, then the rest of the chat, starting on the tapped photo (§4.5);
   - build the list in `attachment-body.tsx` from `photosOf` plus the album ids;
   - leave `photo-pager.tsx` alone unless needed.
4. **Out of scope:** album-wide delete, forward and reaction. Long-press on the grid keeps today's head-message menu.
5. **No tests** (UI). Keep every file at most 400 lines.

### Read first
`AGENTS.md`, `docs/audit/albums-plan.md`, `work/T-1268-albums-web.md`, `apps/web/src/components/MessageListRow.tsx`, `apps/web/src/components/message/AlbumGrid.tsx`, `apps/mobile/src/components/chat/message-list.tsx`, `apps/mobile/src/components/chat/message-list-row.tsx`, `apps/mobile/src/components/chat/attachment-body.tsx`, `apps/mobile/src/components/chat/attachment-message.tsx`, `apps/mobile/src/components/chat/composer-media.ts` and `apps/mobile/src/components/chat/image-viewer.tsx`.

### Allowed files
`apps/mobile/src/components/chat/album-grid.tsx`, `apps/mobile/src/components/chat/album-members.tsx`, `apps/mobile/src/components/chat/attachment-body.tsx`, `apps/mobile/src/components/chat/message-list.tsx`, `apps/mobile/src/components/chat/message-list-row.tsx`, `apps/mobile/src/components/chat/message-bubble.tsx`, `apps/mobile/src/components/chat/composer-media.ts`, `apps/mobile/src/components/chat/attachment-message.tsx`, `apps/mobile/src/components/chat/image-viewer.tsx`, `apps/mobile/src/components/chat/photo-pager.tsx`, `work/T-1271-albums-mobile.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the emulator mock:** pick 3 photos, send them with a caption, and the chat shows one grid bubble with the caption; a tile opens the viewer on the album.

---

## Report (written by the worker when done)

### What I built

**Sending (`composer-media.ts`)**
- `sendPicked` now builds one album id when the pick is 2..10 files and every
  file is an image (per `classifyMobileFile`, the same test the send pipeline
  uses), and passes
  `album: { id, index, count }` on every call. The caption and reply stay on the
  first pick only; a single pick, a mixed pick, or more than 10 sends as today.
- The id is `randomUuid()` from `apps/mobile/src/lib/polyfills.ts` — the app's
  own v4 UUID, the function it installs as the runtime's `crypto.randomUUID` on
  Hermes (no `expo-crypto`; the app does not depend on it).

**Rendering**
- new `album-grid.tsx`: the §3 layouts (2 two columns; 3 one large tile on the
  left and two stacked on the right; 4 a 2×2; 5+ a 2×2 whose last tile shows
  `+N` for the hidden remainder) plus a single-member layout. Tiles reuse the
  same trust gate `isLoadableMediaUrl` and the same `useMediaSource` loader
  `AttachmentImage` uses; a `gradient:` mock URL renders a gradient tile and a
  still-uploading tile shows its local preview. A failed tile shows an inline
  "Upload failed / Retry" wired to `retryAttachment`.
- new `album-members.tsx`: the `AlbumMembersProvider` / `useAlbumMembers`
  context, the mobile twin of web's `AlbumMembersContext`.
- `message-list-row.tsx`: an `album` item wraps its head bubble in
  `AlbumMembersProvider` with the item's grouped `messages`.
- `attachment-body.tsx`: an album head renders `<AlbumGrid>` instead of a single
  photo; the existing text row under it is the caption. The viewer's photo list
  is built from `photosOf` plus the album's ids: the album's photos first (in
  `index` order), then the rest of the chat; a tile tap opens it on the tapped
  photo (§4.5).

**Untouched:** `message-bubble.tsx` (391 lines, +0), `message-list.tsx`,
`attachment-message.tsx`, `image-viewer.tsx`, `photo-pager.tsx`.

### Files changed
`apps/mobile/src/components/chat/album-grid.tsx` (new),
`apps/mobile/src/components/chat/album-members.tsx` (new),
`apps/mobile/src/components/chat/attachment-body.tsx`,
`apps/mobile/src/components/chat/message-list-row.tsx`,
`apps/mobile/src/components/chat/composer-media.ts`,
`work/T-1271-albums-mobile.md`.

### Commands (real results)
- `pnpm install` → done (one pre-existing peer warning: `@types/react-dom`
  wants `@types/react ^19.3.0`, found 19.2.18).
- No single test file applies: the change is mobile UI and there is no
  `*.test.ts` next to any file I touched, so I ran no
  `--reporter=dot` single-file test.
- `pnpm gate` → **GATE PASS**:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.8s)
  PASS  typecheck  (2.2s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  (Two earlier gate runs failed and were fixed: `format` on `album-grid.tsx`
  and `attachment-body.tsx` — fixed with Prettier `--write`; then `typecheck`
  on the mobile store's `SendAttachmentOptions`, see Deviations 3.)

### Deviations / notes
1. **Caption lives under the grid, drawn by `AttachmentBody`, not by
   `AlbumGrid`.** `album-grid.tsx` renders only the grid; the head's text is the
   caption the existing text row draws just below it (the same split web T-1268
   used, and plan §3: "the caption sits under the grid (it is the first
   message's body)").
2. **Tiles reuse `isLoadableMediaUrl` and `useMediaSource`, not the
   `AttachmentImage` component.** `AttachmentImage` is fixed at 240 px for a
   single-bubble layout and takes no size prop, so using it as a grid tile would
   clip every tile. The grid uses the same trust gate and the same media-source
   loader that `AttachmentImage` uses internally.
3. **The mobile store's `SendAttachmentOptions` lacks `album` and its file is
   outside the Allowed files.** `apps/mobile/src/store/send-types.ts` defines a
   narrower `{ caption?, replyTo? }`. The composer therefore widens it locally
   as `SendAttachmentOptions & { album: AlbumRef }`; the object is forwarded
   unchanged through the mobile store to client-core's `sendAttachment`, which
   already validates and sends `album` (T-1268). The cleaner fix — typing the
   mobile store's `SendAttachmentOptions` from `@zilar/chat-core` — needs
   `apps/mobile/src/store/send-types.ts` added to the Allowed files.
4. **Album sibling arrival re-renders the row.** The memoised mobile row
   (`areRowPropsEqual`) compared only the head message, so a sibling arriving
   from an older history page would not redraw the grid. I added
   `sameAlbumMembers` (element-by-element, since `groupMessages` rebuilds the
   array) to that comparison.
5. **Mock acceptance needs the real library picker.** The attach sheet's
   `demoPick` stages a single file, so the lead's mock check ("pick 3 photos")
   uses the simulator's photo library through the real picker; I did not change
   `attach-sheet.tsx` or `demoPick` (out of scope). The T-1268 mock backend
   echoes the album marker, so the grid survives the echo on mobile too.

### Open questions
- None blocking. Deviation 3 is the only one worth a decision: whether to widen
  the Allowed files to `apps/mobile/src/store/send-types.ts` and type the
  mobile `SendAttachmentOptions` from `@zilar/chat-core`, instead of the local
  intersection.

### Round (fix round, fresh session)

**Findings fixed:** 1 should-fix. No must-fix; 1 nit and 1 follow-up skipped.

- **Finding 1 (`composer-media.ts` `albumIdForPicks`):** the album gate tested
  `mimeType.startsWith('image/')` while the send pipeline classifies with
  `classifyMobileFile` (png/jpeg/gif/webp only). An `image/svg+xml` (or HEIC)
  pick therefore carried an album marker but a `kind: 'file'` attachment, which
  the grid drops — an empty bubble for two SVGs, and a lost file row plus a
  wrong `+N` for a JPEG+SVG pick. It now gates on
  `classifyMobileFile(file) === 'image'`, the exact test the bytes reach the
  wire with. One import added, one predicate changed, no other line touched.
- **Finding 2 (nit — `+N` overlay on a partially loaded album):** skipped, per
  "do not touch nits unless they are in a line you already change"; this round
  changes no line in `album-grid.tsx`.
- **Follow-up F1 (type `album` on the mobile store's `SendAttachmentOptions`):**
  skipped; `apps/mobile/src/store/send-types.ts` is outside the Allowed files.

**Tests added/adjusted:** none. Finding 1 names no test, the Spec says "No tests
(UI)", and the Allowed files name no test file (compare T-0338 / T-1245, where
the lead lists the test files explicitly). A test for `albumIdForPicks` would
need a new `composer-media.test.ts` outside the Allowed files, so I left it out
rather than widen scope. No single `--reporter=dot` test applies.

**Gate result:** `pnpm gate` (repo root) — **GATE PASS**:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.4s)
PASS  lint  (0.8s)
PASS  typecheck  (2.5s)
PASS  effect  (0.4s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Round 2 (fix round, fresh session)

**Findings fixed:** 1 should-fix. No must-fix, no nits. The two follow-ups
(F1, F2) need files outside the Allowed files and were left as they are.

- **Finding 1 (`attachment-body.tsx:96` / `:170` — tile tap during head upload
  opens the viewer later, unprompted):** the album branch armed the viewer on
  every tile tap even while the head message was still uploading or failed, but
  the viewer is rendered only when the head is neither uploading nor failed
  (`:170`). A tap on a loaded sibling tile while the head uploaded therefore
  stored stale state that popped the viewer open on its own when the upload
  finished (same path via failed → tap → Retry → success). The album branch now
  passes `onOpen` only when the head is openable, exactly like the single-photo
  branch (`:109`): `onOpen={failed || uploading ? undefined : …}`. So that the
  prop can be omitted, `AlbumGrid`'s `onOpen` is now optional — matching
  `AttachmentImage`'s `onOpen?` — and its tile press calls `onOpen?.()`. No tap
  is armed while the head uploads or has failed, so no viewer opens unprompted.

**Tests added/adjusted:** none. Finding 1 names no test, the Spec says "No tests
(UI)", `AGENTS.md` says UI code gets no test, and the Allowed files list no test
file (a new `attachment-body.test.ts(x)` would be outside scope). No single
`--reporter=dot` test applies.

**Gate result:** `pnpm gate` (repo root) — **GATE PASS**:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.3s)
PASS  lint  (0.8s)
PASS  typecheck  (2.6s)
PASS  effect  (0.5s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean after 2 auto rounds (1 nit, 1 follow-up).**
- **Round 1:** the album gate now uses the pipeline's own image classifier.
- **Round 2:** a tile tap while the head is uploading no longer pops the viewer open later.
- **Lead's check on the emulator (mock build of this branch):**
  - picked 3 photos in the system photo picker, typed "Trip photos" and sent;
  - one bubble with the 3-layout (one large tile, two stacked) and the caption under the grid;
  - tapping the top-right tile opened the viewer at "2 / 3".
  - Mock tiles read "Image unavailable" (mock images don't load, as decided).
- **Lead's checks after the rebase:** mobile tsc: 0 errors. `message-bubble.tsx` is untouched (391 lines), and every other file is at most 302.
- `album` reaches client-core: the mobile store passes the options object unchanged (`apps/mobile/src/store/effects/send.ts:144`).
- **Follow-up F1:** type `album` on the mobile `SendAttachmentOptions` (`apps/mobile/src/store/send-types.ts:15-18`) instead of the local intersection in `composer-media.ts:70`.

---
id: T-1335
title: "Photos like Telegram on mobile and web: a photo/video/album/GIF message IS the bubble — edge to edge with the bubble's rounded corners, no white frame, no inner border, the time+ticks in a dark translucent pill ON the photo; a caption sits below in normal text padding with the time inline"
status: merged
milestone: M5
branch: task/T-1335-photo-bubbles-edge-to-edge
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1335: Edge-to-edge photo bubbles

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-13, with screenshots of his live chat and of Telegram: "in Telegram the photos don't have that big bubble around; in Zilar it's super big".
- **Zilar today** (Android, live): an outgoing photo sits **inset** inside a big white bubble, with padding all round, its own dark border and its own radius. The time ("12:07 ✓") is on a **separate row under** the photo, and a caption ("Bebe") is below that.
- **Telegram:** the photo fills the bubble edge to edge. The bubble's corners are the photo's corners, there's no frame, and the time and ticks sit **on** the photo, bottom-right, in a small dark translucent pill with white text. With a caption, the photo stays edge to edge at the top and the caption sits below in normal text padding, with the time at the end of the caption.

The code the lead read:
- **mobile:** the bubble wrapper pads every message (`apps/mobile/src/components/chat/message-bubble.tsx:292`, `rounded-[14px] px-3 py-2`). `message-bubble.tsx` is **404 lines**, over the 400 limit, so this task must bring it to 400 or less. The image branch is `message-bubble-content.tsx:120-140`, with `ImageMessage` (`image-message.tsx`), a `raisedPill` time overlay and the caption below. Albums are `album-grid.tsx` (221 lines); video and GIF are found from `message-bubble-content.tsx`. The live screenshot shows the time **below** the photo, so find which branch Julio's photos actually take (single photo vs album vs attachment) and say it in the Report.
- **web:** the bubble is `apps/web/src/components/MessageBubble.tsx:304` (`rounded-[14px] … px-3 pt-2` content rows at `:312-321`; 395 lines, so don't grow it), `apps/web/src/components/ImageMessage.tsx` (92 lines), `apps/web/src/components/message/AlbumGrid.tsx` (231 lines) and `GifMessage.tsx`.

### What to build, on both platforms
1. **A media-first message** (photo, video, album, GIF) renders with **no bubble padding** around the media.
   - The media is clipped to the bubble's outer radius, and the bubble keeps its rounded corners and tail.
   - No inner border, no inner radius gap, and no white or grey frame visible around the photo on outgoing or incoming.
   - Keep the image's aspect ratio and the current max sizes.
2. **No caption:** the time (and ticks on outgoing) is a small pill **on** the media, bottom-right, 6–8 px inset: dark translucent (`rgba(0,0,0,0.45)`) with white text and white ticks (keep the blue "seen" colour for read). Remove the separate time row.
3. **With a caption:** the media stays edge to edge at the top (top corners rounded, bottom square). The caption sits below with normal text padding and its time at the end, inline or right-aligned, using the same meta as text bubbles (`BubbleInlineMeta` on mobile).
4. **Group incoming:** the sender name sits above the media in the normal text padding (Telegram does this), and the media stays edge to edge below it.
5. **Reply quote or forward header** on a media message: shown above the media with padding, and the media stays edge to edge.
6. **Sizes:** mobile `message-bubble.tsx` ends at 400 lines or fewer (move code out); web `MessageBubble.tsx` stays at 400 or fewer; every other file at 400 or fewer. **No tests** (UI).

### Read first
`AGENTS.md`, the files above, `apps/mobile/src/components/chat/plain-bubble-body.tsx` (`BubbleInlineMeta`), `apps/web/src/components/message/MessageMeta.tsx`.

### Allowed files
`apps/mobile/src/components/chat/message-bubble.tsx`, `apps/mobile/src/components/chat/message-bubble-content.tsx`, `apps/mobile/src/components/chat/message-bubble-decor.tsx`, `apps/mobile/src/components/chat/image-message.tsx`, `apps/mobile/src/components/chat/album-grid.tsx`, `apps/mobile/src/components/chat/media-bubble.tsx`, `apps/mobile/src/components/chat/media-meta-pill.tsx`, `apps/mobile/src/components/chat/plain-bubble-body.tsx`, `apps/mobile/src/components/chat/attachment-video.tsx`, `apps/web/src/components/MessageBubble.tsx`, `apps/web/src/components/ImageMessage.tsx`, `apps/web/src/components/GifMessage.tsx`, `apps/web/src/components/message/AlbumGrid.tsx`, `apps/web/src/components/message/MessageMeta.tsx`, `apps/web/src/components/message/MediaMetaPill.tsx`, `apps/web/src/components/message/AttachmentBody.tsx`, `work/T-1335-photo-bubbles-edge-to-edge.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check** on the Android mock build and the web mock, with a photo message with and without a caption, incoming and outgoing:
  - the photo touches the bubble edges;
  - the time pill sits on the photo;
  - there's no white frame.
- **Julio's check:** his Android phone, same chat as his screenshot.

---

## Report (written by the worker when done)

**Which branch Julio's photos take.** A single photo picked in the mobile composer
becomes an **attachment with `kind: 'image'`**, not the legacy `message.image` field and
not an album. `composer-media.ts` calls the store's `sendAttachment` per pick, and
`apps/mobile/src/lib/attachments.ts:attachmentDataFor`/`classifyMobileFile` classify a
JPEG as `kind: 'image'`; an album is only created for 2–10 photos (`albumIdForPicks`).
So the screenshot is the **attachment branch** (`message-bubble-content.tsx` →
`attachment-body.tsx` → `AttachmentImage`), which is why the time showed on a separate
row under the photo instead of the pill overlay of the legacy `message.image` branch at
`message-bubble-content.tsx:120-140`. Mock mode is the same (`mock/attachments.ts`
returns `kind: 'image'`).

**What I changed**
- **Mobile — new `media-bubble.tsx`.** `isMediaFirstMessage(message, hosts)` detects a
  legacy `image`, an `image` attachment, an album, or a trusted GIF-video. `MediaBubble`
  renders the media edge-to-edge with a `MediaImage` (trusted load, local preview,
  upload progress, viewer, untrusted/load-failed fallbacks), `ImageMessage` for the
  legacy field, `AlbumGrid`, or `AttachmentVideo`; with no caption it draws the dark
  pill (`media-meta-pill.tsx`) over the media, and with a caption it renders the caption
  via `PlainBubbleBody` (so the time/ticks are the same `BubbleInlineMeta` as text
  bubbles) below the edge-to-edge media.
- **Mobile — `message-bubble.tsx`.** For a media-first message the bubble keeps
  `rounded-[14px]` and `overflow-hidden` but drops `px-3 py-2`, so the media is clipped to
  the bubble's corners and tail; every other message keeps the old padding. The moved
  `MessageBubbleProps` type now lives in `message-bubble-content.tsx` (the file is under
  the 400-line cap either way; the move keeps message-bubble.tsx comfortably under it).
- **Mobile — `message-bubble-content.tsx`.** Routes media-first messages to `MediaBubble`;
  pads the sender/handle-forward/reply rows with `px-3 pt-2` only in the media case, so
  the media stays edge to edge beneath them.
- **Mobile — `image-message.tsx`** is now a borderless, radius-less gradient tile at 100%
  of the media width; **`attachment-video.tsx`** lost its border/radius (the bubble clips
  it) and the failed row got padding.
- **Web — `AttachmentBody.tsx`.** The image / image-attachment / GIF / inline-`video/*`
  wrappers now have no padding, `overflow-hidden`, and corners computed from `mediaTop`,
  `hasText` and the group tail (`mediaCorners`). A caption-less media draws
  `MediaMetaPill` (new `MediaMetaPill.tsx`, `bg-black/45`, white text, read ticks keep the
  seen colour); an album draws the pill too. Failure rows inside the now-paddingless
  wrappers got their own `px-3`.
- **Web — `ImageMessage.tsx` / `GifMessage.tsx`** lost their `border`/`rounded-[12px]`/
  shadow (the wrapper clips); **`AlbumGrid.tsx`** lost the outer `p-1.5` so the grid is
  edge to edge; **`MessageBubble.tsx`** passes `mediaTop` and `lastInGroup`.

**Commands run**
- `pnpm install` — done.
- `pnpm gate` — **GATE PASS**:
  ```
  gate: 13 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.2s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.2s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/mobile  (0.9s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  (I ran it first for formatting, fixed two files with `prettier --write`, then re-ran.)
- No single test files: this is UI code with no nearby tests (the gate ran the mobile
  suite: passed, and skipped web).

**Sizes** (all ≤ 400): mobile `message-bubble.tsx` 355, `message-bubble-content.tsx` 330,
`media-bubble.tsx` 340; web `MessageBubble.tsx` 399, `AttachmentBody.tsx` 293.

**Deviations / things the lead should know**
- The live photo branch is `attachment-body.tsx`, which is **not** in Allowed files, so the
  mobile media rendering moved into the new `media-bubble.tsx`. On mobile,
  `attachment-body.tsx`'s album/image/GIF branches are now unreachable (only its file row
  is still used); I could not delete them because that file is out of scope.
- **Regular (non-GIF) video on mobile** still renders as a file row — that is the existing
  mobile behaviour (`attachment-body.tsx` only renders `AttachmentVideo` for GIF-origin
  videos) and fixing it needs `attachment-body.tsx`. On web, inline `video/*` is now
  media-first. So "video" edge-to-edge is done on web, and on mobile only for GIF video.
- **Albums** keep their per-tile border/radius on both platforms (the deliberate grid
  treatment); the grid itself is now edge to edge and clipped to the bubble's corners.
- The **incoming bubble's own 1px outline** (`bubble-in` / `bubbleStyle('incoming')`) is
  left in place: it is the bubble's edge, not a frame around the photo. The photo's own
  border and radius are gone on both platforms.

**Round 2 (fixes for PREREVIEW findings)** — commits `a83e52d` (finding 1) and `0bd7fd` (finding 2).
- **Finding 1 (must-fix, long-press menu lost on single photos).** `MediaImage` in
  `media-bubble.tsx` now reads `useOpenMessageMenu` and forwards
  `{ onLongPress, delayLongPress: LONG_PRESS_MS }` on both the gradient `Pressable` and the
  `expo-image` `Pressable`, exactly like `AttachmentImage`. The GIF-video `Pressable` in
  `attachment-video.tsx` got the same forwarding: it is the other media-first single item
  with the identical "inner `Pressable` swallows the bubble's `onLongPress`" root cause. A
  short tap still opens the viewer / plays the GIF; a long hold opens the message menu.
- **Finding 2 (should-fix, failed caption-less media lost its timestamp).** The on-media
  pill condition in `media-bubble.tsx` is now `!hasCaption && (visualMedia || failed)`, so
  the failed rows (image and GIF-video) draw the pill again, matching the old
  `attachment-body.tsx` meta row that rendered under success, progress and failure.
- **Tests:** none added. The spec says "No tests (UI)", the findings name no test, and
  `AGENTS.md` gives UI code no tests; there is no component harness here and adding one
  would add dependencies.
- **Nits 3–5** left untouched (none is in a line I changed). No disagreements.

**Round 2 commands**
- `pnpm gate` — **GATE PASS** (13 changed files, all inside the Allowed files):
  ```
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.5s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.8s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/mobile  (1.0s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

**Round 3 (fixes for the PREREVIEW round-2 findings)** — commit `004f64a` (finding 1).
- **Finding 1 (should-fix, caption-less untrusted single photo lost its timestamp).** An
  `image` attachment whose URL is not on a trusted host renders the click-to-load
  `AttachmentFileRow`, which is not `visualMedia`, so the pill was skipped and the file row
  had no timestamp. `media-bubble.tsx` now computes `untrustedImage` (an `image`
  attachment, not a GIF video, with no local preview, whose URL is neither a demo gradient
  nor loadable) and the pill condition is
  `!hasCaption && (visualMedia || failed || untrustedImage)`. The received untrusted file
  row keeps its timestamp in the pill, the same as web draws its pill for every
  `imageOnly` attachment and as the old `attachment-body.tsx` meta row did under every
  state. The pill sits at `right-2 bottom-2`, over the file row's lower-right, the same
  placement the failed rows already use.
- **Nits 2–4** left untouched (none is in a line I changed).
- **Tests:** none added — the finding names no test, the spec says "No tests (UI)", and
  `AGENTS.md` gives UI code no tests (the same reason round 2 added none).
- No disagreements.

**Round 3 commands**
- `pnpm gate` — **GATE PASS** (13 changed files, all inside the Allowed files):
  ```
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.6s)
  PASS  lint  (0.8s)
  PASS  typecheck  (3.0s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/mobile  (1.0s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- No single test files: this is UI code with no nearby tests (the gate ran the mobile
  suite: passed, and skipped web).

**Round 4 (lead fix round)** — one-photo album tile did not fill the media width.
- **Fix.** `apps/mobile/src/components/chat/album-grid.tsx`: a one-photo album used a
  fixed `200×150` tile inside `MediaBubble`'s `240` body, leaving a 40 px strip of bubble
  colour. The single-photo branch now draws the tile at `GRID_WIDTH` (240) with the
  photo's own aspect ratio (4:3 when its pixel size is unknown) and `maxHeight` 320, and
  marks it `edgeToEdge`, so it has no inner border and no inner radius and is clipped by
  the bubble's corners — the same treatment a single attachment image gets. `AlbumPhoto`
  now carries the optional `width`/`height` from `message.image` (required there) or
  `message.attachment` (optional there), and `albumAspectRatio` derives the ratio.
- **Web check.** `apps/web/src/components/message/AlbumGrid.tsx`'s one-photo case is
  `w-[300px]` with `max-w-full`, but the web bubble is a shrink-to-fit flex item (only
  `max-w-[520px]`/`max-w-[560px]`), so with no caption the bubble wraps to the tile's
  300 px and there is no strip of bubble colour. The reported problem (a fixed tile inside
  a fixed wider body) is therefore **not present** on web, so no web file was changed. A
  web one-photo album with a caption wider than the grid can still show a strip, but that
  is the pre-existing fixed-width grid behaviour shared with the 2/3/4-photo grids, not
  the one-photo case this finding names.
- **Tests:** none added — UI code, no nearby tests, spec says "No tests (UI)".
- No disagreements.

**Round 4 commands**
- `pnpm gate` — **GATE PASS** (14 changed files, all inside the Allowed files):
  ```
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.5s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.8s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/mobile  (1.0s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

**Round 5 (lead fix round 2 — PREREVIEW finding 1)** — uploading caption-less photo showed
no timestamp.
- **Finding 1 (should-fix).** While an image attachment uploads, the message carries the
  local `file://` preview (`url: info.localUrl ?? ''`), so `MediaImage` draws the photo
  (`render === 'local'`), but `visualMedia`, `failed` and `untrustedImage` were all false
  and the pill was skipped. `media-bubble.tsx` now derives a single `showsMedia` flag (the
  former `visualMedia` renamed) that also covers the local preview:
  `imageGradient(...) || isLoadableMediaUrl(...) || upload.localUri !== undefined`, and the
  pill condition is `!hasCaption && (showsMedia || failed || untrustedImage)`. So the pill
  shows whenever the media is drawn at all — a trusted URL, a demo gradient, or the local
  preview while it uploads — matching the old `attachment-body.tsx` meta row that rendered
  under every state. While uploading, the outgoing ticks show the existing "sending" state
  (`MediaMetaPill` reads `message.status`), unchanged.
- **Nits 2–5** left untouched (none is in a line I changed).
- **Tests:** none added — UI code, no nearby tests, spec says "No tests (UI)".
- Size: `media-bubble.tsx` is now 367 lines (≤ 400).
- No disagreements.

**Round 5 commands**
- `pnpm gate` — **GATE PASS** (14 changed files, all inside the Allowed files):
  ```
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.6s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.8s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/mobile  (1.0s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

## Review (written by Claude)

**Lead, 2026-10-13: approved after 2 auto rounds and 2 lead rounds; the packet is current for `09658474`.**
- **Root cause, from the worker:** Julio's phone photos take the **attachment** path (`kind: 'image'`, `attachment-body.tsx`), which drew the time below the photo. That path and albums are now edge to edge in the new `media-bubble.tsx`.
- **Lead rounds:**
  1. a one-photo album filled only 200 of 240 px;
  2. the time pill was hidden while a photo uploads.
- **Lead's checks:**
  - web and mobile tsc: 0 errors; `message-bubble.tsx` is 355 lines (it was 404), web `MessageBubble.tsx` 399;
  - Android mock build: text bubbles, quotes and tombstones look as before (Viernes, Ana).
- **Not checkable in the mock:** images don't load there (Julio's decision). The live checks are Julio's phone after the APK, and a web check of a real photo after the deploy.

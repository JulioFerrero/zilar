---
id: T-1868
title: "Media cards P1 (phone): draw the `images` block (1–4 tiles, 2×2 grid, +N, tap opens the photo) and the `file` block (file key, name, 'size · FORMAT · N rows', 40 px Download key that opens the file) from <API>/api/card-media/<id> with the bearer, per PhoneContent.dc.html:52-66,144-160"
status: merged
milestone: M5
branch: task/T-1868-phone-media-blocks
model: auto
effort: default
depends_on: [T-1853]
estimate: 40 min
---

# T-1868: Phone renderers for the images and file blocks (media plan P1)

## Spec (written by Claude, do not edit)

### Why
**This is the phone twin of T-1867** (web W1), covering the media plan `docs/plan/message-blocks-media.md` §6 P1. Julio took every recommendation of the plan on 2026-10-17.
- **The read route** `GET /api/card-media/:id` is merged (T-1853).
- **The schemas:** `packages/protocol/src/blocks-content.ts` defines `images` (`:16-25`: `items` is 1–4 ids, plus `extra?`) and `file` (`:74-84`: `media`, `name`, `size`, `format` and `rows?`).

### The board (match it)
**`docs/design/mockups/blocks/PhoneContent.dc.html`.**
- **20 · IMAGES (`:52-66`):**
  - the card padding is `6 6 8 6`;
  - two columns with a 4 px gap, each tile 112 px high;
  - the outer corners are 12, the inner 6 (top-left `12 6 6 6`, top-right `6 12 6 6`, bottom-left `6 6 6 12`, bottom-right `6 6 12 6`);
  - when `extra > 0`, the last tile gets a centred `+N` (20 px, weight 500) over `rgba(0,0,0,.55)`;
  - **one image** spans the full width, 170 px high, with all corners 12.
- **24 · FILE (`:144-160`):** a row with a 12 px gap:
  1. the 40 px tile key with the lucide `File` icon (18 px, `#d4d4d4`);
  2. the name (weight 500), then a mono 11 px `#8a8a8a` line `size · format · rows rows`, with `rows` left out when absent;
  3. a 40 px square dark Download key (lucide `Download`, 18 px).

### Facts (read by the lead on 2026-10-17)
- **The content dispatch** is `apps/mobile/src/components/chat/blocks/content-blocks.tsx`: `CONTENT_KINDS` (`:10-14`) and `renderContentBlock` (`:20-33`). `block-card.tsx` (260 lines) routes `place`/`weather`/`event` to it (`:102-105`), and draws a lone callout specially (`:210-222`).
- **The dark key style** is the `KEY` object in `apps/mobile/src/components/chat/blocks/place-block.tsx:11-16`.
- **The bearer:** `useMediaSource(chatId, url, enabled)` (`apps/mobile/src/lib/media-source.ts:18-51`) adds it when the URL is on the API origin.
  - `mediaUrl` (`apps/mobile/src/lib/attachment-common.ts:84-97`) rewrites only `/upload/` paths, so an absolute `${API_URL}/api/card-media/<id>` passes through untouched and needs no real chat id.
  - `isApiOriginUrl` is at `:69-72`.
- **The file opener:** `createAttachmentOpener({ apiUrl: API_URL, getToken: getSessionToken })` (`apps/mobile/src/lib/attachment-opener.ts:179-201`, made in `apps/mobile/src/components/chat/chat-thread.tsx:64`) downloads with the bearer and hands the file to the app for its type: `open(url, name)` → `{status}`.
- **The dev blocks screen** is `apps/mobile/src/mock/dev-blocks-screen.tsx`. It plugs in the extra samples from `apps/mobile/src/mock/dev-choice-blocks.tsx` (`ChoiceBlockExamples`, `:14`).

### Steps
1. **`apps/mobile/src/lib/attachment-common.ts`:** add `cardMediaUrl(id, apiUrl = API_URL)`, which returns `${origin}/api/card-media/${encodeURIComponent(id)}`, or `undefined` without an API URL.
2. **New `apps/mobile/src/components/chat/blocks/images-block.tsx`:**
   - draw each tile with `expo-image`, using `useMediaSource('', cardMediaUrl(id), true)`. Add a comment that the chat id is unused for card media;
   - a tile with no source or a load error shows the board's `#181818` placeholder;
   - tapping a tile opens the photo with the attachment opener (`open(url, 'image')`). Make one opener per component with `useMemo`, as `chat-thread.tsx:64` does.
3. **New `apps/mobile/src/components/chat/blocks/file-block.tsx`:**
   - the row above;
   - the Download key calls `open(cardMediaUrl(block.media), block.name)` and shows a spinner while it runs;
   - an error shows the message under the row in `#f87171` 12 px.
4. **`content-blocks.tsx`:** add `images` and `file` to `CONTENT_KINDS`, to the `Extract` type and to the switch.
5. **`block-card.tsx`:**
   - route the two kinds to `renderContentBlock`;
   - a card whose only block is `images` gets the board's tight padding. Keep the file at most 400 lines.
6. **New `apps/mobile/src/mock/dev-media-blocks.tsx`** (`MediaBlockExamples`) holds a 4-image card with `extra: 3`, a one-image card and the `prices-october.csv` file card. Render it in `dev-blocks-screen.tsx` next to `ChoiceBlockExamples`. The images show the placeholder in mock mode.
7. **No tests** (UI).

### Allowed files
- `apps/mobile/src/lib/attachment-common.ts`
- `apps/mobile/src/components/chat/blocks/images-block.tsx`
- `apps/mobile/src/components/chat/blocks/file-block.tsx`
- `apps/mobile/src/components/chat/blocks/content-blocks.tsx`
- `apps/mobile/src/components/chat/blocks/block-card.tsx`
- `apps/mobile/src/mock/dev-media-blocks.tsx`
- `apps/mobile/src/mock/dev-blocks-screen.tsx`
- `work/T-1868-phone-media-blocks.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **On the dev blocks screen** (mock build):
  - the 2×2 grid has the board's corners and the `+3` tile;
  - the one-image card is full width;
  - the file card matches the board.
- **No other block changes.**
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **`apps/mobile/src/lib/attachment-common.ts`:** added `cardMediaUrl(id, apiUrl = API_URL)`, which returns `${origin}/api/card-media/${encodeURIComponent(id)}` or `undefined` without an API URL.
- **`apps/mobile/src/components/chat/blocks/images-block.tsx` (new):** `ImagesBlock` draws the 20 · IMAGES block:
  - one image is a full-width 170 px tile with all corners 12;
  - two to four images are a two-column grid (4 px gap, 112 px tiles): corner radius 12 on the grid's outer edges and 6 on the inner ones, which reproduces the board's four radius strings for the 2×2 case;
  - a last tile with `extra > 0` gets the centred `+N` (20 px, weight 500) over `rgba(0,0,0,.55)`;
  - each tile loads through `expo-image` with `useMediaSource('', cardMediaUrl(id), true)` (comment says the chat id is unused for card media); no source or a load error draws the `#181818` placeholder;
  - a tap calls `opener.open(url, 'image')`; the opener is one `useMemo` per component, built like `chat-thread.tsx:64`.
- **`apps/mobile/src/components/chat/blocks/file-block.tsx` (new):** `FileBlock` draws the 24 · FILE row: the 40 px raised tile key with lucide `File` (18 px, `#d4d4d4`), the name, the mono 11 px `#8a8a8a` `size · format · N rows` line (rows omitted when absent) and the 40 px dark Download key with lucide `Download` (18 px). The key calls `open(cardMediaUrl(block.media), block.name)`, shows an `ActivityIndicator` while it runs, and shows the opener's fixed error message under the row in `#f87171` 12 px.
- **`apps/mobile/src/components/chat/blocks/content-blocks.tsx`:** added `images` and `file` to `CONTENT_KINDS`, to the `Extract` type and to the switch.
- **`apps/mobile/src/components/chat/blocks/block-card.tsx`:** routed `images` and `file` to `renderContentBlock`; a card whose only block is `images` uses the board's tight `px-[6px] pt-[6px] pb-[8px]` padding, with the footer time inset 8 px as the board does. File is now 273 lines.
- **`apps/mobile/src/mock/dev-media-blocks.tsx` (new):** `MediaBlockExamples` with the four-photo card (`extra: 3`, 13:52), the one-photo card and the `prices-october.csv` file card (`12 KB`, `CSV`, `31 rows`, Sat 10:00). The media ids are mock-only, so the tiles render the `#181818` placeholder in mock mode.
- **`apps/mobile/src/mock/dev-blocks-screen.tsx`:** renders `MediaBlockExamples` right after `ChoiceBlockExamples`.
- **No tests:** UI-only change, as the spec says.

### Checks run

`pnpm install` at the start, then `pnpm gate` from the repo root. Final result:

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.4s)
PASS  lint  (0.9s)
PASS  typecheck  (0.9s)
PASS  effect  (0.8s)
PASS  tests @zilar/mobile  (8.3s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single test files were run (no test files changed; the gate's mobile run is the only test run).

Two earlier gate runs failed and were fixed:
- `format` on `file-block.tsx`, `images-block.tsx` and `attachment-common.ts`: ran `pnpm exec prettier --write` on those three files.
- `effect` on `file-block.tsx` (`.then` on the opener promise): rewrote the tap with `Effect.tryPromise` + `Effect.match`, and the image tap with `Effect.tryPromise` + `Effect.ignore`.

### Round

Fix round for `PREREVIEW.md`.

- **Finding 1 (must-fix) — fixed** in `images-block.tsx`: a photo tap no longer swallows failures. `open()` clears the old error, then `Effect.match` sets `OPEN_FAILED_MESSAGE` when the opener rejects and the opener's fixed message when it resolves `{status: 'error'}`, the same shape `FileBlock` uses. The block draws the message under the grid in `#f87171` 12 px with `accessibilityRole="alert"`. The grid JSX moved into a small `Grid` helper so the single-image and multi-image paths share the one error line.
- **Findings 2 and 3 (nits) — left as is.** Neither line is code this round touches, and the fix-round rules say not to pick up nits.
- **Tests:** none added or changed. The finding names no test, the spec says "No tests (UI)", AGENTS.md says UI code gets no tests, and the Allowed files list contains no test file. The fix is a UI error path only.
- **Gate:** re-ran `pnpm gate` after the fix → `GATE PASS`:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.8s)
  PASS  lint  (0.9s)
  PASS  typecheck  (1.1s)
  PASS  effect  (1.5s)
  PASS  tests @zilar/mobile  (4.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  No single test files were run because no test file changed.

### Notes for the lead

- I did **not** launch the app or a simulator, so the visual acceptance (corners, `+3` tile, full-width single image, file card) is not verified on a device; the code follows the board's numbers and the dev blocks screen is ready for your phone smoke.
- `open(url, 'image')` is exactly what the spec asks for; the opener derives the MIME type from the name's extension, so it falls back to `application/octet-stream` and the system share sheet. If you want the system photo viewer, a follow-up could pass a name with an image extension instead.
- For 2- and 3-image blocks the board gives no sample, so the radius rule is general (12 on edges that touch the card, 6 on inner edges); with 4 images it produces exactly the board's four styles.
- The tight padding applies whenever the card's only block is `images`, even if the card also has a header; the board's images card has no header, so this case is untested against a design.

## Review (written by Claude)

Merged on 2026-10-17 at HEAD `1c6a80029`.
- **The packet was stale:** its must-fix (photo-open failures ignored) is already fixed in `f1726aeda`; the error line shows `OPEN_FAILED_MESSAGE`.
- **The emulator check** ran on the mock build (smoke PASS), via `zilar://dev/blocks` scrolled to the end, against `PhoneContent.dc.html`:
  - **four images:** a 2×2 grid with the `+3` overlay and the tight card padding;
  - **one image:** full width;
  - **file:** the 40 px file key, `prices-october.csv`, the mono `12 KB · CSV · 31 rows` line and the 40 px Download key.
- **Follow-up:** tapping a photo hands an extensionless name to the opener, so it gets the share sheet instead of a photo view. The next phone media task should open card photos in the app's own photo viewer.


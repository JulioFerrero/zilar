---
id: T-0464
title: "Backgrounds E2 (web): upload, pick, dim and delete your own background images in the Chat background dialog"
status: merged
milestone: M5
branch: task/T-0464-web-background-images
model: auto
effort: low
depends_on: [T-0460, T-0462]
estimate: 0.6 day
---

# T-0464: web background images

## Spec (written by Claude, do not edit)

### Why
This is plan `docs/audit/chat-backgrounds-plan.md` §8, decision 2 (images after presets). T-0460 serves image upload, list, read and delete. T-0462 built the dialog with presets. This task adds your own images to that dialog, with a dim slider. **Icons only, no emoji.**

### Verified facts (do not re-derive)
- **Server (T-0460):**
  - `POST /api/backgrounds` takes a raw body (still PNG or WebP, at most 1 MiB, 64-2048 px per side, at most 20 per user) and returns 201 `{ id, url, width, height }`;
  - `GET /api/backgrounds` returns `{ backgrounds: [{ id, url, width, height, createdAt }] }`, newest first;
  - `GET /api/backgrounds/:id` serves the bytes;
  - `DELETE /api/backgrounds/:id` returns 204.
  
  Errors: 413 is too large, 400 is a bad image, 409 means 20 images already.
- **Prefs:**
  - `PUT /api/chat-prefs/:chatJid` and `PUT /api/chat-background` accept `backgroundImageId` and `backgroundDim` (0-80; a dim needs an image; a preset and an image together give 400);
  - a deleted image is cleared from prefs by the server.
- **Web API (`apps/web/src/lib/api.ts`):**
  - `uploadAvatarBytes(path, blob)` (lines 2449-2481) does a raw-body fetch with a mock branch and `toApiError`, then a zod parse. **Copy that shape with POST** for the new upload;
  - `request(path, schema, init)` is at line 191;
  - T-0462 added `putChatBackgroundDefault`.
- **Image encoding pattern:** `apps/web/src/components/AvatarUploader.tsx` accepts `image/png,image/jpeg,image/webp,image/gif` (line 293), draws to a canvas and calls `canvas.toBlob(..., 'image/webp', 0.92)` (lines 58-70). It injects `imageLoader` and `exporter` so tests never touch a canvas (lines 105-127).
- **Dialog (`apps/web/src/components/ChatBackgroundDialog.tsx`, T-0462):**
  - `scope` (`'chat' | 'all'`);
  - `choose(presetId)` calls `store.setChatBackground` or `store.setDefaultBackground` (lines 50-60);
  - a 4-column swatch grid (line 86) and "Use default" (line 117);
  - `close()` resets the state.
- **Store:** `realStore.ts` `updatePref` carries the three background fields (T-0462). `setChatBackground(chatId, presetId)` and `setDefaultBackground(presetId)` send `{ backgroundPreset, backgroundImageId: null, backgroundDim: null }`. Painting is in `apps/web/src/lib/chatBackground.ts`, where images default to dim 40.

### What to build
1. **`lib/api.ts`:**
   - `uploadBackground(blob): Promise<{ id, url, width, height }>`, the POST twin of `uploadAvatarBytes`;
   - `listBackgrounds()`;
   - `deleteBackground(id)`.
2. **`mock/api.ts`:** in-memory `POST`, `GET` (list) and `DELETE /backgrounds`, with ids from a counter. The URL is `/api/backgrounds/<id>`.
3. **New `lib/background-image.ts`:**
   - `fitWithin(width, height, max = 2048)` returns integer `{ width, height }`, scaled down to fit, never up;
   - `prepareBackgroundImage(file, deps = { load, encode })`:
     - load the image;
     - throw `'too_small'` if a side is under 64;
     - otherwise draw it at `fitWithin` size and encode WebP at quality 0.85, then 0.7, then 0.5, until the result is at most 1 MiB;
     - if it is still too large, throw `'too_large'`.
     
     The defaults use `Image` and a canvas, and tests inject fakes.
4. **Store** (in `store.ts`, `realStore.ts` and the mock store):
   - `setChatBackgroundImage(chatId, imageId, dim)` calls `updatePref` with `{ backgroundPreset: null, backgroundImageId: imageId, backgroundDim: dim }`;
   - `setDefaultBackgroundImage(imageId, dim)` does the same through `putChatBackgroundDefault`, optimistic with rollback.
5. **Dialog:** below the swatches, add a "Your images" section:
   - **Thumbnails:** a row of thumbnail buttons (`<img src={url}>`, `aria-label="Background image N"`, `aria-pressed` when it is the selected image for the current scope). Each has a small `IconButton` with a lucide `Trash2` icon, `aria-label="Delete background image N"`, which deletes it. Delete asks first with an inline "Delete this image?" confirm row, not `window.confirm`.
   - **Upload:** an "Upload image" button with a lucide `ImagePlus` icon opens a hidden file input (`accept="image/png,image/jpeg,image/webp"`). On a pick:
     1. call `prepareBackgroundImage`, then `uploadBackground`;
     2. add the image to the list;
     3. select it for the current scope with dim 40.
     
     Show "Uploading…" while busy.
   - **Error messages:** "This image is too large", "This image is too small", "You already have 20 images, delete one first", and otherwise "Couldn't upload the image", all with `role="alert"`.
   - **Dim slider:** when the selected look for the scope is an image, show `<input type="range" min=0 max=80 step=5 aria-label="Dim">`, defaulting to the stored dim or 40. It saves 400 ms after the last change, through the same image setter.
   - **Loading:** `listBackgrounds` loads when the dialog opens. A failure shows the section with only the Upload button.
   - **Picking a preset** clears the image, which the existing setters already do.
6. **Tests:**
   - **New `lib/background-image.test.ts`:**
     - `fitWithin` with 4000x3000 gives 2048x1536, and 800x600 is unchanged;
     - `prepareBackgroundImage` with fakes: it steps down the quality until the result is at most 1 MiB, throws `too_large` and `too_small`.
   - **`components/ChatBackgroundDialog.test.tsx`:**
     - the list renders thumbnails;
     - an upload (stub `prepareBackgroundImage` and `uploadBackground`) selects the new image with dim 40 for "This chat";
     - a 409 shows the 20-images message;
     - the slider change saves after the debounce (fake timers) with the new dim;
     - delete with confirm calls `deleteBackground` and removes the thumbnail;
     - in "All chats", picking an image calls `setDefaultBackgroundImage`.
   - **`store/realStore.test.tsx`:** `setChatBackgroundImage` sends the three fields, and `setDefaultBackgroundImage` rolls back on failure.

### Read first
`AGENTS.md`, `docs/audit/chat-backgrounds-plan.md` §4 and §8, `apps/web/src/components/ChatBackgroundDialog.tsx`, `apps/web/src/components/ChatBackgroundDialog.test.tsx`, `apps/web/src/components/AvatarUploader.tsx:1-130` and `:180-200`, `apps/web/src/lib/api.ts:185-200` and `:2440-2490`, `apps/web/src/store/realStore.ts` (search `setChatBackground`, `setDefaultBackground`, `updatePref`), `apps/web/src/store/store.ts` (the same names), `apps/web/src/lib/chatBackground.ts`.

### Allowed files
`apps/web/src/lib/api.ts`, `apps/web/src/mock/api.ts`, `apps/web/src/lib/background-image.ts`, `apps/web/src/lib/background-image.test.ts`, `apps/web/src/store/store.ts`, `apps/web/src/store/realStore.ts`, `apps/web/src/store/realStore.test.tsx`, `apps/web/src/components/ChatBackgroundDialog.tsx`, `apps/web/src/components/ChatBackgroundDialog.test.tsx`, `apps/web/src/store/reload.test.tsx`, `apps/web/src/store/realStore.forward.test.tsx`, `apps/web/src/store/realStore.media.test.tsx`, `apps/web/src/store/realStore.topics.test.tsx`, `work/T-0464-web-background-images.md`.

Touch the four `realStore.*`/`reload` test fakes only if a new `ApiClient` method needs a stub there. If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot background-image ChatBackgroundDialog realStore
pnpm gate
```

### Acceptance
- In the Chat background dialog, the user uploads an image (resized to at most 2048 px, WebP, at most 1 MiB), picks it for this chat or all chats, dims it from 0 to 80%, and deletes it with a confirm.
- Server errors show plain messages.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Status: review.** Implemented the web background-images slice of T-0464.

### What I did
- `lib/api.ts`: added `uploadBackground(blob)` (the raw-body POST twin of
  `uploadAvatarBytes`, with a mock branch, `toApiError` and a zod parse),
  `listBackgrounds()` and `deleteBackground(id)` (`z.null()` for the 204),
  plus the `BackgroundImage`/`BackgroundListItem` types.
- `mock/api.ts`: in-memory `POST`/`GET`/`DELETE /backgrounds` with a counter
  id, a 20-image cap (409 `too_many_backgrounds`), newest-first list, and
  delete clearing any pref/default that referenced the id. URLs are
  `/api/backgrounds/<id>`.
- New `lib/background-image.ts`: `fitWithin` (scales down to 2048, never up,
  integer sides) and `prepareBackgroundImage(file, deps)` (rejects sides under
  64 as `too_small`, encodes WebP at 0.85/0.7/0.5 until ≤ 1 MiB, then throws
  `too_large`). `Image`+canvas defaults; tests inject fakes.
- Stores (`store.ts`, `realStore.ts`): `setChatBackgroundImage(chatId,
  imageId, dim)` via `updatePref` with all three fields, and
  `setDefaultBackgroundImage(imageId, dim)` via `putChatBackgroundDefault`,
  optimistic with rollback (real store). No new `ApiClient` method, so the
  four store test fakes needed no changes.
- `ChatBackgroundDialog.tsx`: a "Your images" section below the swatches —
  thumbnails (`aria-label="Background image N"`, `aria-pressed`), a `Trash2`
  `IconButton` per image with an inline "Delete this image?" confirm, an
  `ImagePlus` "Upload image" button with a hidden file input, plain error
  sentences (`role="alert"`), and a 0-80 step-5 `Dim` slider that saves 400 ms
  after the last change through the image setter. Presets still clear the
  image. `listBackgrounds` loads on open; a failure leaves only Upload.
- Tests: new `lib/background-image.test.ts`; new T-0464 cases in
  `ChatBackgroundDialog.test.tsx` (list, upload+select dim 40, 409 message,
  debounced slider with fake timers, delete-with-confirm, all-chats);
  `realStore.test.tsx` cases for both new setters including rollback.

### Files changed (all inside Allowed files)
`apps/web/src/lib/api.ts`, `apps/web/src/mock/api.ts`,
`apps/web/src/lib/background-image.ts`, `apps/web/src/lib/background-image.test.ts`,
`apps/web/src/store/store.ts`, `apps/web/src/store/realStore.ts`,
`apps/web/src/store/realStore.test.tsx`,
`apps/web/src/components/ChatBackgroundDialog.tsx`,
`apps/web/src/components/ChatBackgroundDialog.test.tsx`,
`work/T-0464-web-background-images.md`. (10 files, gate checks 10.)

### Commands and real results
- `pnpm install` — done.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot background-image ChatBackgroundDialog` — 2 files, 18 passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot realStore.test` — 1 file, 134 passed.
- `pnpm gate` (run 3x; first failed format, second failed a `react(set-state-in-effect)` lint rule, both fixed):
  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (22.4s)
  PASS  lint  (0.7s)
  PASS  typecheck  (11.8s)
  PASS  tests @zilar/web  (46.0s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes
- The Dim slider keeps a small `dimDraft` in component state rather than
  syncing via an effect, to satisfy the repo's `set-state-in-effect` lint rule;
  behaviour is the same (drag value wins until the scope/image changes).
- Added a plain `"Couldn't delete the image"` alert for a failed delete; the
  spec only listed upload sentences.
- Mock upload ignores the bytes (the mock never stores them) and answers with
  1920×1080; ids are `bg-mock-<n>`.

### Open questions
None.

### Round (2026-10-07): pre-review findings

Fixed the four actionable PREREVIEW findings (2 must-fix, 2 should-fix); the
finding 5 nit is untouched.

- **Finding 1 (must-fix):** `selectImage` now takes an explicit `targetScope`
  instead of reading `scope` from the render closure, `changeDim` captures the
  image id and scope when it schedules the save, and a new `clearDimTimer`
  cancels the pending save on a scope change, an image switch, a preset pick and
  an upload. Tests: "does not save the chat dim as the global default when the
  scope changes" and "does not overwrite a newly picked image with a stale dim
  save".
- **Finding 2 (must-fix):** `confirmDelete` now patches the store after a
  successful delete through a new `clearDeletedSelection`, clearing the chat
  pref and/or the global default when the deleted id was the selected image, so
  the chat stops painting the deleted image's URL. Test: "clears the selection
  when the selected image is deleted".
- **Finding 3 (should-fix):** `close()` now calls `clearDimTimer`, so a save
  scheduled under 400 ms before close cannot fire or show a late error on the
  closed dialog. Test: "cancels a pending dim save when the dialog closes".
- **Finding 4 (should-fix):** `mock/api.ts` DELETE now clears `backgroundDim`
  as well as `backgroundImageId` on the matching chat pref and the global
  default, so the mock honours "a dim needs an image".

Notes:

- Finding 4 has no regression test: the only `mockRequest` background test would
  live in `apps/web/src/mock/api.test.ts`, which is not in the task's Allowed
  files, so adding one would put a file outside scope. The fix itself is in an
  Allowed file.
- Finding 5 is a nit and is not on a line any fix changed, so it is left as-is.

Single tests:
`pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot background-image ChatBackgroundDialog realStore`
— 6 files, 190 passed, 0 failed.

`pnpm gate`: GATE PASS.

## Review (written by Claude)

Approved (lead, 2026-10-07). The Chat background dialog gains Your images: thumbnails with aria-pressed, Upload (prepareBackgroundImage fits to 2048 px and steps WebP quality down to 1 MiB, then POST /backgrounds), an inline delete confirm with Trash2, and a 0-80 dim slider debounced at 400 ms. Errors are plain sentences. Store setters for images are optimistic with rollback. Fixed in one auto round. Nits accepted: the mock id starts at 2, an upload-then-select failure shows the upload message, and fitWithin returns early without rounding.

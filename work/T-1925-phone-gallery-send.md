---
id: T-1925
title: "Phone attach sheet: the Gallery tab's \"Send N\" sends the selected photos right away (album, composer text as caption) instead of staging them for a second Send"
status: merged
milestone: M5
branch: task/T-1925-phone-gallery-send
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1925: "Send N" in the gallery sends

## Spec (written by Claude, do not edit)

### Why
**Julio, 2026-10-17, on an iPhone 16 Pro (v0.2.9):**

> if i select images and i click send why im back to the input chat and i have to click send again? thats bad ux ui

The button says "Send N", so it must send.

### Facts (read by the lead on 2026-10-17)
- **`apps/mobile/src/components/chat/attach/gallery-tab.tsx`** (238 lines): the bar labelled `Send {selected.length}` (`:137-152`) calls `send`, which hands the selected assets to `onStageFiles` (the comment at `:21-28` says it "stages the picked files through the composer's strip").
- **`apps/mobile/src/components/chat/attach-sheet.tsx`** passes `onStageFiles` through (`:29`, `:59`).
- **`apps/mobile/src/components/chat/composer.tsx:306`:** `onStageFiles={media.stageFiles}`.
- **`apps/mobile/src/components/chat/composer-media.ts`** (343 lines):
  - `stageFiles` (`:317-322`) only appends to `picks` and closes the sheet;
  - `sendPicked` (`:249-267`) is the real send. It runs `attachmentSends(picks)` (album for 2+ pictures), puts the composer text and reply quote on the first message (`captionOptions(text, replyTo)`), then clears the picks, closes the sheet, clears the error and calls `clearDraft()`;
  - `appendPicks` (`:106`) caps at ten and reports `overflow`.

### Steps
1. **`composer-media.ts`:**
   - Add `sendFiles(files: PickedFile[])`. It computes `const all = appendPicks(picks, files)`, so anything already staged goes too. If `all.overflow`, it sets `MAX_FILES_MESSAGE`.
   - It then sends `all.files` exactly as `sendPicked` does. Factor the shared send into one local function used by both, so there is no duplicate.
   - It then clears the picks, closes the sheet and clears the draft, like `sendPicked`.
   - Return `sendFiles` instead of `stageFiles`, and delete `stageFiles`.
2. **`composer.tsx:306`:** `onSendFiles={media.sendFiles}`.
3. **`attach-sheet.tsx` and `attach/gallery-tab.tsx`:** rename the prop `onStageFiles` → `onSendFiles` and update the doc comments ("sends the picked files", not "stages"). Keep the bar's label and spinner.
4. **Unchanged:** the Library / Camera / File choices (the system pickers) still stage into the strip, because there is no Send button there. So does a demo pick.
5. **No tests** (UI). Files stay at most 400 lines.

### Allowed files
- `apps/mobile/src/components/chat/composer-media.ts`
- `apps/mobile/src/components/chat/composer.tsx`
- `apps/mobile/src/components/chat/attach-sheet.tsx`
- `apps/mobile/src/components/chat/attach/gallery-tab.tsx`
- `work/T-1925-phone-gallery-send.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Selecting photos in the Gallery tab and tapping "Send N"** sends them at once: one album for two or more pictures, with the composer text (if any) as the caption and the reply quote kept. The sheet closes and the composer is empty.
- **Nothing is left** in the composer strip to send again.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- **`composer-media.ts`:**
  - Factored the actual send out of `sendPicked` into a local `sendNow(files, error?)`: it runs `attachmentSends(files)` (album for 2+ pictures), puts the composer text and reply quote on the first message, then clears the picks, closes the sheet, sets the attach error and calls `clearDraft()`. `sendPicked` now only guards the empty case and calls it.
  - Added `sendFiles(files)`: runs `appendPicks(picks, files)` so already staged files go too, then `sendNow(all.files, all.overflow ? MAX_FILES_MESSAGE : undefined)`. The overflow sentence is applied after the send, so it is not wiped by the shared cleanup.
  - Deleted `stageFiles` and return `sendFiles`.
- **`composer.tsx`:** `onSendFiles={media.sendFiles}`.
- **`attach-sheet.tsx`:** prop renamed `onStageFiles` → `onSendFiles`, doc comments now say the gallery's "Send N" sends at once.
- **`attach/gallery-tab.tsx`:** prop renamed `onStageFiles` → `onSendFiles`, header comment updated. The bar's label (`Send {selected.length}`) and spinner are unchanged.
- Library / Camera / File system picks and a demo pick still stage into the strip, as the spec requires.

### Checks run
- `pnpm install --frozen-lockfile`: Done in 12.3s.
- `pnpm --filter mobile test --maxWorkers=2 --reporter=dot src/components/chat/attach/gallery-reader.test.ts`: 1 file passed, 4 tests passed.
- `pnpm gate` (repo root, summary lines):
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (0.7s)
  PASS  lint  (1.2s)
  PASS  typecheck  (5.6s)
  PASS  effect  (1.5s)
  PASS  tests @zilar/mobile  (1.4s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- No new tests (UI, per the spec). I did not run the app on a phone; the acceptance item "selecting photos and tapping Send N sends at once" is covered by code reading and the gate, and needs Julio's live check.
- When more than ten files are picked, the first ten send and the cap sentence is set on the attach error, but the sheet closes at the same time, so that sentence is only visible if something else shows `attachError` outside the sheet. That matches the previous overflow behaviour; flagging it in case you want a toast instead.
- Files are all under 400 lines (`composer-media.ts` 345, `gallery-tab.tsx` 238).

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `ba6a460a9`.
- **Smoke:** passes on the emulator (mock, `/chat/marta@zilar.test`).
- **Checked on screen:** I allowed photo access, put two test photos in the gallery, selected both in the Gallery tab and tapped "Send 2". The sheet closed and one album was sent at once. The composer was empty, with no strip left to send.
- **Code:** `sendFiles` and the composer's Send share one `sendNow`, so the album, caption, reply quote and the ten-file cap behave the same.
- **Pre-review nit, left as is:** the tab's internal "stage" names.

---
id: T-1924
title: "Phone photo bubbles fit the photo: a tall or narrow photo sizes the bubble to its own width (min 140 px) instead of leaving a white bar beside it"
status: merged
milestone: M5
branch: task/T-1924-phone-photo-fit
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1924: The photo bubble is as wide as the photo

## Spec (written by Claude, do not edit)

### Why
**Julio, 2026-10-17, on an iPhone 16 Pro (v0.2.9).** A tall photo (a phone screenshot) shows inside a wider white bubble, leaving a white bar on its right. The bubble must fit the photo, like Telegram.

### Facts (read by the lead on 2026-10-17)
- **`apps/mobile/src/components/chat/media-bubble.tsx`** (380 lines, near the 400 limit):
  - `const MEDIA_WIDTH = 240;` and `const MAX_IMAGE_HEIGHT = 320;` (`:24-25`);
  - `MediaBubble` wraps every media in `<View style={{ width: MEDIA_WIDTH }}>` (`:177`);
  - `MediaImage` sizes the photo with `{ width: '100%', aspectRatio: ratio, maxHeight: MAX_IMAGE_HEIGHT }`, or `{ width: '100%', height: MAX_IMAGE_HEIGHT }` without a ratio (`:276-283`), and `contentFit="cover"` (`:358`).
- **The cause:** a tall photo hits `maxHeight`, so Yoga shrinks its width to keep the ratio (for example 9:19.5 → about 148 px). The 240 px wrapper stays, and the outgoing bubble's white background fills the rest.
- **`apps/mobile/src/components/chat/image-message.tsx`** (28 lines): the legacy `message.image` uses the same `width: '100%'`, `aspectRatio`, `maxHeight: 320` (`:7`, `:22-24`). It is rendered by `MediaBubble` (`:144-145`).
- **Web is already right:** `apps/web/src/components/message/AttachmentBody.tsx:207` uses `max-h-[320px] w-full object-cover`. No web change.

### Steps
1. **New `apps/mobile/src/components/chat/media-frame.ts`:** export `MEDIA_WIDTH = 240`, `MAX_IMAGE_HEIGHT = 320`, `MIN_MEDIA_WIDTH = 140`, and:
   ```ts
   /** The pixel box of a single photo bubble (T-1924): as wide as the photo at
    *  its ratio, at most 240 x 320, never narrower than 140 (then cropped). */
   export function mediaFrame(ratio: number | undefined): { width: number; height: number } {
     if (ratio === undefined || !(ratio > 0)) {
       return { width: MEDIA_WIDTH, height: MAX_IMAGE_HEIGHT };
     }
     const height = Math.min(MAX_IMAGE_HEIGHT, MEDIA_WIDTH / ratio);
     const width = Math.min(MEDIA_WIDTH, Math.max(MIN_MEDIA_WIDTH, height * ratio));
     return { width: Math.round(width), height: Math.round(height) };
   }
   ```
2. **`media-bubble.tsx`:**
   - import the constants from `media-frame.ts` and delete the local ones (`:24-25`);
   - in `MediaImage`, replace `size` (`:280-283`) with `mediaFrame(ratio)`. Keep `contentFit="cover"`;
   - in `MediaBubble`, the wrapper (`:177`) gets the frame's width for a single photo: an `image` attachment that is not a GIF video, or `message.image` with its `width`/`height`. Albums, GIF videos and every other kind keep `MEDIA_WIDTH`.
   - The caption below the photo keeps its padding and wraps within that width.
3. **`image-message.tsx`:** use `mediaFrame(image.width / image.height)` for the style instead of `width: '100%'`, `aspectRatio` and `maxHeight`. Delete its local `MAX_IMAGE_HEIGHT`.
4. **No tests** (UI). Files stay at most 400 lines.

### Allowed files
- `apps/mobile/src/components/chat/media-frame.ts`
- `apps/mobile/src/components/chat/media-bubble.tsx`
- `apps/mobile/src/components/chat/image-message.tsx`
- `work/T-1924-phone-photo-fit.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- A tall photo (for example a phone screenshot) shows in a bubble exactly as wide as the photo (at least 140 px), with no white bar beside it.
- A wide photo is 240 px wide and as tall as its ratio needs.
- Albums and GIFs look as before.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- Added `apps/mobile/src/components/chat/media-frame.ts` with `MEDIA_WIDTH = 240`, `MAX_IMAGE_HEIGHT = 320`, `MIN_MEDIA_WIDTH = 140` and `mediaFrame(ratio)`, exactly as the spec defines it (no ratio or a ratio `<= 0` gives 240 x 320; otherwise height is capped at 320 and width at 240, with a 140 px floor; both rounded).
- `media-bubble.tsx`:
  - removed the local `MEDIA_WIDTH` / `MAX_IMAGE_HEIGHT` and imports them, plus `mediaFrame`, from `media-frame.ts`;
  - `MediaImage` now styles the `Image` / demo gradient with `mediaFrame(ratio)` instead of `width: '100%'`, `aspectRatio` and `maxHeight`; `contentFit="cover"` is unchanged;
  - the bubble wrapper width is `mediaFrame(ratio).width` for a single photo (legacy `message.image`, or an `image` attachment that is not a GIF video), otherwise `MEDIA_WIDTH`. Albums, GIF videos and every other kind stay at 240 px.
- `image-message.tsx`: the legacy gradient uses `mediaFrame(image.width / image.height)` for its width and height; its local `MAX_IMAGE_HEIGHT` is gone.
- No tests added (UI, per the spec). Line counts: `media-bubble.tsx` 396, `image-message.tsx` 25.

### Checks run

- `pnpm install` — completed, no errors.
- `pnpm gate` (repo root, exit 0):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (0.6s)
  PASS  lint  (1.1s)
  PASS  typecheck  (6.1s)
  PASS  effect  (1.7s)
  PASS  tests @zilar/mobile  (1.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- Manual check of the helper (one-off `tsx -e`, not a test file): `mediaFrame` returns `{width:148,height:320}` for a 1170 x 2532 phone screenshot, `{width:240,height:180}` for 4:3, `{width:240,height:320}` for no ratio, `{width:140,height:320}` for 0.1 (cropped at the floor), `{width:240,height:240}` for 1:1.
- I did not run the app on a phone, so the visual result needs the lead's smoke / Julio's check.

### Notes for the lead

- One small deviation from the literal wording of step 2: the wrapper narrows only when the photo actually renders. A failed upload (the "Upload failed / Retry" row) and an untrusted image (the click-to-load file row) keep the full 240 px, because those are file rows rather than photos and would wrap badly at 140 px. Albums, GIF videos and all non-image kinds are untouched.
- `apps/mobile/src/components/chat/attachment-message.tsx` still has its own 240 px image sizing. Its images render in the padded (non-media-first) bubble and the spec did not list the file, so I left it alone.
- The helper rounds the width and height, so the wrapper and the image get the same integer box (for example 148 x 320) and no white sliver can remain from sub-pixel rounding.

### Fix round (pre-review nit 1)

- `media-frame.ts`: the guard is now `ratio === undefined || !Number.isFinite(ratio) || ratio <= 0`, so a legacy image with `height: 0` (ratio `Infinity`) or a `NaN` ratio falls back to `{ width: 240, height: 320 }` instead of `{ width: NaN, height: 0 }`. Checked with a one-off `tsx -e`: `Infinity`, `NaN`, `0` and `-2` all give 240 x 320; 1170/2532 still gives 148 x 320.
- Nit 2 (the narrow "Couldn't load" row) left as is, as instructed.
- `pnpm gate` after the fix (exit 0): install, format, lint, typecheck, effect and tests @zilar/mobile all PASS; scope clean; `GATE PASS`.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `27c9e1b77`.
- **Smoke:** passes on the emulator (mock, `/chat/marta@zilar.test`). The first run's Gradle failure was transient, and the rerun passed.
- **Checked on screen:** I sent a 300×900 photo from the gallery. Its bubble is now a narrow, tall frame instead of the fixed 240 dp wrapper; mock mode leaves the photo itself blank by design.
- **Code:** single photos and legacy images get `mediaFrame`'s width. Albums, GIFs, failed and untrusted rows keep 240.
- **Fix round:** pre-review nit 1. A non-finite ratio (a legacy image with `height: 0`) now falls back to 240×320 instead of a NaN width.
- **Left as is:** nit 2, a load-failed photo's "Couldn't load" row can be as narrow as 140 px (an edge case).


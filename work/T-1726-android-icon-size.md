---
id: T-1726
title: "Android app icon too big: the mark touches the launcher's circle (Julio's home screen, v0.2.3). Scale the adaptive foreground and monochrome layers from 563 px to 390 px so the whole mark, moon included, sits well inside the visible circle"
status: merged
milestone: M5
branch: task/T-1726-android-icon-size
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1726: Shrink the Android adaptive icon mark

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-16, with a screenshot of v0.2.3 on his phone: "the zilar icon is to big ... is in the border of the icon". The orbit and the gold moon touch the edge of the launcher's circle, while other apps keep a margin.

### Facts (the lead measured them on 2026-10-16)
- **The script:** `tools/brand-3d/build-app-icon.sh:19-30` trims the glyph and resizes it to a **563×563** box in a 1024 canvas, for both `apps/mobile/assets/images/android-icon-foreground.png` and `android-icon-monochrome.png`.
- **The visible circle:** a launcher's circle mask shows only the middle 72 of the 108 dp, which is 682 px of 1024, a **341 px radius**.
- **The problem:** in the current foreground the moon's far edge sits about **346 px** from the center (its center at about (720, 334), radius about 72). It's outside the visible circle.
- **The tools:** `rsvg-convert` and `magick` are installed (`/opt/homebrew/bin`).

### Steps
1. **In `build-app-icon.sh`:** change both `-resize 563x563` to **`-resize 390x390`**, and update the comment (`:19-20`):
   - "390 px keeps the whole mark, moon included, within about 240 px of the center: about 70% of the 682 px circle a launcher shows, like other apps' marks";
   - "the trimmed box's corners matter, because the moon and the orbit tip reach them".
2. **Run** `bash tools/brand-3d/build-app-icon.sh` from the repo root, and commit the regenerated `android-icon-foreground.png` and `android-icon-monochrome.png`. Don't touch `icon.png` (iOS) or the background layer; if the script rewrites them, restore them with `git checkout`, unless they're byte-identical.
3. **Check:** `magick apps/mobile/assets/images/android-icon-foreground.png -trim info:` shows a trimmed box about 390 px wide, centered. Paste the line in the Report.

### Allowed files
- `tools/brand-3d/build-app-icon.sh`
- `apps/mobile/assets/images/android-icon-foreground.png`
- `apps/mobile/assets/images/android-icon-monochrome.png`
- `work/T-1726-android-icon-size.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The mark** is 390 px in both adaptive layers, centered in the 1024 canvas.
- **The other icons** don't change.
- **The gate passes.**

---

## Report (written by the worker when done)

### What I did

- Changed both `-resize 563x563` to `-resize 390x390` in
  `tools/brand-3d/build-app-icon.sh` and rewrote the adaptive-layer comment (`:19-23`)
  with the text from the spec (390 px keeps the mark within about 240 px of the center,
  and the trimmed box's corners matter).
- Ran `bash tools/brand-3d/build-app-icon.sh` from the repo root, which regenerated the
  two adaptive layers.
- The script also rewrote `android-icon-background.png` (not in the allowed set), so I
  restored it with `git checkout` as the spec says. `icon.png` (iOS) was left untouched
  by the render (byte-identical), so no restore was needed.

Changed files:
- `tools/brand-3d/build-app-icon.sh` (563 → 390, comment)
- `apps/mobile/assets/images/android-icon-foreground.png` (regenerated)
- `apps/mobile/assets/images/android-icon-monochrome.png` (regenerated)
- `work/T-1726-android-icon-size.md` (this report)

### Checks run

`magick apps/mobile/assets/images/android-icon-foreground.png -trim info:` →

```
apps/mobile/assets/images/android-icon-foreground.png PNG 390x345 1024x1024+317+339 8-bit sRGB 29900B 0.000u 0:00.000
```

Width 390 (the trimmed box), offset `+317+339`: horizontally the box spans 317…707,
centered in 1024 (317 on each side). The spec's "about 390 px wide, centered" holds.

`magick apps/mobile/assets/images/android-icon-monochrome.png -trim info:` →

```
apps/mobile/assets/images/android-icon-monochrome.png PNG 390x345 1024x1024+317+339 8-bit Gray 16129B 0.000u 0:00.000
```

`git status --porcelain` before the gate showed only the four files above, so
`icon.png` and `android-icon-background.png` are unchanged.

`pnpm gate` summary:

```
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (1.2s)
PASS  lint  (0.8s)
PASS  typecheck  (1.3s)
SKIP effect (no source files changed)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single test files were run: the change touches only a shell script and two PNGs, and
the gate reports `SKIP tests @zilar/mobile (no nearby test files)`.

### Notes for the lead

The trimmed box is now 390 px wide (was 563 px), the size the spec's comment describes
as keeping the whole mark inside the launcher's visible circle. This is a visual change I
cannot verify without a device, so the lead's phone smoke test and Julio's live check
should confirm the mark no longer touches the launcher's circle edge.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **The lead checked the result:**
  - both adaptive layers trim to 390×345, centered (`+317+339` in 1024);
  - a circle-mask preview (background plus foreground, the middle 682 px masked to a circle) shows the whole mark well inside the edge, with a margin like the other apps on Julio's screenshot.
- **Unchanged:** `icon.png` (iOS) and the background layer.
- **Shipping:** it reaches phones with the next release APK (v0.2.4, with the updater).

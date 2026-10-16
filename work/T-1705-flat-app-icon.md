---
id: T-1705
title: "Phone app icon uses the flat Zilar mark (the web favicon: white planet and ring, gold moon, near-black key) instead of the 3D render — a small tools/brand-3d/build-app-icon.sh renders the iOS icon and the Android adaptive layers from assets/brand/icon-flat.svg; Julio's request 2026-10-16"
status: merged
milestone: M5
branch: task/T-1705-flat-app-icon
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1705: The flat Zilar mark as the phone app icon

## Spec (written by Claude, do not edit)

### Why
Julio (2026-10-16): "i will like to have the minimal icon we have of zilar like in the favicon on the web but in the app icon". The web favicon is the flat mark. The phone's launcher icon is still built from the 3D render.

### Facts (the lead read them on 2026-10-16)
- **`assets/brand/icon-flat.svg`** (also copied to `apps/web/public/favicon.svg`):
  - a 1024×1024 `viewBox`;
  - `<rect width="1024" height="1024" rx="230" fill="#0a0a0a"/>`;
  - then one `<g transform="translate(…) scale(…)">` holding the planet and ring (`fill="#fafafa"`) and the moon (`fill="#f0b445"`), sized to 70% of the width (`tools/brand-3d/build-assets.sh:51-58`).
- **`tools/brand-3d/build-assets.sh`:**
  - it renders the 3D scene first (`:11`, needs Chrome);
  - its mobile section (`:70-77`) writes:
    - `icon.png` from the 3D `icon-bleed.png` (`:71`);
    - `android-icon-foreground.png` (`:72`) and `android-icon-background.png` (`:73`) from 3D layers;
    - `android-icon-monochrome.png` from a mono mask (`:74-75`);
    - `splash-icon.png` (`:76`);
    - `favicon.png` from `icon-flat.svg` (`:77`).
- **`apps/mobile/app.json`:**
  - `"icon": "./assets/images/icon.png"` (`:7`);
  - `android.adaptiveIcon` (`:15-20`) has `backgroundColor "#E6F4FE"` and the foreground, background and monochrome PNGs.
- **Tools:** `rsvg-convert` and `magick` are installed (`/opt/homebrew/bin`). The folder `tools/brand-3d/` has no `build-app-icon.sh`.

### Steps
1. **Create `tools/brand-3d/build-app-icon.sh`** (POSIX `sh`, `set -eu`, needs only `rsvg-convert` and `magick`, no Chrome). It reads `assets/brand/icon-flat.svg` and writes into `apps/mobile/assets/images/`:
   - **`icon.png`** (1024×1024, iOS and store): the flat mark on a **full-bleed square**, with no transparent corners because iOS masks the corners itself. Render the SVG with the rounded `rect` replaced by a plain `#0a0a0a` square (for example a temporary SVG via `sed` on the `rx="230"` attribute **inside the script**, or a flattened `magick` background).
   - **`android-icon-foreground.png`** (1024×1024, transparent): the glyph only, without the rect. Scale it so the whole glyph fits inside the central 66% safe zone (the adaptive-icon mask crops the rest); about 55% of the width is safe.
   - **`android-icon-background.png`** (1024×1024): solid `#0a0a0a`.
   - **`android-icon-monochrome.png`** (1024×1024, transparent): the same glyph and placement as the foreground, all white (the moon too), for Android themed icons.
   - Leave `splash-icon.png` and `favicon.png` alone.
2. **`build-assets.sh`:** replace `:71-75` (the four icon writes) with a call to `sh build-app-icon.sh`, so a full rebuild produces the same files. Keep `:76-77`.
3. **`apps/mobile/app.json`:** set `android.adaptiveIcon.backgroundColor` to `"#0a0a0a"`.
4. **Run `sh tools/brand-3d/build-app-icon.sh`** and commit the four regenerated PNGs.
5. **No tests.** In the Report, give each PNG's size (`magick identify`).

### Allowed files
- `tools/brand-3d/build-app-icon.sh`
- `tools/brand-3d/build-assets.sh`
- `apps/mobile/app.json`
- `apps/mobile/assets/images/icon.png`
- `apps/mobile/assets/images/android-icon-foreground.png`
- `apps/mobile/assets/images/android-icon-background.png`
- `apps/mobile/assets/images/android-icon-monochrome.png`
- `work/T-1705-flat-app-icon.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The four PNGs show the flat mark:**
  - `icon.png` has a full-bleed near-black square;
  - the Android foreground's glyph sits inside the 66% safe zone;
  - the monochrome is all white.
- **`build-assets.sh` calls the new script.** The new icon ships with the next native build (APK or iOS), not with a JS update.

---

## Report (written by the worker when done)

### What I did

- Created `tools/brand-3d/build-app-icon.sh` (POSIX `sh`, `set -eu`, only `rsvg-convert` + `magick`, no Chrome). It reads `assets/brand/icon-flat.svg` and writes the four PNGs into `apps/mobile/assets/images/`:
  - `icon.png`: renders the SVG with ` rx="230"` stripped, so the flat mark sits on a full-bleed `#0a0a0a` square (no rounded corners, no alpha).
  - `android-icon-foreground.png`: renders the SVG with the `<rect>` line removed (glyph only), `-trim +repage -resize 563x563` (~55% of 1024, the spec's safe-zone figure), then centered on a transparent 1024×1024.
  - `android-icon-background.png`: solid `#0a0a0a` 1024×1024.
  - `android-icon-monochrome.png`: the same glyph and placement, both fills turned `#ffffff`. Rendered from the same geometry as the foreground, so the two line up exactly.
  - Intermediates go to `tools/brand-3d/out/` (already gitignored). `splash-icon.png` and `favicon.png` are not touched.
- `tools/brand-3d/build-assets.sh`: replaced the old lines 71-75 (icon, foreground, background, mono-mask, monochrome) with `sh build-app-icon.sh`; kept the splash write and the favicon write. Updated the section comment.
- `apps/mobile/app.json`: `android.adaptiveIcon.backgroundColor` `#E6F4FE` → `#0a0a0a`.
- Ran `sh tools/brand-3d/build-app-icon.sh` and committed the four regenerated PNGs.

### Checks run

- `magick identify` on the four PNGs:
  - `icon.png` 1024x1024 PNG srgb (no alpha channel)
  - `android-icon-foreground.png` 1024x1024 PNG srgba alpha=Blend
  - `android-icon-background.png` 1024x1024 PNG gray
  - `android-icon-monochrome.png` 1024x1024 PNG graya alpha=Blend
- Acceptance spot checks: `icon.png` corners are `srgb(10,10,10)`; foreground/monochrome trimmed glyph is `563x499+230+262` (width 563 = 55% of 1024, centered), identical for both; monochrome's only visible pixels are `(255,255,255)`; background center is `gray(10)`. Rendered a small 4-up preview and eyeballed it: flat mark full-bleed, foreground in the safe zone, solid background, all-white monochrome.
- `sh -n` on both scripts: ok.
- `pnpm gate` from the repo root, tail:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (1.3s)
  PASS  typecheck  (3.5s)
  SKIP effect (no source files changed)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  ...
  GATE PASS
  ```
- No unit tests written or run: the change is assets + a build script, per the spec ("No tests").

### Notes for the lead

- I did **not** run `build-assets.sh` itself: it renders the 3D scene first and needs Chrome and the fetched textures. I verified the edit with `sh -n` and by confirming `build-app-icon.sh` runs standalone from the same directory (`sh build-app-icon.sh` prints `app icons ready`).
- `build-app-icon.sh` is committed as a non-executable file (`-rw-r--r--`), matching `build-assets.sh`/`fetch-textures.sh`; it is invoked as `sh build-app-icon.sh`. `render.sh` is the only executable one.
- The icon only reaches devices with the next native build (APK/iOS), not a JS update.

## Review (written by Claude)

**Approved and merged.** Julio OK'd the preview on 2026-10-16.

- **Pre-review:** clean, 2 nits, both left as they are:
  - `build-assets.sh` still renders the unused 3D background layer;
  - the script's `sed` edits depend on the generator's exact SVG text.
- **The lead's check:**
  - all four PNGs are 1024×1024;
  - the Android foreground holds `#F0B445` (the gold moon) and `#FAFAFA`;
  - a preview composite looks right: iOS is a full-bleed square, the Android glyph sits inside the round mask with a gold moon, and the themed icon is all white.
- **When it ships:** with the next native build (APK or iOS).

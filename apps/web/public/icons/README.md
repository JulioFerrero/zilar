# Zilar web icons

Source: `zilar-mark.svg` (a chat bubble with three dots on near-black,
matching the app's dark theme). The PNGs below are generated from it with
macOS `sips` — no new dependency. Re-run these exact commands after changing
the mark:

```bash
cd apps/web
sips -s format png public/icons/zilar-mark.svg --out public/icons/icon-512.png -z 512 512
sips -s format png public/icons/zilar-mark.svg --out public/icons/icon-maskable-512.png -z 512 512
sips -s format png public/icons/zilar-mark.svg --out public/icons/icon-192.png -z 192 192
sips -s format png public/icons/zilar-mark.svg --out public/icons/apple-touch-icon.png -z 180 180
```

Notes:

- `sips` rasterizes the SVG at 512×512 and scales down; `-z height width`
  sets the output size.
- The maskable icon reuses the 512 artwork with full-bleed background (the
  mark already fills the canvas with safe padding), so it survives adaptive
  masking.
- `apple-touch-icon.png` is 180×180 for iOS home-screen icons, referenced
  from `index.html`.

# Zilar web icons

These files are generated, do not edit them by hand. The source is the 3D scene in
`tools/brand-3d`; run `sh tools/brand-3d/build-assets.sh` to rebuild them (it also writes
`public/favicon.svg`, `public/favicon.ico`, `assets/brand/*` and the mobile images).

- `icon-192.png`, `icon-512.png`: the rounded key with its drop shadow (transparent corners).
- `icon-maskable-512.png`: full-bleed key, for adaptive masks. The mark stays inside the 80% safe zone.
- `apple-touch-icon.png`: full-bleed 180 px square, iOS rounds the corners itself.
- `../favicon.svg`: the flat mark (white planet and ring, gold moon) on the near-black key, legible at 16 px.

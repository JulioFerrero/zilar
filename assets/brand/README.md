# Zilar brand marks

Zilar is Basque for "silver". The mark is a silver planet with a tilted orbit ring and a small gold moon on the orbit (the moon is the only colour, so it stays visible at small sizes), set on a black brushed-metal key. It follows the project's skeuomorphic depth (`docs/design/ui-style.md`): real scanned metal, real studio reflections, a soft drop shadow.

Everything here is generated from the 3D scene in `tools/brand-3d` (Three.js, CC0 textures, see its README). Do not edit the files by hand: run `sh tools/brand-3d/build-assets.sh`.

- `icon.png`: the full icon, 1024 px, rounded key with its shadow, transparent corners. Use it on dark and light pages, in the README and in docs.
- `icon-bleed.png`: the same icon as a full-bleed square, no transparency. App stores and the OS masks (iOS, Android adaptive) round the corners themselves.
- `icon-flat.svg`: the flat mark on the near-black key, white planet and ring with the gold moon. Simple enough for 16 px favicons.
- `logo-mark.svg`: the monochrome mark alone (vector, traced from the scene). It fills with `currentColor`, so it follows the surrounding text colour. `logo-mark-black.svg` and `logo-mark-white.svg` have the colour fixed, for tools that ignore `currentColor`.

The monochrome mark is the one to use anywhere the 3D icon is too detailed: notification badges, single-colour print, watermarks, the Android themed icon (`android-icon-monochrome.png` in the mobile app), small UI chrome.

Where the files are used: `apps/web/public` (favicon, PWA and touch icons), `apps/mobile/assets/images` (store icon, adaptive layers, themed icon, splash, favicon), the README header and the sign-in page.

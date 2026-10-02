# brand-3d

Three.js scene that renders the Zilar icon and every file derived from it.

- `sh fetch-textures.sh` downloads the CC0 textures (ambientCG metals, a Poly Haven studio HDRI) into `textures/`. They are not committed, see `textures/README.md`.
- `sh build-assets.sh` renders the layers (`LAYER=full|bleed|foreground|background|mono sh render.sh` renders one) and writes `assets/brand/*`, `apps/web/public/*` and `apps/mobile/assets/images/*`. Needs Chrome, ImageMagick, potrace and rsvg-convert.
- `npm install && npm run serve`, then open http://localhost:5199 to orbit the model live (`index.html`, `main.js`). Add `?hdri=studio_small_03_2k.hdr` to try the other studio.

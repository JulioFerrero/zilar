# Zilar landing page (`zilar.app`)

A small Vite site: plain HTML, CSS and TypeScript, with the hero rendered live in WebGL (three.js).

- `index.html`: the page. `src/styles.css`: the look (brushed and machined metal, keys, bezels).
- `src/scene.ts`: the hero. The Zilar mark (silver planet, orbit, gold moon) with the same proportions as the icon in `tools/brand-3d`, lit by a Poly Haven studio HDRI and ambientCG metal textures (both CC0, in `public/textures`), in front of a studio-light shader. It loads after the text, renders only while visible, honours `prefers-reduced-motion`, and falls back to the icon image without WebGL.
- `src/controls.ts`, `src/cap.ts`: the monthly-cap dial and the guarded kill switch in the AI section.
- `public/screens`: screenshots from `docs/screenshots` (demo data).

```bash
pnpm --filter @zilar/site dev      # http://localhost:5197
pnpm --filter @zilar/site build    # writes apps/site/dist
pnpm --filter @zilar/site test
```

## Deploy

Publish `apps/site/dist` as a static site at the root of `zilar.app` (build command `pnpm --filter @zilar/site build`). Redirect `www.zilar.app` and `zilar.org` there. The "Request access" links are `mailto:hello@zilar.app`, so that mailbox has to exist before the page goes public. Serve `textures/studio.hdr` compressed (gzip or brotli): it shrinks a lot.

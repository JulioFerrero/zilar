# Zilar landing page (`zilar.app`)

A small Vite site: plain HTML, CSS and TypeScript, with the hero rendered live in WebGL (three.js).

- `index.html`: the page. `src/styles.css`: the look (brushed and machined metal, keys, bezels).
- `src/scene.ts`: the hero. The Zilar mark (silver planet, orbit, gold moon) with the same proportions as the icon in `tools/brand-3d`, lit by a Poly Haven studio HDRI and ambientCG metal textures (both CC0, in `public/textures`). It loads after the text, renders only while visible, honours `prefers-reduced-motion` (a still frame), and falls back to the icon image without WebGL. Phones get fewer particles and a lower pixel ratio.
- `src/shaders.ts`: the GLSL. A domain-warped nebula behind the mark, twinkling stars, dust drifting along the orbit that glows gold where the moon has just passed, and a finishing pass (lens fringing and film grain) after bloom and tone mapping. The shaders write linear colour; `OutputPass` tone-maps once for everything.
- `src/controls.ts`, `src/cap.ts`: the monthly-cap dial and the guarded kill switch in the AI section.
- `public/screens`: screenshots from `docs/screenshots` (demo data). `public/features`: tight crops of the same screenshots (approval card, tool, routines, providers, machine) for the feature sections.

```bash
pnpm --filter @zilar/site dev      # http://localhost:5197
pnpm --filter @zilar/site build    # writes apps/site/dist
pnpm --filter @zilar/site test
```

## Deploy

The build is a plain static folder, so any static host works (Cloudflare Pages, Caddy, nginx).

1. Build: `pnpm install && pnpm --filter @zilar/site build`. The output is `apps/site/dist`.
2. Serve `apps/site/dist` at the root of `https://zilar.app`.
3. Redirect `www.zilar.app` and `zilar.org` to `https://zilar.app` (301).
4. Turn on gzip or brotli. `textures/studio.hdr` (1.5 MB) compresses well; the rest is already small.
5. Cache `assets/*` forever (the names carry a content hash); keep `index.html` uncached.

Before it goes public: the "Request access" links are `mailto:hello@zilar.app`, so that mailbox must exist.

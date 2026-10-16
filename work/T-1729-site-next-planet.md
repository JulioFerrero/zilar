---
id: T-1729
title: "New landing, step 2: port the real WebGL Zilar mark (apps/site scene: HDRI, silver textures, nebula, stars, gold dust trail, finishing pass) into apps/site-next as a fixed full-page canvas that moves between scroll stations, as in the approved prototype"
status: merged
milestone: M5
branch: task/T-1729-site-next-planet
model: auto
effort: default
depends_on: [T-1728]
estimate: 60 min
---

# T-1729: The real planet behind the whole page

## Spec (written by Claude, do not edit)

### Why
In the approved prototype (`docs/design/mockups/landing/prototype.html`, README next to it) a planet lives in a fixed canvas behind the page and moves to a new "station" in each section. Julio, 2026-10-16: "build the real deal with the correct 3d model". The real model already exists in the current site's scene; this task ports it and gives it the stations.

### Facts (the lead read them on 2026-10-16)
- **The current scene** in `apps/site/src/`:
  - `scene.ts` (59 lines) builds a `WebGLRenderer` (ACES, exposure 0.9), a `PerspectiveCamera(30, …)`, loads `loadSilver` plus `/textures/studio.hdr` (`HDRLoader`), sets the PMREM environment, and calls `createBackdrop`, `createStars`, `createMark`, `createPost` and `startLoop`;
  - **modules:** `scene/config.ts` (proportions `ORBIT = 1.82`, `ORBIT_SPEED`, `NEBULA_SCALE`), `scene/mark.ts` (`Mark = { system, orbit, halo, key, dustUniforms{uTime,uMoon,uPower,uPixelRatio,uScale} }`), `scene/backdrop.ts`, `scene/post.ts`, `scene/geometry.ts`, `scene/textures.ts` and `shaders.ts`. All are under 200 lines.
- **`apps/site/src/scene/loop.ts`** (188 lines):
  - `resize()` sets `home` (wide: `(2.15, 0.05)`, scale `0.64`; narrow, `aspect < 0.85`: `(0.1, 0.95)`, scale `0.46`) at `:55-76`;
  - the frame advances `mark.orbit.rotation.z` by `ORBIT_SPEED`, feeds `uMoon` from it, tilts with the pointer, and lifts the mark with scroll (`home.y + scroll * 1.6`) at `:150-171`;
  - it renders the nebula target, then the composer. Camera `z` goes from 11 to 9 during the intro (`:103`).
- **The texture paths** (`/textures/...`) exist in `apps/site-next/public/textures/` after T-1728.
- **T-1728** gives `apps/site-next/lib/sections.ts` (`SECTION` element ids, `TRIGGER` ScrollTrigger ids `hero-pin`, `story-pin`, `computer-pin`, `details-pin`) and a `{/* planet */}` slot in `apps/site-next/app/page.tsx`.
- **GSAP:** `apps/site-next/lib/gsap.ts` registers ScrollTrigger when the module loads. Import `gsap` and `ScrollTrigger` from `@/lib/gsap`, never straight from `gsap` (T-1728).

### Steps
1. **Port the scene** into `apps/site-next/components/planet/`:
   - `scene.ts`, `loop.ts`, `mark.ts`, `backdrop.ts`, `post.ts`, `geometry.ts`, `textures.ts`, `config.ts` and `shaders.ts`;
   - change only what the steps below need, and keep every file under 400 lines.
2. **`planet.tsx`** (`'use client'`), mounted in the page's planet slot:
   - a `<canvas>` fixed to the viewport (`position: fixed; inset: 0; z-index: 0; pointer-events: none`) behind every section;
   - it starts the scene with a dynamic `import()` after first paint;
   - on success it adds `webgl` to `<html>`; on failure, `no-webgl`;
   - with reduced motion it renders a still frame (as the old scene does).
3. **Stations: replace the hero-only layout and scroll lift with `stations.ts`.**
   - **The fields:** `cx, cy` are the center of the whole mark as a fraction of the viewport's half-width and half-height (−1..1, up is positive); `size` is the orbit's diameter as a fraction of the viewport height; `o` is the canvas opacity.
   - **Converting:** at `z = 0` with the current camera, `halfH = camera.position.z * tan(fov/2)` and `halfW = halfH * aspect`. The mark goes to `(cx * halfW, cy * halfH)` and scales so that `2 * ORBIT * scale = size * 2 * halfH`.
   - **The scroll positions:** taken from ScrollTrigger at runtime: `ScrollTrigger.getById(TRIGGER.x)` start and end for the pinned ones, and the element's `top bottom` → `bottom top` midpoint for `statement`, `keys` and `install`, as the prototype's `ZL.stations()` does.
   - **Between stations:** interpolate with smoothstep, then ease toward the target each frame (`1 - 0.0008^dt`).
   - **The table** (wide, then narrow at `aspect < 0.85`). Each row is `cx, cy, size, o`:

   | station (scroll position) | wide | narrow |
   |---|---|---|
   | page top | .34, .02, .72, 1 | 0, .44, .40, 1 |
   | hero end | .04, 0, 1.19, 1 | 0, .12, .69, 1 |
   | statement middle | .60, .25, .61, .4 | .53, .60, .33, .4 |
   | story start | .39, −.04, .94, .55 | 0, .04, .61, .55 |
   | story end | .39, −.04, .94, .55 | 0, .04, .61, .55 |
   | keys middle | −.57, .14, .65, .6 | 0, .49, .36, .6 |
   | computer start | −.57, .14, .65, 0 | 0, .49, .36, 0 |
   | computer end − 0.2 viewport | 0, −1.16, 2.24, 0 | 0, −.92, 1.37, 0 |
   | details start + 15% of its length | 0, −1.16, 2.24, 1 | 0, −.92, 1.37, 1 |
   | details end | −.18, −1.13, 2.24, 1 | 0, −.88, 1.37, 1 |
   | install middle | .53, .14, .58, .35 | .46, .67, .33, .35 |
   | page end | 0, .19, .69, 1 | 0, .35, .45, 1 |

   - Before the triggers exist, hold the "page top" row.
4. **The moon also moves with scroll:** keep `ORBIT_SPEED`, and add `0.0012` rad per scrolled pixel to `mark.orbit.rotation.z`, so `uMoon` and the gold dust trail follow.
5. **Keep the old scene's behaviour:**
   - the intro (camera 11 → 9, the dust power and the halo fade-in);
   - the pointer tilt and star parallax;
   - the half-resolution nebula, the slow-frame pixel-ratio step-down, and the finishing pass.
6. **Pause rendering** while the canvas opacity is below 0.01.
7. **No tests** (UI).

### Allowed files
- `apps/site-next/components/planet/**`
- `apps/site-next/app/page.tsx`
- `work/T-1729-site-next-planet.md`

### Checks
```bash
pnpm --filter @zilar/site-next build
pnpm gate
```

### Acceptance
- **The real mark renders:** the HDRI-lit silver planet, the ring, the gold moon, the nebula, the stars and the dust trail, in a fixed canvas behind the page.
- **It glides between the stations** in the table as you scroll, on wide and narrow screens.
- **Fallbacks:** reduced motion gives a still frame; no WebGL gives the `no-webgl` class and nothing breaks.
- **The build and the gate pass.**

---

## Report (written by the worker when done)

### What I did

Ported the real WebGL scene from `apps/site/src/` into `apps/site-next/components/planet/` and gave the mark scroll stations in a fixed full-page canvas.

- **Ported, unchanged apart from relative imports:** `config.ts`, `shaders.ts`, `geometry.ts`, `textures.ts`, `backdrop.ts`, `mark.ts`, `post.ts`, `scene.ts`.
- **`loop.ts` (reworked):** dropped the hero-only `home`/`homeScale` layout and the scroll lift. Each frame it takes the station target from `stations.ts`, smoothsteps between rows, eases the current `{cx, cy, size, o}` towards it with `1 - 0.0008^dt`, converts to world space (`halfH = camera.position.z * tan(fov/2)`, `halfW = halfH * aspect`, `position = (cx*halfW, cy*halfH, 0)`, `scale = size*halfH/ORBIT`), writes the opacity to the canvas, and returns early (pausing rendering) when opacity < 0.01. Kept the intro (camera 11→9, dust power, halo fade-in), the pointer tilt and star parallax, the half-resolution nebula, the slow-frame pixel-ratio step-down, and the finishing pass. The moon's `rotation.z` is now the integrated `ORBIT_SPEED` angle plus `window.scrollY * 0.0012`, and `uMoon` follows it.
- **`stations.ts` (new):** the wide/narrow table from the spec (12 rows each), the `smoothstep` interpolation, and the ScrollTrigger scroll positions — `getById(TRIGGER.{hero,story,computer,details}).start/end` for the pins, the element `top bottom`→`bottom top` midpoint for `statement`, `keys`, `install`, plus `0` and `ScrollTrigger.maxScroll(window)`. Narrow when `aspect < 0.85`. If the pins are absent it holds the page-top row.
- **`planet.tsx` (new),** mounted in `app/page.tsx`: a `#gl` canvas fixed to the viewport behind the page, the scene started with a dynamic `import()` in an effect, `webgl` added to `<html>` on success and `no-webgl` on failure, reduced motion detected via `matchMedia`.
- Every new file is well under 400 lines (largest: `loop.ts`, 202).

### Checks run

- `pnpm install` — succeeded (854 packages added).
- `pnpm --filter @zilar/site-next typecheck` — passed (ran once while developing, no output).
- `pnpm --filter @zilar/site-next build` — `✓ Compiled successfully`, `✓ Generating static pages (3/3)`; `out/index.html` contains `<canvas id="gl">`.
- `pnpm gate` — **GATE PASS**, on a tree of 13 changed files. Summary lines:
  ```
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  SKIP tests @zilar/site-next (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The first gate run failed on the Effect ratchet only (see Notes); after the markers it passed.
- No unit tests were added: the spec says UI, no tests, and the gate skipped the package's tests (no nearby test files).

### Notes for the lead

- **Effect ratchet (deviation, needs your awareness):** the first gate run failed with `needs Effect (H1, W4)` on `planet.tsx`, `scene.ts` and `textures.ts` — the ported `async`/`await`/`.then`/`.catch` edges. `apps/site/` is in `EXEMPT_PATHS` but `apps/site-next/` is not, so the copies are counted. I added `// effect-plain: …` markers with reasons to those three files, the same mechanism `components/smooth-scroll.tsx` already uses: this is three.js scene/texture loading and DOM canvas wiring, not app logic, and `site-next` has no Effect dependency. If you would rather exempt the whole app, `^apps/site-next/` in `packages/devtools/src/effect-map/generate.ts` is the repo-wide fix, but that file is outside my Allowed files.
- **Stations need the pins:** `lib/sections.ts` declares `TRIGGER.hero/story/computer/details`, but nothing registers those ScrollTriggers yet, so at runtime `getById` returns `undefined` and the loop holds the page-top station, exactly as spec step 3 says ("Before the triggers exist, hold the 'page top' row"). Once a later task creates the pins the table activates with no change here. I did not add them (the section components are outside my Allowed files).
- **Not visually verified in a browser.** I ran the build and the gate only; I did not open the page, so the acceptance of the visuals (the real mark, the glide between stations) rests on your smoke test.
- **Reduced motion:** time, orbit, twinkle and grain are frozen, and the pointer tilt is off; the scroll stations/canvas opacity still apply, matching how the old scene kept its scroll lift under reduced motion.
- **Moon/scroll:** `mark.orbit.rotation.z` is `orbitAngle + scrollY * 0.0012` (the prototype uses `y * 0.0012`), so it keeps `ORBIT_SPEED` and tracks the scroll as the spec asks.

## Review (written by Claude)

- **Accepted at `c354830cd`.** The pre-review is clean (1 nit) and the packet is current.
- **Smoke test by the lead:** built, served `out/` locally, and took headless Chromium screenshots (SwiftShader WebGL) at 1440×900 and 390×844. The real mark renders as on the live site:
  - the HDRI-lit silver planet, the ring and the gold moon;
  - the nebula, the stars and the dust trail;
  - `<html>` gets `webgl` and `lenis`, with no page errors.
  - The stations hold "page top" until the section pins exist (T-1730 to T-1734), as the spec says. Their tuning is judged once the sections land.
- **The `effect-plain` markers** on `planet.tsx`, `scene.ts` and `textures.ts` are accepted. `apps/site` is exempt by decision (`docs/EFFECT_GUIDE.md:22`), and this package becomes `apps/site` in T-1735.
- **Nit left:** a `startScene` that resolves after unmount isn't disposed. Harmless here: the page never unmounts the planet.


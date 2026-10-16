---
id: T-1742
title: "New landing polish: the hero planet clears the headline, the page shows its static layout if the scripts never start, and the pre-review nits (anchor selector guard, progress trigger cleanup, planet dispose on early unmount)"
status: merged
milestone: M5
branch: task/T-1742-site-next-polish
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1742: Landing polish

## Spec (written by Claude, do not edit)

### Why
In the lead's screenshots (2026-10-16) the planet's first station overlaps the hero headline at 1440×900 and the lede at 1024×768. The pre-reviews of T-1728, T-1729 and T-1731 left small follow-ups.

### Facts (the lead read them on 2026-10-16)
- **The station tables:** `apps/site-next/components/planet/stations.ts:20-33` (`WIDE`) and `:35-` (`NARROW`). Each row is `[cx, cy, size, o]`, and the first row is "page top": wide `[0.34, 0.02, 0.72, 1]`.
- **The `anim` class:** `apps/site-next/app/layout.tsx:49-50`, an inline head script, adds `anim` to `<html>` before paint.
  - If the JS bundle then fails to load or hydrate, CSS under `html.anim` still applies (pinned heights, chapters absolutely placed, terminal lines clipped by GSAP never running), and content can stay hidden.
  - That's the T-1731 pre-review follow-up.
- **`apps/site-next/components/smooth-scroll.tsx`:**
  - `:63`, `document.querySelector<HTMLElement>(href)`, throws on a hash that isn't a valid selector;
  - `:92`, `progress.kill()`, doesn't kill its ScrollTrigger (T-1728 nits).
- **`apps/site-next/components/planet/planet.tsx:17-25`:** the `disposed` flag only guards adding `webgl`. If the component unmounts before `import('./scene')` resolves, the scene still starts on a detached canvas (T-1729 nit).

### Steps
1. **`stations.ts`:**
   - set the wide "page top" row to `[0.5, 0.02, 0.62, 1]`, so the mark sits right of the copy column at 1440×900 and 1024×768;
   - leave the narrow table and the other rows as they are.
2. **A fallback when the scripts never start.**
   - Keep the head script, but have it also set a 4-second timer that removes `anim` unless `window.__zilarReady` is true.
   - `SmoothScroll` sets `window.__zilarReady = true` on mount.
   - Declare the global type in `apps/site-next/lib/sections.ts` or a new `apps/site-next/lib/ready.ts`.
3. **`smooth-scroll.tsx`:** guard the selector (try/catch, or `CSS.escape` on the id after `#`), and in cleanup call `progress.scrollTrigger?.kill()` before `progress.kill()`.
4. **`planet.tsx`:** pass a `cancelled` check into `startScene`, or check it right after the import resolves and before starting the renderer, so a late resolve after unmount starts nothing.
5. **No tests.** Each file stays under 400 lines.

### Allowed files
- `apps/site-next/components/planet/stations.ts`
- `apps/site-next/components/planet/planet.tsx`
- `apps/site-next/components/planet/scene.ts`
- `apps/site-next/app/layout.tsx`
- `apps/site-next/components/smooth-scroll.tsx`
- `apps/site-next/lib/sections.ts`
- `apps/site-next/lib/ready.ts`
- `work/T-1742-site-next-polish.md`

### Checks
```bash
pnpm --filter @zilar/site-next build
pnpm gate
```

### Acceptance
- **At 1440×900** the hero planet no longer crosses the headline.
- **With JS blocked after the head script,** the page falls back to its static layout within 4 s.
- **The three nits are fixed.**
- **The build and the gate pass.**

---

## Report (written by the worker when done)

### What I did

- **`stations.ts` step 1:** changed the wide "page top" row from `[0.34, 0.02, 0.72, 1]` to
  `[0.5, 0.02, 0.62, 1]`. The narrow table and every other row are untouched.
- **Fallback step 2:** the head script in `app/layout.tsx` still adds `anim` before paint and now
  also arms a 4 s timer that removes `anim` unless `window.__zilarReady` is true. New
  `lib/ready.ts` declares `Window.__zilarReady?: boolean` and exports `markReady()`, which
  `SmoothScroll` calls at the top of its mount effect.
- **`smooth-scroll.tsx` step 3:** the anchor click handler now wraps `document.querySelector(href)`
  in `try`/`catch` and returns on an invalid selector; cleanup calls
  `progress.scrollTrigger?.kill()` before `progress.kill()`.
- **`planet.tsx` step 4:** after `import('./scene')` resolves, the callback returns without calling
  `startScene` when `disposed` is true, so a late import resolve after unmount starts no renderer
  (the spec's second option).
- Files changed: `apps/site-next/components/planet/stations.ts`,
  `apps/site-next/components/planet/planet.tsx`, `apps/site-next/app/layout.tsx`,
  `apps/site-next/components/smooth-scroll.tsx`, `apps/site-next/lib/ready.ts` (new),
  `work/T-1742-site-next-polish.md`. `scene.ts` and `sections.ts` were not needed.
- No tests added (spec step 5). Every changed file is under 400 lines (largest: `smooth-scroll.tsx`,
  110 lines).

### Checks run

- `pnpm install`: `Done in 23.8s using pnpm v10.32.1`.
- `pnpm --filter @zilar/site-next build`: `✓ Compiled successfully in 4.0s`, `✓ Generating static
  pages using 4 workers (3/3)`; routes `/` and `/_not-found` built static.
- `pnpm gate` (repo root):
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (2.2s)
  PASS  format  (1.5s)
  PASS  lint  (2.7s)
  PASS  typecheck  (6.3s)
  PASS  effect  (2.8s)
  SKIP tests @zilar/site-next (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: the spec says "No tests", and the gate reported
  `SKIP tests @zilar/site-next (no nearby test files)`.

### Notes for the lead

- The 1440×900 / JS-blocked acceptance items are visual, so I did not verify them myself; the build
  and gate confirm the code paths are valid. The static-layout fallback relies on the head script's
  own timer, which runs even when the bundle is blocked after it.
- Step 4 used the "check right after the import resolves" option, so `scene.ts` is unchanged. If the
  component unmounts while `startScene` is already awaiting textures (after the import resolved),
  the renderer created before that await is still not torn down; both options in the spec stop at
  "before starting the renderer", so I read that as out of scope.

## Review (written by Claude)

- **Accepted at `2e09f68fb`.** The pre-review is clean (1 nit) and the packet is current.
- **Smoke test by the lead:** built, served, and took headless screenshots at 1440×900 and 1024×768.
  - The hero planet now sits right of the copy column at both widths and no longer crosses the headline or the lede.
  - After 45 s (software WebGL) the mark is fully silver, so the planet's start-up change didn't break the scene.
- **Also in this task:** the 4-second fallback that drops `anim` if the app never mounts; the guarded anchor selector; the progress trigger killed on cleanup; and no scene start after an early unmount.

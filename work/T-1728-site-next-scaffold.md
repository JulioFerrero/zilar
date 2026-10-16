---
id: T-1728
title: "New landing, step 1: scaffold apps/site-next (Next.js 16 App Router, static export) with the D24 base styles, fonts, header, footer, Lenis+GSAP smooth-scroll provider, the section ids contract and stub sections — apps/site stays untouched until the swap task"
status: merged
milestone: M5
branch: task/T-1728-site-next-scaffold
model: auto
effort: default
depends_on: []
estimate: 50 min
---

# T-1728: Scaffold the new landing in `apps/site-next`

## Spec (written by Claude, do not edit)

### Why
Julio approved a full rework of www.zilar.app on 2026-10-16. Read `docs/design/mockups/landing/README.md` first, then `docs/design/mockups/landing/prototype.html`: the prototype is the reference for the layout, the copy and the motion.

The live landing redeploys on every push to main (a Coolify Application built from `apps/site`). So the new site is built in a **new package, `apps/site-next`**, and a final task swaps it into `apps/site` in one merge. **Don't touch `apps/site`.**

### Facts (the lead read them on 2026-10-16)
- **Versions:**
  - React is `^19.3.0` in `apps/web/package.json:33-34`; three is `^0.186.1` in `apps/site/package.json:16`;
  - the latest releases are `next` 16.4.2, `gsap` 3.15.0, `@gsap/react` 2.1.2 and `lenis` 1.3.27;
  - TypeScript is `7.0.2` at the root (`package.json:39`).
- **The workspace** picks up `apps/*`. The gate runs `typecheck`, `test`, oxlint and prettier per affected package (`packages/devtools/src/gate/plan.ts`). `apps/site/package.json` shows the script shape (`dev`, `build`, `typecheck: tsc --noEmit -p tsconfig.json`, `test`).
- **What to copy from the old site:** `apps/site/public/` holds `favicon.ico`, `favicon.svg`, `apple-touch-icon.png`, `icon.webp`, `og.jpg`, `robots.txt`, `textures/` and `screens/`.
- **Tokens, keys, header and footer:** the prototype's `<style>` has the `:root` tokens, `.key`, `.key-primary`, `.key-dark`, `.top`, `.nav`, `.progress` and `.foot`; its header and footer markup sit at the top and bottom of the body.

### Steps
1. **New package `apps/site-next`** (`@zilar/site-next`, private, `type: module`):
   - **deps** (exact versions): `next` 16.4.2, `react` and `react-dom` as in `apps/web`, `three` as in `apps/site`, `gsap` 3.15.0, `@gsap/react` 2.1.2, `lenis` 1.3.27;
   - **devDeps:** `@types/react`, `@types/react-dom`, `@types/three`;
   - **scripts:** `dev` (`next dev -p 5198`), `build` (`next build`), `typecheck` (`tsc --noEmit -p tsconfig.json`), `test` (`vitest run --passWithNoTests`);
   - a `tsconfig.json` extending `../../tsconfig.base.json`, with the JSX and Next settings it needs.
2. **`next.config.ts`:**
   - `output: 'export'`, `images: { unoptimized: true }`, `trailingSlash: false`;
   - `typescript: { ignoreBuildErrors: true }`, with a comment that the gate typechecks with `tsc` 7;
   - `eslint: { ignoreDuringBuilds: true }`, since the repo uses oxlint.
3. **`app/layout.tsx`:**
   - `next/font/google`: Archivo with the `wdth` axis, Geist and Geist Mono, exposed as the CSS variables `--display`, `--body` and `--mono`;
   - `metadata`: the title "Zilar", the description "A messenger you host yourself. Your friends and your AIs in one chat.", Open Graph and Twitter with `/og.jpg`, and icons from `public`;
   - `<html lang="en">`, dark only.
4. **`app/globals.css`:** port the prototype's tokens, base rules, keys, header, progress line and footer, as written. Section styles come later.
5. **`components/header.tsx` and `components/footer.tsx`:** the prototype's markup, with the same links and copy.
6. **`components/smooth-scroll.tsx`** (`'use client'`):
   - creates Lenis (`lerp: 0.085`) unless reduced motion is on, syncs it with ScrollTrigger the way the prototype does, and sends `#` links through `lenis.scrollTo`;
   - registers ScrollTrigger once;
   - exposes `useLenis()` through React context;
   - on mount, adds the class `anim` to `<html>` (the prototype's `html.anim` switch);
   - the header's gold progress line scales with total scroll.
7. **`lib/sections.ts`, the contract the later tasks share:**
   - `SECTION = { hero: 'hero', statement: 'statement-sec', story: 'chat', keys: 'keys', computer: 'computer', details: 'strip-pin', install: 'install', finale: 'finale' }`;
   - `TRIGGER = { hero: 'hero-pin', story: 'story-pin', computer: 'computer-pin', details: 'details-pin' }` (the `id` each pinned ScrollTrigger must use).
8. **`app/page.tsx`:** `<SmoothScroll>`, `<Header>`, then one stub component per section in `components/sections/` (`hero.tsx`, `statement.tsx`, `story.tsx`, `keys.tsx`, `computer.tsx`, `details.tsx`, `install.tsx`, `finale.tsx`), each a `<section id={SECTION.x}>` with the prototype's heading text only, then `<Footer>`. Leave a `{/* planet */}` slot before the sections.
9. **Public files:** copy `apps/site/public/*` into `apps/site-next/public/` (a copy; `apps/site` keeps its files).
10. **Builds:** `pnpm --filter @zilar/site-next build` must write `apps/site-next/out/index.html`. Add `out` and `.next` to the package's ignore files if the repo needs it.
11. **No tests** (UI). Keep every file under 400 lines.

### Allowed files
- `apps/site-next/**` (a new package: the files listed in the Steps, nothing in `apps/site`)
- `pnpm-lock.yaml`
- `work/T-1728-site-next-scaffold.md`

### Checks
```bash
pnpm --filter @zilar/site-next build
pnpm gate
```

### Acceptance
- **The build:** `apps/site-next` builds to a static `out/` with the header, the footer and eight stub sections in order, each with its id from `lib/sections.ts`.
- **Smooth scroll:** Lenis and ScrollTrigger are wired once, and `html.anim` is set.
- **`apps/site` is unchanged.**
- **The gate passes.**

---

## Report (written by the worker when done)

### What I did

Scaffolded the new static landing in a new package, `apps/site-next` (`@zilar/site-next`),
following `docs/design/mockups/landing/README.md` and `prototype.html`. `apps/site` is
untouched.

- `package.json`: private, `type: module`; deps `next` 16.4.2, `react`/`react-dom` `^19.3.0`
  (as in `apps/web`), `three` `^0.186.1` (as in `apps/site`), `gsap` 3.15.0, `@gsap/react`
  2.1.2, `lenis` 1.3.27; devDeps `@types/react`, `@types/react-dom`, `@types/three`;
  scripts `dev` (`next dev -p 5198`), `build`, `typecheck`, `test` (`vitest run
  --passWithNoTests`).
- `tsconfig.json`: extends `../../tsconfig.base.json`, `jsx: preserve`, `@/*` → `./*`,
  the Next plugin, includes generated `.next/types`.
- `next.config.ts`: `output: 'export'`, `images.unoptimized`, `trailingSlash: false`,
  `typescript.ignoreBuildErrors` with a comment about the gate's `tsc` 7 typecheck.
- `app/layout.tsx`: `next/font/google` Archivo (with the `wdth` axis) + Geist + Geist Mono as
  `--display`/`--body`/`--mono`; title "Zilar", the spec description, Open Graph and Twitter
  with `/og.jpg`, icons from `public`; `<html lang="en">`, dark only.
- `app/globals.css`: ported the prototype's `:root` tokens, base rules, keys, header,
  progress line and footer, as written. Section styles are left for later tasks.
- `components/header.tsx`, `components/footer.tsx`: the prototype's markup, links and copy.
- `components/smooth-scroll.tsx` (`'use client'`): creates Lenis (`lerp: 0.085`,
  `smoothWheel`) unless reduced motion is on, syncs it with ScrollTrigger
  (`lenis.on('scroll', ScrollTrigger.update)`, `gsap.ticker.add` + `lagSmoothing(0)`),
  registers ScrollTrigger once, sends `#` links through `lenis.scrollTo`, adds `anim` to
  `<html>` on mount, and scrubs the `#progress` gold line to total scroll. Exposes `useLenis()`.
- `lib/sections.ts`: the `SECTION` and `TRIGGER` id contract.
- `app/page.tsx`: `SmoothScroll` → `Header` → `{/* planet */}` slot → `<main id="top">` with the
  eight stub sections in order → `Footer`.
- `components/sections/{hero,statement,story,keys,computer,details,install,finale}.tsx`: one
  `<section id={SECTION.x}>` each, with the prototype's heading text only.
- Copied `apps/site/public/*` into `apps/site-next/public/` (a copy; `apps/site` keeps its own).

### Checks run

- `pnpm install` — ok (linked the new workspace package; updated `pnpm-lock.yaml`).
- `pnpm --filter @zilar/site-next build` — PASS (Next.js 16.4.2). Wrote
  `apps/site-next/out/index.html`; the HTML contains ids `progress`, `top`, `hero`,
  `statement-sec`, `chat`, `keys`, `computer`, `strip-pin`, `install`, `finale` in order, the
  header (`.top`), the footer (`.wrap foot`) and the eight headings.
- `pnpm gate` (repo root) — GATE PASS:
  ```
  gate: 35 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.7s)
  PASS  typecheck  (3.7s)
  PASS  effect  (0.9s)
  SKIP tests @zilar/site-next (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- Single test files run: none. This is UI code with no test files, and the gate skipped the
  package's tests ("no nearby test files").
- `apps/site` is unchanged (`git status --short apps/site` is empty).

### Notes for the lead

- **Deviation (spec step 2):** I dropped `eslint: { ignoreDuringBuilds: true }`. Next 16.4.2
  removed ESLint config support: the build warned `eslint configuration in next.config.ts is no
  longer supported`, and `tsc` failed with `next.config.ts: 'eslint' does not exist in type
  'NextConfig'` (TS2353). Next 16 does not run ESLint during builds at all, so the spec's intent
  ("the repo uses oxlint") still holds. The build is now clean.
- `apps/site-next/.gitignore` ignores `/.next/`, `/out/`, `next-env.d.ts` and `*.tsbuildinfo`
  (step 10's "if the repo needs it"): without it the untracked build output would show up as
  out-of-scope changed files.
- `app/layout.tsx` sets `metadataBase` so the relative `/og.jpg` OG/Twitter URLs do not warn at
  build time.
- `useLenis()` is backed by a small module-level store read through `useSyncExternalStore`
  rather than `useState` set inside the effect: oxlint's `react(set-state-in-effect)` rejects the
  obvious pattern, and AGENTS.md forbids disabling lint rules. Consumers re-render when the
  instance exists.
- `lib/sections.ts` exports `TRIGGER` but nothing uses it yet (the pinned ScrollTriggers are
  later tasks); it is the shared contract.

### Fix round 1 (lead review)

- **GSAP registration ordering.** Added `apps/site-next/lib/gsap.ts`: it imports `gsap` and
  `ScrollTrigger`, calls `gsap.registerPlugin(ScrollTrigger)` once at module scope when
  `typeof window !== 'undefined'`, and re-exports both. `components/smooth-scroll.tsx` now imports
  from `@/lib/gsap` instead of calling `registerPlugin` itself. React runs child effects before
  parent effects, so registration at module load happens before any section effect runs.
- **`html.anim` before first paint.** `app/layout.tsx` now renders an inline `<head>` script
  (`dangerouslySetInnerHTML`) that adds `anim` to `<html>`, and `<html suppressHydrationWarning>`.
  The `classList.add('anim')` call was removed from `smooth-scroll.tsx`. Without JavaScript the
  class never appears, so the static layout is unchanged.
- **Refresh after fonts/load.** `smooth-scroll.tsx` calls `ScrollTrigger.refresh()` once
  `document.fonts.ready` resolves (the display font changes heights), and once on `window` `load`
  if it has not fired yet (otherwise it refreshes immediately). The file carries an
  `// effect-plain:` marker because of that one Promise edge, matching `toast.tsx`.

**How the section tasks (T-1730…T-1734) should use it:**

- Import the shared instance: `import { gsap, ScrollTrigger } from '@/lib/gsap'` (never import
  `gsap/ScrollTrigger` directly, so registration happens once).
- Create triggers inside `useGSAP` in the section's `'use client'` component, so they are reverted
  on unmount.
- Give every pinned ScrollTrigger its id from `TRIGGER` in `lib/sections.ts`, e.g.
  `ScrollTrigger.create({ trigger: '#' + TRIGGER.hero, pin: true, ... })`, so the planet stations
  and later tasks can find it by id.

## Review (written by Claude)

- **Accepted at `a31f43099`.** The pre-review is clean (0 must-fix, 2 nits) and the packet is current.
- **What it builds:**
  - `apps/site-next` builds a static `out/`: the header, the footer and eight stub sections with the `SECTION` ids;
  - Lenis and ScrollTrigger are wired once, with the gold progress line;
  - `apps/site` is untouched.
- **Fix round 1 (from the lead):**
  - The problem: child effects run before the provider's, so the sections would have built triggers before the plugin was registered and before `html.anim` applied.
  - The fix: `lib/gsap.ts` registers at module load, an inline head script sets `anim` before paint, and `ScrollTrigger.refresh()` runs after the fonts load and after window load.
- **Correction to the report's example:** `TRIGGER.x` is the ScrollTrigger **id** (`id: TRIGGER.hero`), not an element id. The element is `'#' + SECTION.hero`. The section specs already say so.
- **Nits left for later:** the unguarded `querySelector(href)`, and `progress.scrollTrigger` not killed on unmount. Both are harmless in a static export.

---
id: T-1730
title: "New landing, step 3: hero (pinned, letter-by-letter intro and breakup, still-image fallback) and the ownership line (words light up on scroll) in apps/site-next, as in the approved prototype"
status: merged
milestone: M5
branch: task/T-1730-site-next-hero
model: auto
effort: default
depends_on: [T-1728]
estimate: 40 min
---

# T-1730: Hero and ownership line

## Spec (written by Claude, do not edit)

### Why
Julio approved the new landing on 2026-10-16. Read `docs/design/mockups/landing/README.md`, then `docs/design/mockups/landing/prototype.html`, which is the reference. This task builds its first two sections in the Next.js app from T-1728.

### Facts (the lead read them on 2026-10-16)
- **The prototype's hero:**
  - markup at `docs/design/mockups/landing/prototype.html:317-341`;
  - CSS under `/* Hero */` at `:58-78`;
  - motion at `:608-630`: the headline is split into letters inside per-word wrappers, rises on load (`yPercent: 115`, `expo.out`, stagger `0.018`), and breaks apart line by line while the section is pinned (`end: '+=130%'`, scrub `0.7`).
  - Since the v3 publish, the letters sit inside `.wd` word spans, so words never break mid-word, and the third line's letters carry the silver gradient themselves.
- **The ownership line:**
  - markup at `:343-345` (the words "your own provider keys" are gold);
  - CSS under `/* Ownership line */` at `:79-83`;
  - the word split at `:553-571` and its scrub at `:631-633` (opacity 0.12 → 1, `top 78%` → `bottom 45%`).
- **From T-1728:** `apps/site-next/components/sections/hero.tsx` and `statement.tsx` exist as stubs, and `apps/site-next/lib/sections.ts` exports `SECTION` and `TRIGGER`. `components/smooth-scroll.tsx` registers ScrollTrigger and sets `html.anim`.
- **The still image:** the old site shows `/icon.webp` (400×400) when WebGL is missing (`apps/site/index.html:41-47`). T-1729's planet adds `webgl` or `no-webgl` to `<html>`.
- **GSAP:** `apps/site-next/lib/gsap.ts` registers ScrollTrigger when the module loads. Import `gsap` and `ScrollTrigger` from `@/lib/gsap`, never straight from `gsap`.
- **`html.anim`:** an inline head script in `apps/site-next/app/layout.tsx` sets it before first paint (T-1728). Without JavaScript it is absent.
- **The ids:** `TRIGGER.x` is a ScrollTrigger `id`; the element to target is `'#' + SECTION.x`.

### Steps
1. **`apps/site-next/components/sections/hero.tsx`** (`'use client'`):
   - the prototype's hero markup and copy, as written;
   - `<section id={SECTION.hero}>`;
   - in place of the prototype's SVG planet, an `<img src="/icon.webp" alt="" width={400} height={400}>` in the planet column, hidden under `html.webgl` (the real planet is behind the page).
2. **`hero.module.css`:** the prototype's hero CSS. Use `:global(html.anim)` and `:global(html.webgl)` for the class switches.
3. **`hero-motion.ts`:** the intro and breakup, with `useGSAP` from `@gsap/react`, scoped to the section.
   - The pinned ScrollTrigger gets `id: TRIGGER.hero` (the planet reads it).
   - **Reduced motion:** no intro, and `scrub: true`.
   - **The split** runs on the client after hydration, so the pre-rendered HTML keeps the plain headline text for search engines and no-JS visitors.
4. **`statement.tsx` and `statement.module.css`:** the ownership line, with `<section id={SECTION.statement}>`, the word split and the scrub.
5. **No tests** (UI). Each file stays under 400 lines.

### Allowed files
- `apps/site-next/components/sections/hero.tsx`
- `apps/site-next/components/sections/hero.module.css`
- `apps/site-next/components/sections/hero-motion.ts`
- `apps/site-next/components/sections/statement.tsx`
- `apps/site-next/components/sections/statement.module.css`
- `work/T-1730-site-next-hero.md`

### Checks
```bash
pnpm --filter @zilar/site-next build
pnpm gate
```

### Acceptance
- **The hero matches the prototype** at 1440×900 and 390×844: the copy, the keys, the letter intro and the pinned breakup.
- **The ownership line** lights word by word, with the gold words.
- **No JavaScript:** the headline and the paragraph are plain text in `out/index.html`.
- **The build and the gate pass.**

---

## Report (written by the worker when done)

### What I did

- **`hero.tsx`** — the prototype's hero section (`:317-341`): the three-line headline (`Your friends` / `and your AIs,` / `in one chat.`), the lede, the two keys, and the `hero-meta` row, all from the approved prototype copy. `'use client'`; the section is `id={SECTION.hero}` and grounds the motion. In place of the prototype's SVG planet, the planet column holds `<img src="/icon.webp" alt="" width={400} height={400}>`.
- **`hero.module.css`** — the prototype's hero CSS (`:58-78`) as a CSS module, with the still image hidden under `:global(html.webgl)`. The third line's silver gradient is applied per letter (`.ln.silver .ch`), matching the v3 publish where the letters carry the gradient themselves.
- **`hero-motion.ts`** — `useHeroMotion(scope)` with `useGSAP` from `@gsap/react`, scoped to the section:
  - the word/letter split (`.wd` per word, `.ch` per letter) runs in the effect, after hydration, so the pre-rendered HTML stays plain text;
  - the intro (`yPercent: 115`, `expo.out`, stagger `0.018`, delay `0.15`) plus the lede/keys/meta rise;
  - the pinned breakup timeline (`end: '+=130%'`, pin, scrub `0.7`, per-line `from: start/end/center`); its ScrollTrigger carries `id: TRIGGER.hero` for the planet;
  - reduced motion: no intro, `scrub: true`.
- **`statement.tsx`** + **`statement.module.css`** — the ownership line (`:343-345`, `:79-83`, `:553-571`, `:631-633`): `<section id={SECTION.statement}>`, one `.w` span per word split after hydration, `your own provider keys` marked with `data-gold` and its words given the gold class, and the scrub `opacity 0.12 → 1`, `top 78% → bottom 45%`.
- No files outside the Allowed files were touched. Every file is under 400 lines.

The still image is hidden only once the scene sets `html.webgl` (T-1729); with `no-webgl` or no JS it stays visible. The split keeps the pre-rendered headline/paragraph as plain text.

### Checks run

- `pnpm install` — done once at the start; the lockfile is unchanged.
- `pnpm --filter @zilar/site-next build` — **passed**: `✓ Compiled successfully`, static export of `/` (and `/_not-found`) written to `out/`.
- Verified the no-JS HTML in `apps/site-next/out/index.html`: the headline is plain text (`<span ...>Your friends</span><span ...>and your AIs,</span><span ...>in one chat.</span>`) and the lede is a plain text node; the ownership paragraph and `your own provider keys` are present; `/icon.webp` is in the markup; the emitted CSS contains `html.webgl .planetWrap img{visibility:hidden}`.
- `pnpm gate` (from the repo root) — **GATE PASS** after one fix. First run failed only on typecheck (see Notes); the final run:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.2s)
  PASS  lint  (0.7s)
  PASS  typecheck  (1.6s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/site-next (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: the change is UI and site-next has no tests (the gate reports `no nearby test files`).

### Notes for the lead

- The first `pnpm gate` failed on `typecheck`: the CSS module is typed with an index signature and `noUncheckedIndexedAccess` makes every `styles.x` lookup `string | undefined`, so passing `styles.ch`/`styles.w` to a `string` parameter errored. Fixed with a small `cssClass(name)` helper in `hero-motion.ts` and `statement.tsx` that throws on a missing class; the gate then passed. This is the only deviation from the spec, which did not mention the helper.
- The hero headline/paragraph are plain text in `out/index.html` but wrapped in the prototype's per-line `<span class="ln">` elements (needed for the line-by-line breakup and for the static three-line layout). If the lead wants literally no spans server-side, say so and I will move the line split into the effect too.
- I did not run a browser; the motion, pinning and the `html.webgl`/reduced-motion behaviours are verified from the code and the built output only.

### Fix round 1 (hero headline wrapped to six lines at 1440×900)

In `apps/site-next/components/sections/hero.module.css` only (plus this file), exactly as the lead asked:

- wide grid: `grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);`
- title size: `font-size: clamp(44px, 5.8vw, 88px);`
- `white-space: nowrap;` on `.title .ln` inside a new `@media (min-width: 861px)` block; the `@media (max-width: 860px)` phone rules are untouched.

Checks run:

- `pnpm --filter @zilar/site-next build` — **passed** (`✓ Compiled successfully`; static `/` export).
- Browser check on the built page (Chrome, the real Archivo webfont confirmed loaded, `document.fonts.check('20px Archivo') === true`), measuring each `#hero-title > span.ln` with a `Range` and `scrollWidth`:
  - **1440×900** — `font-size: 83.52px`; each line `lines: 1`, `white-space: nowrap`, `overflowX: 0`, copy column `669px`; `document.documentElement.scrollWidth === 1440` (no horizontal scroll).
  - **1024×768** — `font-size: 59.39px`; each line `lines: 1`, `nowrap`, `overflowX: 0`, copy column `510px`; no horizontal scroll.
  - **390-wide phone** (viewport clamped to 500 by the browser, still the `max-width: 860px` layout) — `white-space: normal`, each of the three lines still one line, `overflowX: 0`, no horizontal scroll: the phone layout is unchanged.
- `pnpm gate` — **GATE PASS**:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.4s)
  PASS  lint  (0.9s)
  PASS  typecheck  (2.0s)
  PASS  effect  (0.5s)
  SKIP tests @zilar/site-next (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

## Review (written by Claude)

- **Accepted at `e65854c25`.** The pre-review is clean (1 inert CSS nit) and the packet is current.
- **Fix round 1 (from the lead's screenshots):**
  - The problem: at 1440×900 the headline wrapped into six lines.
  - The fix: the wide grid is now 1.3fr/1fr, the title `clamp(44px, 5.8vw, 88px)`, and the lines don't wrap above 860 px.
  - Rechecked at 1440×900 and 1024×768: three lines, with the lede and the keys below. The phone layout is unchanged.
- **The ownership line** lights up word by word, with the gold words. Without JS, the plain text is in `out/index.html`.
- **For the tuning task:** the planet's "page top" station (`cx .34`) overlaps the headline at 1440 and the lede at 1024. It moves right or shrinks once every section is in.



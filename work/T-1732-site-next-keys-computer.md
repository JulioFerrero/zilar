---
id: T-1732
title: "New landing, step 5: the provider band (two outlined bands drifting against each other, skewing with scroll velocity) and the pinned self-typing AI computer terminal in apps/site-next, as in the approved prototype"
status: merged
milestone: M5
branch: task/T-1732-site-next-keys-computer
model: auto
effort: default
depends_on: [T-1728]
estimate: 40 min
---

# T-1732: Your keys, and AI computers

## Spec (written by Claude, do not edit)

### Why
These are two sections of the approved landing. Read `docs/design/mockups/landing/README.md`, then the prototype `docs/design/mockups/landing/prototype.html`.

### Facts (the lead read them on 2026-10-16)
- **The keys section:**
  - markup at `prototype.html:438-445`: two `.band` rows of provider names, where `.on` names are filled and the rest outlined, and the second band is gold, then "Your keys. Your limits." and its paragraph;
  - CSS under `/* Provider band */` at `:160-171`;
  - motion at `:688-696`: the bands move `xPercent` 0 → −35 and −35 → 0 across the section, and skew with Lenis velocity (`quickTo`, clamped to ±14°).
- **The computer section:**
  - markup at `:447-465`: the copy, four facts, and a terminal whose lines are `.ln` spans;
  - CSS under `/* Computer */` at `:172-191`;
  - motion at `:697-702`: the section is pinned (`end: '+=130%'`), and each line reveals with `clipPath` in `steps(26)`.
- **From T-1728:** `keys.tsx` and `computer.tsx` stubs exist. `apps/site-next/lib/sections.ts` exports `SECTION.keys`, `SECTION.computer` and `TRIGGER.computer` (`'computer-pin'`). `components/smooth-scroll.tsx` exposes `useLenis()`.
- **GSAP:** `apps/site-next/lib/gsap.ts` registers ScrollTrigger when the module loads. Import `gsap` and `ScrollTrigger` from `@/lib/gsap`, never straight from `gsap`.
- **`html.anim`:** an inline head script in `apps/site-next/app/layout.tsx` sets it before first paint (T-1728). Without JavaScript it is absent.
- **The ids:** `TRIGGER.x` is a ScrollTrigger `id`; the element to target is `'#' + SECTION.x`.

### Steps
1. **`apps/site-next/components/sections/keys.tsx` and `keys.module.css`:**
   - the section with `id={SECTION.keys}`, its markup and copy as written;
   - the drift with `useGSAP`, and the skew through `useLenis()`'s scroll event (skip the skew when Lenis is off).
2. **`computer.tsx` and `computer.module.css`:**
   - the section with `id={SECTION.computer}`, its markup and copy as written;
   - the pinned typing timeline with ScrollTrigger `id: TRIGGER.computer`.
   - **No JavaScript:** the full terminal text shows.
3. **Reduced motion:** no skew; `scrub: true`.
4. **No tests** (UI). Each file stays under 400 lines.

### Allowed files
- `apps/site-next/components/sections/keys.tsx`
- `apps/site-next/components/sections/keys.module.css`
- `apps/site-next/components/sections/computer.tsx`
- `apps/site-next/components/sections/computer.module.css`
- `work/T-1732-site-next-keys-computer.md`

### Checks
```bash
pnpm --filter @zilar/site-next build
pnpm gate
```

### Acceptance
- **Both sections match the prototype** at 1440×900 and 390×844.
- **The bands drift and lean with scroll speed.**
- **The terminal types itself while pinned**, ending with the refused `sudo` and the blinking cursor.
- **The build and the gate pass.**

---

## Report (written by the worker when done)

### What I did

Built the two sections in `apps/site-next`, matching the approved prototype
(`docs/design/mockups/landing/prototype.html`).

**`keys.tsx` + `keys.module.css` (new file):**
- Section `id={SECTION.keys}`, `aria-label="Your own keys"`, with the two
  `aria-hidden` provider bands and the `"Your keys. Your limits."` copy, byte for
  byte as in the prototype (`:438-445`), including the `.on` filled names and the
  reversed second band.
- CSS translated from `:160-171` (oversized Archivo, `wdth 125`, headline stroke,
  gold second band, two-column copy, single column under 860px).
- Drift with `useGSAP`: `xPercent` 0 → −35 on band 1 and −35 → 0 on band 2, both
  `scrub: true`, `trigger '#keys'`, `start 'top bottom'`, `end 'bottom top'`.
- Lean with `useLenis()`: `gsap.quickTo(..., 'skewX', {duration: 0.5, ease: 'power3'})`
  driven from the Lenis `scroll` event, clamped to ±14° from `-velocity * 0.35`.
  Nothing is wired when Lenis is off, so there is no skew without JS or under
  reduced motion.

**`computer.tsx` + `computer.module.css` (new file):**
- Section `id={SECTION.computer}`, `aria-label="AI computers"`, with the eyebrow,
  `"Its own computer."`, the paragraph, the four facts and the terminal, as in the
  prototype (`:447-465`).
- CSS translated from `:172-191`.
- Pinned typing timeline with `useGSAP`: lines start at
  `clipPath: inset(0 100% 0 0)` and each reveals to `inset(0 0% 0 0)` with
  `ease: 'steps(26)'`, `duration` 0.25 for the dim lines and 0.6 for the rest,
  chained on `'>'` (first at 0). The ScrollTrigger carries `id: TRIGGER.computer`
  (`'computer-pin'`), `trigger: section` (the section **element**, not a selector —
  see the fix round below), `start 'top top'`, `end '+=130%'`, `pin: true` and
  `scrub: reduce ? true : 0.7`.
- No JavaScript: the reveal is applied only by the timeline, so the raw output ships
  the full terminal text (verified in `out/index.html`).

Reduced motion: no skew on the bands, and the terminal scrub jumps (`scrub: true`).
No tests (UI). Both sections are client components; they use `gsap` and
`ScrollTrigger` from `@/lib/gsap` as required.

### Fix round 1: the computer section did not pin

The lead's headless check found no pin. I reproduced it against the built `out/`
served on `127.0.0.1:5299` with headless Chromium (1440×900) and captured the
browser console: `warning: Invalid scope` and `warning: Element not found: #computer`.

**Cause.** `useGSAP` resolves selector strings **inside its `scope`**. The
component passed `{ scope: root }` but never attached `root` to an element, so the
scope was invalid; `trigger: '#computer'` was then resolved inside that invalid
scope and not found. ScrollTrigger falls back to the **scroller** as the trigger,
which is why the timeline scrubbed against the whole page (no pin, no spacer) and
sat near its end at the section's top. This is the same pattern the working pins on
`main` avoid: `hero-motion.ts` and `story-timeline.ts` both attach the section ref
and pass the element as `trigger`.

**Fix (`computer.tsx`, one commit).** Attach `ref={root}` to the section and pass
`trigger: section` (the element) instead of the selector; the lines are read with
`pre.querySelectorAll`. No CSS blocked pinning, so `computer.module.css` is
unchanged.

**Measured before → after** (same script, `pnpm --filter @zilar/site-next build`
then `out/` on `127.0.0.1:5299`, headless Chromium):

| 1440×900 | before | after |
| --- | --- | --- |
| `.pin-spacer` ids | `[]` | `["computer"]` |
| max scroll (`scrollHeight - innerHeight`) | 1049 | 2219 |
| pin length (spacer height − section height) | — | 1170 (= 130% of 900) |
| terminal lines at the section top (scroll 898) | 6/8 already revealed | all 8 at `inset(0px 100% 0px 0px)` (start) |

Typing while pinned, revealed-per-line at scroll offsets from the section top
(898): start → `[0,0,0,0,0,0,0,0]`, +585 → `[100,100,100,100,0,0,0,0]`,
+1070 → `[…,50]`, +1180 → all `100`. The cursor line is the last to reveal.

390×844 (same script): `.pin-spacer` ids `["computer"]`, pin length 1096.58
(= 130% of 844). So the pin is 130% of the viewport at both sizes and the page
grows by exactly that.

After the fix the only remaining console warnings are
`Invalid scope` and `Element not found: #keys` — see the keys note below.

### Fix round 2: the keys bands drifted over the whole page (PREREVIEW finding 1)

Pre-review finding 1 (must-fix): `keys.tsx` had the same bug as `computer.tsx`
before round 1 — `useGSAP(..., { scope: root })` with `root` never attached, so
`trigger: `#${SECTION.keys}`` was resolved inside an invalid scope and the drift
ScrollTriggers fell back to the scroller (the bands drifted over the whole page
instead of across their own section, and the browser logged `Invalid scope` /
`Element not found: #keys`).

**Fix (`keys.tsx`, one commit `af1177b4e`).** Attach `ref={root}` to the
`<section>` and pass `trigger: section` (the element read from `root.current`)
instead of the selector, exactly as in `computer.tsx`. Both `useGSAP` calls keep
`{ scope: root }`; the second one (the Lenis skew) targets the band refs directly
and was already sound. No CSS change.

**Tests added:** none. The spec says "No tests (UI)" and `AGENTS.md` says UI code
gets no tests, so there is no behaviour test to add here.

**Gate (from the repo root):**
```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (1.5s)
PASS  lint  (0.9s)
PASS  typecheck  (2.1s)
PASS  effect  (0.4s)
SKIP tests @zilar/site-next (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
Per the lead's instruction I did not run a browser check; the lead verifies the
pins in a browser after the commit.

### Checks run

- `pnpm install` — done, workspace linked.
- `pnpm --filter @zilar/site-next build` — passed: `✓ Compiled successfully`,
  `✓ Generating static pages (3/3)`, routes `/` and `/_not-found` static.
- Fix round 1: `pnpm --filter @zilar/site-next build` again after the fix — passed,
  same output. Browser measurements in "Fix round 1" above were taken from it.
- Fix round 1: `pnpm gate` — `GATE PASS`, same steps as the round-1 summary below
  (`5 changed file(s)`, `scope: every changed file is inside the Allowed files`).
- `pnpm gate` (from the repo root) — the full summary:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (2.1s)
  PASS  format  (0.6s)
  PASS  lint  (1.3s)
  PASS  typecheck  (2.7s)
  PASS  effect  (0.9s)
  SKIP tests @zilar/site-next (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: the spec says no tests, and the package has none
  near the change.
- I also checked the static export by hand: `out/index.html` contains the full
  terminal text (`sudo: not allowed in this sandbox`, the last prompt and the
  cursor) and the exact band markup (`OpenAI`, `Anthropic`, … with the `on` names).

### Notes for the lead

- The two sections previously used bare global class names (`keys`, `computer`,
  `wrap`, `display`); the new markup keeps the global helpers (`wrap`, `display`,
  `eyebrow`) and moves the section-specific rules into the two CSS modules named in
  the spec. Nothing else in the app was touched.
- I did run a headless browser check for this fix round (headless Chromium against
  the built `out/` served locally); the measurements above are from it. The two
  files add no dependency beyond what the scaffold already provides.
- The keys skew is skipped when `prefers-reduced-motion: reduce` matches, which is
  also when `SmoothScroll` never creates Lenis, so both guards agree.
- **Keys scope bug (fixed in fix round 2):** `keys.tsx` had the *same* bug —
  `useGSAP(..., { scope: root })` with `root` never attached, so
  `trigger: '#keys'` is resolved in an invalid scope. The browser logs
  `warning: Invalid scope` and `warning: Element not found: #keys`, and the drift
  ScrollTriggers fall back to the **scroller**: at 1440×900 the two bands read
  xPercent `[-11, -24]` at scroll 0 and `[-22.1, -12.9]` at the keys section's
  bottom, where the intended values are `[0, -35]` and `[-35, 0]`. So the bands
  still move and lean with speed (the lean targets the refs directly, so it works),
  but they drift over the whole page instead of across their own section. The fix
  is the same two-line change I made in `computer.tsx`. I did **not** touch
  `keys.tsx` because this round's Allowed files are `computer.tsx`,
  `computer.module.css` and this task file; the gate would flag it as out of scope.
  Say the word and I will fix it in a follow-up round with the same before/after
  measurement.
  **Update (fix round 2):** this is now fixed in `keys.tsx` (commit `af1177b4e`),
  the same two-line change; see "Fix round 2" above.

## Review (written by Claude)

- **Accepted at `d31330557`.** It's clean after the lead's two rounds and one automatic round. The packet is current.
- **The bug the rounds fixed:**
  - the `root` refs in `computer.tsx` and `keys.tsx` were never attached;
  - so the computer pin never made a `.pin-spacer`, and the terminal showed fully typed at the section top;
  - and the bands drifted against the whole page.
- **The lead's headless check after the fix** (1440×900):
  - `.pin-spacer` wraps `#computer`, and the max scroll grew from 1049 to 2219 px;
  - at the section top the lines are clipped (`inset(0 100% 0 0)`), and they type in as you scroll;
  - the section stays pinned (`top: 0`) from +300 to +900 px;
  - the bands carry a drift transform scoped to `#keys`.


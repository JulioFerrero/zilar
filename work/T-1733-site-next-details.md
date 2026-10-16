---
id: T-1733
title: "New landing, step 6: the pinned sideways Details strip with eight glass cards, each with its live CSS micro-demo (topics, voice transcript, typo search, sticker, daily limit, kill switch, audit log, updater), in apps/site-next, as in the approved prototype"
status: merged
milestone: M5
branch: task/T-1733-site-next-details
model: auto
effort: default
depends_on: [T-1728]
estimate: 45 min
---

# T-1733: Details strip

## Spec (written by Claude, do not edit)

### Why
This is the "The rest is already there." section of the approved landing. Read `docs/design/mockups/landing/README.md`, then the prototype `docs/design/mockups/landing/prototype.html`.

### Facts (the lead read them on 2026-10-16)
- **Markup:** `prototype.html:467-505`, a `.strip-pin` with its heading and a `.track` of eight `.feat` cards. Each card has a `.demo` well, an `h3` and a `p`; the copy is final.
- **CSS:**
  - the cards at `:192-205`;
  - the eight demos at `:206-262`: topics with a pulsing AI orb, voice bars with typed text, the search query with a highlighted hit, the wobbling sticker, the filling meter with "stopped", the kill-switch knob, audit-log lines, and the updater with the Install key;
  - the reduced-motion block at `:291-294`, which shows each demo's end state.
- **Motion:** `:703-707`. With `html.anim`, the strip is pinned and the track slides on `x` by `scrollWidth - innerWidth`, with `end` at `max(that distance, 0.6 viewport)` and `invalidateOnRefresh`.
- **From T-1728:** a `details.tsx` stub exists. `apps/site-next/lib/sections.ts` exports `SECTION.details` (`'strip-pin'`) and `TRIGGER.details` (`'details-pin'`).
- **GSAP:** `apps/site-next/lib/gsap.ts` registers ScrollTrigger when the module loads. Import `gsap` and `ScrollTrigger` from `@/lib/gsap`, never straight from `gsap`.
- **`html.anim`:** an inline head script in `apps/site-next/app/layout.tsx` sets it before first paint (T-1728). Without JavaScript it is absent.
- **The ids:** `TRIGGER.x` is a ScrollTrigger `id`; the element to target is `'#' + SECTION.x`.

### Steps
1. **`apps/site-next/components/sections/details.tsx`:** the pinned strip and the track, with `id={SECTION.details}` on the pinned element and ScrollTrigger `id: TRIGGER.details`.
2. **`details-demos.tsx`:** the eight demo wells as small components, with the markup as written.
3. **`details.module.css`:** the cards and demos CSS, with the keyframes and the reduced-motion end states.
4. **No JavaScript:** the cards wrap in a grid, as the prototype does without `html.anim`.
5. **No tests** (UI). Each file stays under 400 lines.

### Allowed files
- `apps/site-next/components/sections/details.tsx`
- `apps/site-next/components/sections/details-demos.tsx`
- `apps/site-next/components/sections/details.module.css`
- `work/T-1733-site-next-details.md`

### Checks
```bash
pnpm --filter @zilar/site-next build
pnpm gate
```

### Acceptance
- **Eight cards slide sideways while pinned**, each demo looping as in the prototype, at 1440×900 and 390×844.
- **With reduced motion,** the demos show their end states.
- **The build and the gate pass.**

---

## Report (written by the worker when done)

### What I did

Step 6 of the new landing: the pinned sideways **Details** strip in `apps/site-next`,
ported from `docs/design/mockups/landing/prototype.html` — markup `:467-505`, CSS
`:192-294`, motion `:703-707`.

- **`apps/site-next/components/sections/details.tsx`** (113 lines). `Details` is now a
  client component. It renders the `.strip` section with a `.pin` element that carries
  `id={SECTION.details}` (`strip-pin`) and the eyebrow + heading, then a `.track` with the
  eight `.feat` cards (markup and copy verbatim). One `ScrollTrigger` with
  `id: TRIGGER.details` (`details-pin`) pins `.pin` and slides `.track` on `x` by
  `scrollWidth - innerWidth`, with `end` at `max(that distance, 0.6 × viewport)` and
  `invalidateOnRefresh: true`. `scrub` is `true` under reduced motion and `0.7` otherwise
  (the prototype's `scrub = reduce ? true : 0.7`). `gsap` is imported from `@/lib/gsap`.
- **`apps/site-next/components/sections/details-demos.tsx`** (188 lines). The eight demo
  wells as small components: `TopicsDemo`, `VoiceDemo`, `SearchDemo`, `StickerDemo`,
  `LimitDemo`, `KillSwitchDemo`, `AuditDemo`, `UpdaterDemo`, each rendering its
  `<div className={styles.demo}>` well with the prototype's markup (the pulsing AI orb, the
  twelve voice bars with their per-bar delays, the search query and the highlighted hit,
  the wobbling sticker, the filling meter with "stopped", the kill-switch knob and label,
  the three audit-log lines, the updater tile + meter + Install key).
- **`apps/site-next/components/sections/details.module.css`** (518 lines). The cards
  (`.strip/.pin/.head/.track/.feat/.demo`), the eight demos, all thirteen keyframes and the
  reduced-motion block. The cards wrap in the prototype's grid
  (`repeat(auto-fill, minmax(270px, 1fr))`); the pinned flex layout and the sideways track
  only apply under `html.anim`, so with no JavaScript the section is the static grid, as the
  prototype does.

Every `styles.*` class referenced in the two components exists in the module (checked by
diffing the used names against the defined names: both sets are identical). No tests, per
the spec (UI).

### Checks run

```bash
pnpm install                                  # Done in 20.1s using pnpm v10.32.1
pnpm --filter @zilar/site-next build           # ✓ Compiled successfully; 3/3 static pages, 0 errors
pnpm gate                                       # GATE PASS
```

`pnpm gate` summary (from the repo root):

```
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (1.2s)
PASS  lint  (0.8s)
PASS  typecheck  (2.1s)
PASS  effect  (0.6s)
SKIP tests @zilar/site-next (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

The 4 changed files are the three source files plus `work/T-1733-site-next-details.md`
(added by the spec commit). I ran no separate single-file tests: the change is UI, the spec
says no tests, and the gate skips the site-next test step. I added no dependencies.

### Notes for the lead

- **`details.module.css` is 518 lines, over the spec's 400-line cap — needs a decision.**
  This is not removable formatting. The prototype's Details CSS (`prototype.html:192-294`)
  is the most animation-heavy part of the page: eight demo wells plus **thirteen**
  keyframes. Prettier always expands every selector list and every comma-separated value to
  one item per line (I verified with probes: it turns `a, b {` into two lines and
  `box-shadow: x, y;` into three, and every `@keyframes` step takes 3-4 lines), so the
  prettier-minimal file is ~579 lines. After removing **every blank line** — the same move
  T-1731 accepted to get `story.module.css` from 457 to 397 — it is 518. The other two
  files are 113 and 188 lines. I could not get under 400 without either changing the
  approved motion/timing (dropping or merging keyframes) or adding a second CSS module,
  which is outside this task's Allowed files. Options: **(a)** add e.g.
  `details-demos.module.css` to the Allowed files and I split the demo CSS out, **(b)**
  raise the cap for this one file, or **(c)** I drop/merge some demo animations. Tell me
  which and it is one quick change.
- **Reduced motion** (`details.module.css`, last block) mirrors `prototype.html:291-294`:
  no CSS animation, the typed line and the search query at full width, the hit, "stopped",
  the audit lines and the Install key at opacity 1, the kill switch showing "running" and
  the meter at full. The scrub is `true`, so the strip still moves with the scroll.
- **Small markup addition, for review:** I gave the AI orb `role="img"` and the private
  lock `role="img"` so their `aria-label`s are exposed; the prototype has the bare
  `aria-label`. The lock's `margin-left: 6px` stays an inline style, as in the prototype.
- **Security checklist:** the change is static presentation only — no secrets, no routes, no
  writes, no queries, no user data — so none of the checklist items apply.

## Review (written by Claude)

- **Accepted at `2c718bc5d`.** The pre-review is clean (0 nits, 1 follow-up) and the packet is current.
- **Smoke test by the lead:** built, served, and took headless screenshots of the pinned strip at 5/50/95% (1440×900 and 390×844).
  - The pin works (`.pin-spacer` around `#strip-pin`), and the eight cards slide sideways.
  - Each demo loops: the AI orb on the topic, the voice transcript, the typo search hit, the sticker, the limit "stopped", the kill switch, the audit log refusal and the updater Install.
  - On the phone, the cards are 80vw wide and nothing overlaps.
- **Waiver:** `details.module.css` has 518 lines. Julio's 400-line rule and the gate's size check are about code files (`.ts`, `.tsx`, `.mjs`, `.js`). This CSS is eight demos and their keyframes, ported one-for-one from the prototype, so it stays as one file.

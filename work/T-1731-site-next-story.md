---
id: T-1731
title: "New landing, step 4: the pinned phone story (four chapters, 3D phone tilt, Friends chat, Deepseek work card, approval card, routine edits with gold flashes) in apps/site-next, as in the approved prototype"
status: merged
milestone: M5
branch: task/T-1731-site-next-story
model: auto
effort: default
depends_on: [T-1728]
estimate: 50 min
---

# T-1731: The phone story

## Spec (written by Claude, do not edit)

### Why
This is the centrepiece of the approved landing. Read `docs/design/mockups/landing/README.md`, then the prototype `docs/design/mockups/landing/prototype.html`.

### Facts (the lead read them on 2026-10-16)
- **Markup:** `prototype.html:347-436`. Four `.chapter` articles (Chat, AIs, Approvals, Routines), each with a 4-bar `.steps` row, and a `.phone` with four `.panel` screens:
  - the Friends chat with the voice note, whose bars are built at `:549-552`;
  - "ai test › General" with the Deepseek "Check the prices" work card and the first prices table;
  - the "Deepseek asks · Prices · every 5 min" approval card, where Allow becomes a check line;
  - the routine message with its header, the table and "edited 09:00".
- **CSS:** `/* Stage: chapter text + phone */` at `:84-144` and the JS-only layout at `:145-159` (`html.anim …`, with a phone layout at `max-width: 860px`).
- **Motion:** `:634-687`, one timeline pinned on the section (`end: '+=440%'`, scrub `0.7`):
  - each chapter and panel fades and slides in, and the phone rotates (`rotateY`/`rotateX`) between chapters;
  - the bubbles stagger in, the work-card steps tick in, the Allow key presses and the card collapses into the check line;
  - `onUpdate` fills the progress bars and swaps the routine values through the three runs (`$82,302`… `edited 09:00`, `09:05`, `09:10`), flashing changed values gold for 420 ms.
- **From T-1728:** a `story.tsx` stub exists, and `apps/site-next/lib/sections.ts` exports `SECTION.story` (`'chat'`) and `TRIGGER.story` (`'story-pin'`).
- **GSAP:** `apps/site-next/lib/gsap.ts` registers ScrollTrigger when the module loads. Import `gsap` and `ScrollTrigger` from `@/lib/gsap`, never straight from `gsap`.
- **`html.anim`:** an inline head script in `apps/site-next/app/layout.tsx` sets it before first paint (T-1728). Without JavaScript it is absent.
- **The ids:** `TRIGGER.x` is a ScrollTrigger `id`; the element to target is `'#' + SECTION.x`.

### Steps
1. **`apps/site-next/components/sections/story.tsx`:** the section and the chapters, with `<section id={SECTION.story}>`.
2. **`story-phone.tsx`:** the phone and its four panels, with the markup and copy as written. Keep the inline SVG icons; the voice-note bars come from a fixed height array.
3. **`story.module.css`:** the prototype's CSS for this section, with `:global(html.anim)` for the switch.
4. **`story-timeline.ts`:** the timeline, with `useGSAP` scoped to the section.
   - The ScrollTrigger gets `id: TRIGGER.story`.
   - **Reduced motion:** `scrub: true`, no 3D tilt.
   - The routine values change through refs, not React state, to avoid re-renders on scroll.
5. **No JavaScript:** every chapter and panel shows in normal flow, as the prototype does without `html.anim`.
6. **No tests** (UI). Each file stays under 400 lines; split the panels into more files if needed.

### Allowed files
- `apps/site-next/components/sections/story.tsx`
- `apps/site-next/components/sections/story-phone.tsx`
- `apps/site-next/components/sections/story-panels.tsx`
- `apps/site-next/components/sections/story.module.css`
- `apps/site-next/components/sections/story-timeline.ts`
- `work/T-1731-site-next-story.md`

### Checks
```bash
pnpm --filter @zilar/site-next build
pnpm gate
```

### Acceptance
- **The pinned story matches the prototype** at 1440×900 and 390×844: four chapters, the progress bars, the phone tilt, the bubbles, the work card, the approval flip and three routine edits with gold flashes.
- **No JavaScript:** everything is visible in normal flow.
- **The build and the gate pass.**

---

## Report (written by the worker when done)

### What I did

Built the pinned phone story in `apps/site-next/components/sections/`, porting the
prototype (`docs/design/mockups/landing/prototype.html:347-436`, CSS `:84-158`,
motion `:634-687`) as React + CSS modules:

- `story.tsx`: the `<section id={SECTION.story}>` with the four chapters (eyebrow,
  `.display` heading, body, 4-bar `.steps` row), the `useRef` scope and
  `useStoryTimeline`.
- `story-phone.tsx`: the `.phone-3d` / `.phone` / `.screen` frame wrapping the four
  panels.
- `story-panels.tsx`: the four panels — Friends chat (voice note built from the fixed
  height array, `prototype.html:551`), the "ai test › General" Deepseek work card with
  the first prices table, the approval card, and the routine message — with the
  prototype's copy and inline SVG icons.
- `story.module.css`: the prototype's stage CSS as a module, `:global(html.anim)` for
  the JS-only layout at both breakpoints.
- `story-timeline.ts`: the `useGSAP` timeline scoped to the section, `id:
  TRIGGER.story`, `end: '+=440%'`, `pin: true`, `scrub: 0.7` (`true` under reduced
  motion, and no 3D tilt), `onUpdate` fills the 16 bars and swaps the three routine
  runs through element references (no React state).

The JS hooks are `data-*` attributes (`data-chapter`, `data-panel`, `data-phone`,
`data-bubble`, `data-step`, `data-bar`, `data-ask`, `data-allow`, `data-allowed`,
`data-tick`, `data-edited`), so the timeline never depends on hashed module class
names. Without JavaScript nothing is hidden and every chapter and panel renders in
normal flow, because all of the pinned layout lives under `html.anim`.

### Checks run

- `pnpm install` — done (clean).
- `pnpm --filter @zilar/site-next typecheck` — 0 errors.
- `pnpm --filter @zilar/site-next build` — passed; `out/index.html` contains 4
  chapters, 4 panels, 16 `data-bar`, 3 `data-tick` and 1 `data-edited`.
- `pnpm gate`:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.1s)
PASS  lint  (1.0s)
PASS  typecheck  (2.0s)
PASS  effect  (0.7s)
SKIP tests @zilar/site-next (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No unit tests (UI, per the spec); the gate skipped the site-next test step.

### Round 2 (fix round)

Findings from `PREREVIEW.md`:

- **Finding 1 (should-fix) — `story.module.css` was 457 lines, over the spec's 400-line
  cap — fixed.** The original put a blank line between every rule; the repo's own
  CSS (`apps/site-next/app/globals.css`: 227 lines, 4 blank lines) is compact, so
  the module was also off the house style. Removed the 60 blank lines the module
  added: the file is now 397 lines, and every declaration is byte-identical to
  before — verified with `diff` of both versions with blank lines stripped
  (`IDENTICAL (modulo blank lines)`) — and the result is Prettier-clean. No
  declaration, selector or comment changed.
- **Finding 2 (follow-up) — `html.anim` is set unconditionally in
  `apps/site-next/app/layout.tsx`.** Not fixed: that file is pre-existing (T-1728)
  and outside this task's Allowed files, and the review itself records it as a
  follow-up "not counted against this task". It stays for a later task that owns
  `layout.tsx`.

Tests added or adjusted: none. Finding 1 is a formatting-only change, not a
behaviour fix, and the spec says "No tests (UI)"; the finding names no test.

Checks run this round:

```bash
pnpm --filter @zilar/site-next build            # passed (3/3 static pages, 0 errors)
pnpm gate                                        # GATE PASS
```

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.5s)
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

`wc -l apps/site-next/components/sections/story.module.css` = 397.

### Notes for the lead

- **One small deviation, for review:** in `story.module.css` two extra rules under
  `html.anim` hide `.chapter:not(:first-child)`, `.panel:not(:first-child)`,
  `[data-bubble]` and `[data-step]` until GSAP sets their state. The static HTML is
  painted before hydration, and the pin CSS makes the four chapters and four panels
  overlap; without this, that first frame flashes the overlapping content. It is under
  the same `html.anim` gate, so JavaScript-off behaviour is unchanged. Say the word if
  you want it removed to match the prototype's CSS literally.
- The routine flash clears with `gsap.delayedCall(0.42, …)` instead of the prototype's
  `setTimeout` (same 420 ms), which keeps `story-timeline.ts` a plain, non-effect
  source for the Effect ratchet.
- Reduced motion keeps the scrubbed story but skips the phone tilt, as the spec asks.

## Review (written by Claude)

- **Accepted at `e67304187`.** It's clean after one automatic round: the CSS was squeezed under 400 lines. The packet is current.
- **Smoke test by the lead:** built, served, and took headless screenshots of the pinned range at 10/35/60/75/97% (1440×900 and 390×844).
  - The four chapters, the progress bars, the Friends chat and the Deepseek request all match the prototype.
  - Allow turns into the check line, and the routine bubble ends at "edited 09:10" with the new values.
  - On the phone, the text sits above the phone and nothing overflows.
- **Follow-up (outside this task):** the inline `anim` script in `layout.tsx` can hide pinned content if the JS bundle fails after it ran. This goes to the final tuning task.

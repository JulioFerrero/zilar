---
id: T-1734
title: "New landing, step 7: Install (one-line command with Copy, requirements, Android download card) and the finale (huge silver zilar wordmark) in apps/site-next, as in the approved prototype"
status: merged
milestone: M5
branch: task/T-1734-site-next-install-finale
model: auto
effort: default
depends_on: [T-1728]
estimate: 30 min
---

# T-1734: Install and finale

## Spec (written by Claude, do not edit)

### Why
These are the last two sections of the approved landing. Read `docs/design/mockups/landing/README.md`, then the prototype `docs/design/mockups/landing/prototype.html`.

### Facts (the lead read them on 2026-10-16)
- **Install:**
  - markup at `prototype.html:507-527`: "One line. Your server.", `curl -fsSL https://get.zilar.app | sh` with a Copy key, three requirements, and the Android card linking `https://github.com/JulioFerrero/zilar/releases/latest`;
  - CSS under `/* Install */` at `:263-279`.
- **The Copy key:** `:572-579`. `navigator.clipboard.writeText`; on failure it selects the text. The label shows "Copied" or "Select it" for 1.6 s.
- **Finale:**
  - markup at `:529-533`: a silver "zilar" wordmark, "Basque for silver." and two keys;
  - CSS under `/* Finale */` at `:280-284`.
- **Motion:** `:708-711`. The install columns rise in (`y: 40`, stagger `0.12`, at `top 75%`) and the wordmark rises (`yPercent: 40`, `expo.out`, at `top 60%`).
- **From T-1728:** `install.tsx` and `finale.tsx` stubs exist, and `apps/site-next/lib/sections.ts` exports `SECTION.install` and `SECTION.finale`.
- **GSAP:** `apps/site-next/lib/gsap.ts` registers ScrollTrigger when the module loads. Import `gsap` and `ScrollTrigger` from `@/lib/gsap`, never straight from `gsap`.

### Steps
1. **`apps/site-next/components/sections/install.tsx` and `install.module.css`:** the section with `id={SECTION.install}`, its markup and copy as written. The Copy key is a client component in `copy-command.tsx`.
2. **`finale.tsx` and `finale.module.css`:** the section with `id={SECTION.finale}`.
3. **The rise-ins** with `useGSAP`; skip them with reduced motion.
4. **No tests** (UI). Each file stays under 400 lines.

### Allowed files
- `apps/site-next/components/sections/install.tsx`
- `apps/site-next/components/sections/install.module.css`
- `apps/site-next/components/sections/copy-command.tsx`
- `apps/site-next/components/sections/finale.tsx`
- `apps/site-next/components/sections/finale.module.css`
- `work/T-1734-site-next-install-finale.md`

### Checks
```bash
pnpm --filter @zilar/site-next build
pnpm gate
```

### Acceptance
- **Both sections match the prototype** at 1440×900 and 390×844.
- **Copy** puts the exact command on the clipboard, or selects it.
- **The build and the gate pass.**

---

## Report (written by the worker when done)

### What I did

Implemented the last two landing sections in `apps/site-next`, matching the approved prototype
(`docs/design/mockups/landing/prototype.html:507-533`, CSS `:263-284`, motion `:708-711`).

- **Install** (`install.tsx` + `install.module.css`): `id={SECTION.install}`, the eyebrow
  "Run your own", the `display` headline "One line. / Your server.", the intro paragraph, the
  Copy command well, the three requirements (A server / A domain / Email) and the Android card
  linking `https://github.com/JulioFerrero/zilar/releases/latest`.
- **Copy key** (`copy-command.tsx`): a client component that writes
  `curl -fsSL https://get.zilar.app | sh` with `navigator.clipboard.writeText`. On any failure it
  selects the command text with a `Range`. The button label reads "Copied" or "Select it" for
  1.6 s, then goes back to "Copy" (timer cleared on unmount).
- **Finale** (`finale.tsx` + `finale.module.css`): `id={SECTION.finale}`, the silver `zilar`
  wordmark ("Basque for silver.") and the two keys ("Run your own" → `#install`, "Source on
  GitHub").
- **Motion:** the two install columns rise in (`y: 40`, `stagger: 0.12`, at `top 75%`) and the
  wordmark rises (`yPercent: 40`, `expo.out`, at `top 60%`), both with `useGSAP` and imported from
  `@/lib/gsap`. Both are skipped under `prefers-reduced-motion: reduce`.
- No tests (UI); every file is well under 400 lines.

Files changed (all inside the Allowed files):
`apps/site-next/components/sections/install.tsx`,
`apps/site-next/components/sections/install.module.css`,
`apps/site-next/components/sections/copy-command.tsx`,
`apps/site-next/components/sections/finale.tsx`,
`apps/site-next/components/sections/finale.module.css`.

### Checks run

`pnpm --filter @zilar/site-next build` — succeeded:
```
✓ Compiled successfully in 3.2s
✓ Generating static pages using 4 workers (3/3)
Route (app)  ○ /  ○ /_not-found
```
I also grepped the exported `out/index.html` and it contains the command, "Basque for silver.",
"Signed builds on GitHub" and "Source on GitHub".

`pnpm gate` — GATE PASS:
```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (1.2s)
PASS  lint  (0.7s)
PASS  typecheck  (1.6s)
PASS  effect  (0.4s)
SKIP tests @zilar/site-next (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
Single tests: none — this is UI, and the gate reports no nearby test files for `@zilar/site-next`.

### Notes for the lead

- **Effect ratchet:** `copy-command.tsx` trips H1/H3/W4 (async/await, `setTimeout`, `try/catch`),
  so I added the standard `// effect-plain: the landing's copy button; the clipboard write and its
  short label timer are DOM-only, with no I/O, ports or app logic.` marker, the same escape hatch
  `smooth-scroll.tsx` uses. If you'd rather this file go through Effect, say so and I'll rework it.
- **Visual acceptance not machine-verified:** I did not open a browser (a local server would be a
  background process, which AGENTS.md forbids). I matched the prototype's markup, copy and CSS
  one-for-one and confirmed the static export contains the copy; the 1440×900 / 390×844 check is
  yours/Julio's smoke. The `.cta` rule in `finale.module.css` adds `justify-content: center` over
  the shared `display: flex; gap: 12px; flex-wrap: wrap` from the prototype (`:67`).
- Deviation from spec: none.

## Review (written by Claude)

- **Accepted at `f1025781c`.** The pre-review is clean and the packet is current.
- **Smoke test by the lead:** built, served, and took headless screenshots of `#install` and `#finale` at 1440×900 and 390×844, with no page errors.
  - Desktop: "One line. Your server.", the curl line with Copy, the three requirements, the Android card, and the silver "zilar" with "Basque for silver." and two keys, as in the prototype.
  - Phone: the curl line scrolls inside its box, as in the prototype.


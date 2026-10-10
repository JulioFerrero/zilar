---
id: T-1037
title: "Size split T119: apps/site/src/instruments.ts (405 lines) into instruments/{dom,approval,routine,provider,pairing,sheen}.ts, the old path keeps initInstruments"
status: merged
milestone: M5
branch: task/T-1037-split-site-instruments
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1037: Split the site's `instruments.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/site/src/instruments.ts` is 405 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #115 (task T119). The new files go in a new `apps/site/src/instruments/` folder:
- `dom.ts`;
- `approval.ts`;
- `routine.ts`;
- `provider.ts`;
- `pairing.ts`;
- `sheen.ts`.

`apps/site/src/instruments.ts` stays at its path, because `apps/site/src/main.ts:6` imports `initInstruments` from it. It keeps `initInstruments` and every export it has today.

The in-file Dedup is in scope: `required`, `reducedMotion` and `clockTime` live once in `dom.ts`, and the feature modules import them.

The lead checks the site's demo instruments in a headless browser against main.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #115, and `apps/site/src/instruments.ts`.

### Allowed files
`apps/site/src/instruments.ts`, `apps/site/src/instruments/dom.ts`, `apps/site/src/instruments/approval.ts`, `apps/site/src/instruments/routine.ts`, `apps/site/src/instruments/provider.ts`, `apps/site/src/instruments/pairing.ts`, `apps/site/src/instruments/sheen.ts`, `work/T-1037-split-site-instruments.md`.

### Checks
```bash
pnpm --filter @zilar/site build
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/site/src/instruments.ts` (405 lines at `main`) into the six modules the plan names under `apps/site/src/instruments/`. `apps/site/src/instruments.ts` stays at its path as the entry barrel: it keeps the file-level comment and defines `initInstruments`, which now calls the five feature `init*` functions in the same order as before (approval, routine, provider, pairing, sheen). `apps/site/src/main.ts:6` imports `initInstruments` unchanged. Code was moved unchanged; only `export` was added to the moved functions and the relative import paths were rewritten for the new folder. No file outside the Allowed files was edited.

### Files and line counts (split-rules item 8)

Old file at `main` (`git show HEAD:apps/site/src/instruments.ts | wc -l`): **405**.

| file | lines |
| --- | --- |
| `apps/site/src/instruments.ts` (entry barrel; was 405) | 16 |
| `apps/site/src/instruments/dom.ts` | 12 |
| `apps/site/src/instruments/approval.ts` | 78 |
| `apps/site/src/instruments/routine.ts` | 148 |
| `apps/site/src/instruments/provider.ts` | 74 |
| `apps/site/src/instruments/pairing.ts` | 70 |
| `apps/site/src/instruments/sheen.ts` | 11 |

Every new file and the barrel are well under 400 lines, so no `max-lines` warning can appear. The largest module is `routine.ts` (148), which holds `initFlaps`, `initRoutine` and `initVersions`.

### Dedup (plan item)

`required`, `reducedMotion` and `clockTime` now live once in `instruments/dom.ts` and are imported by the feature modules that use them: `approval.ts` imports all three, `routine.ts` imports `reducedMotion` + `required`, `provider.ts` imports `required`, and `pairing.ts` imports `reducedMotion` + `required`. **`sheen.ts` imports none of them**: the plan wording says "imported by the five feature modules", but `initSheen` uses neither `required`, `reducedMotion` nor `clockTime` (it reads its own `(hover: hover) and (pointer: fine)` media query), so importing them would only add unused imports. That is the only deviation from the plan text; the dedup itself is exactly as specified (one definition each, in `dom.ts`).

### Export diff (before → after)

`grep -E "^export"` on the old file against the barrel plus the new files:

- **Before** (`git show HEAD:apps/site/src/instruments.ts`): `export function initInstruments` — 1 name.
- **After:** the barrel `apps/site/src/instruments.ts` defines `export function initInstruments` — **same 1 name, same kind. MISSING: none, EXTRA: none.** The public surface is unchanged.
- The new files additionally export internal names the barrel does not re-export: `dom.ts` (`required`, `reducedMotion`, `clockTime`), `approval.ts` (`initApproval`), `routine.ts` (`initRoutine`), `provider.ts` (`initProvider`), `pairing.ts` (`initPairing`), `sheen.ts` (`initSheen`). These were private functions in the old file, so the barrel's public surface did not grow.

### Effect ratchet (split-rules item 6)

`apps/site/**` is an exempt path in the effect map (`packages/devtools/src/effect-map/generate.ts:48`, decision D2), so no `// effect-plain:` marker was added. Gate printed `PASS effect`.

### Commands run

- `pnpm install` — done (`resolved 1262, reused 1172`, done in 32.1s).
- `pnpm --filter @zilar/site build` — **built in 360ms** (`dist/assets/index-s6ly6ltN.js` 13.82 kB; unchanged chunk set).
- `pnpm --filter @zilar/site test --maxWorkers=2 --reporter=dot src/cap.test.ts src/demo.test.ts` — **2 files, 17 tests passed** (186ms). The site's tests do not touch `instruments.ts`; they confirm the package is intact.
- `pnpm gate` — summary lines:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.6s)
  PASS  lint  (1.0s)
  PASS  typecheck  (2.6s)
  PASS  effect  (0.9s)
  PASS  tests @zilar/site  (1.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

The first gate run failed `format` on `instruments/dom.ts` (Prettier wanted `reducedMotion` on one line); I fixed it with `pnpm exec prettier --write apps/site/src/instruments/dom.ts` and the rerun above passed.

### Problems / open questions

None. No test was added or edited (split-rules item 5), and no importer changed.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The split:** `instruments.ts` (405 lines) stays the 16-line entry with `initInstruments`, plus `instruments/{dom,approval,routine,provider,pairing,sheen}`. The largest is `routine.ts` at 148, and `required`, `reducedMotion` and `clockTime` live once in `dom.ts`.
- **The lead's check:** headless Chromium, branch against main.
  - Full page at 1300×850: both are 6034 px tall with no page errors.
  - The screenshot shows the approval, routine, provider and pairing instruments.
  - In reduced motion, after scrolling through the whole page, the text of all 8 sections matches main once clock times are masked.
- **Check:** the gate passed, and so did the site build.

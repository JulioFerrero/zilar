---
id: T-2049
title: "Share W2-a: one useDelayed (and the runLater/interruptFiber timer helpers) in client-core, built like the phone's (a plain fiber timer, not a useQuery) — web lib/useDelayed.ts, phone lib/use-delayed.ts and phone lib/effect/timers.ts become one-line re-exports so no importer changes"
status: merged
milestone: M5
branch: task/T-2049-shared-use-delayed
model: deepseek/deepseek-flash
effort: default
estimate: 25 min
---

# T-2049: Shared `useDelayed` and timer helpers (share plan W2-a)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: share functions between web and phone. `docs/audit/share-plan.md` §2.8 found `useDelayed` written twice with the same contract and doc comment. Web runs a timer through `useQuery`, which is heavy for a timer. The phone uses a plain fiber timer. This is UI timing, so there are no tests (Julio's rule).

### Facts (read by the lead on 2026-10-18 at `a56052b9a`)
- **Web.** `apps/web/src/lib/useDelayed.ts` (26 lines): `useDelayed(value, delayMs)` via `useQuery` and `Effect.sleep`.
- **Phone.**
  - `apps/mobile/src/lib/use-delayed.ts` (31 lines): the same contract. It clears during render (the `lastValue` state) and settles with `runLater` / `interruptFiber`.
  - `apps/mobile/src/lib/effect/timers.ts` (14 lines): `runLater(ms, run)` and `interruptFiber(fiber)`, using plain `effect`. They're used in about 80 places in the phone app.
- **The client-core barrel.** `packages/client-core/src/index.ts`. Line 14 is `export { useSmoothText } from './use-smooth-text';`. Other tasks append at the end, or after lines 21 and 22.

### Steps
1. **The shared module.** Create `packages/client-core/src/use-delayed.ts` with the phone's `useDelayed` (same behaviour), plus `runLater` and `interruptFiber`. Only `react` and `effect`.
2. **The barrel.** Add ONE export line in `packages/client-core/src/index.ts`, **directly after line 14**.
3. **Re-exports.** These become one-line re-exports, so their importers don't change:
   - `apps/web/src/lib/useDelayed.ts`: `export { useDelayed } from '@zilar/client-core';`
   - `apps/mobile/src/lib/use-delayed.ts`
   - `apps/mobile/src/lib/effect/timers.ts`: `runLater` and `interruptFiber`

   Add the `effect-plain` marker if the Effect ratchet asks for it, as other adapters do.
4. **Size.** Report the line counts; product lines must go down. No tests (UI timing).

### Allowed files
- `packages/client-core/src/use-delayed.ts`
- `packages/client-core/src/index.ts`
- `apps/web/src/lib/useDelayed.ts`
- `apps/mobile/src/lib/use-delayed.ts`
- `apps/mobile/src/lib/effect/timers.ts`
- `work/T-2049-shared-use-delayed.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **Lead check, web mock:** the chat-list skeleton doesn't flash on a fast load.

---

## Report (written by the worker when done)

### What I did

- Created `packages/client-core/src/use-delayed.ts` with the phone's `useDelayed` unchanged in behaviour (clear during render via `lastValue`, fresh fiber timer per value, interrupt on change/unmount) plus `runLater` and `interruptFiber` moved over verbatim. Imports are only `effect` and `react`.
- Added one line to the `packages/client-core/src/index.ts` barrel directly after the `useSmoothText` line: `export { interruptFiber, runLater, useDelayed } from './use-delayed';`.
- Replaced the three adapters with one-line re-exports so no importer changes:
  - `apps/web/src/lib/useDelayed.ts` → `export { useDelayed } from '@zilar/client-core';`
  - `apps/mobile/src/lib/use-delayed.ts` → same
  - `apps/mobile/src/lib/effect/timers.ts` → `export { interruptFiber, runLater } from '@zilar/client-core';`
- No tests added (UI timing, as the spec says). No `// effect-plain` marker was needed: the effect ratchet classified the new shared file as `effect`, and the three re-export files contain no signals (gate's `effect` step passed).

**Line counts.** The new shared file is 43 lines; the three adapters are 1 line each (previously 26, 31 and 14 = 71) and the barrel grew by 1. Product lines: 71 → 47 (43 + 3 adapters + 1 barrel line), a net decrease of 24.

### Checks run

- `pnpm install`: done, 1155 packages added, no errors.
- No standalone test file runs: the change is UI timing with no tests (per spec). The gate ran the nearest package tests.
- `pnpm gate` (run twice: once before filling this Report, once on the final tree; both ended `GATE PASS`; the block is the final run) → `GATE PASS`:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.4s)
PASS  format  (0.5s)
PASS  lint  (0.7s)
PASS  typecheck  (1.6s)
PASS  effect  (0.6s)
PASS  build @zilar/server  (0.8s)
PASS  tests @zilar/client-core  (5.1s)
PASS  tests @zilar/mobile  (1.9s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- The lead check (chat-list skeleton doesn't flash on a fast load in the web mock) was not run by me; I did not start a dev server. The behaviour is the phone's, copied unchanged: clearing is still immediate during render and each value still settles only after its own `delayMs` fiber.
- `useDelayed` used to run through `useQuery`/`AsyncResult` on web; that dependency is gone from the hook. No importer changed.

## Review (written by Claude)

Approved; the pre-review was clean.
- **What changed.** One `useDelayed`, `runLater` and `interruptFiber` live in client-core, built on the phone's plain fiber timer. The three app files are one-line re-exports.
- **Size.** About −27 product lines.
- **Lead Playwright check** (web mock, branch on :5191):
  - no skeleton in the first 1.2 s;
  - 18 chat rows;
  - Ana's chat opens;
  - no console errors.

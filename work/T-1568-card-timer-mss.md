---
id: T-1568
title: "Task card timers use the one m:ss format (View steps board): web ProgressCard and phone progress-card drop their own '2m 14s' formatElapsed for chat-core formatClock; both steps fallbacks map a leftover 'doing' step to stopped (follow-ups of T-1562)"
status: merged
milestone: M5
branch: task/T-1568-card-timer-mss
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1568: Card timers in m:ss

## Spec (written by Claude, do not edit)

### Why
`docs/design/mockups/view-steps/README.md:7` shows the finished card with `4:12`, and its rule at `:18` is "One time format: `m:ss` durations". Both task cards still print "2m 14s" (the phone smoke of T-1562 shows "2m 14s" on Dev-1's card).

T-1562's pre-review also found a second problem: when the steps route fails, the fallback rows keep a `doing` step, so a finished or stopped card's sheet shows a spinner.

### Facts (the lead read them on main, 2026-10-15)
- **The card timers:**
  - `apps/web/src/components/ProgressCard.tsx:15-25` has `formatElapsed(ms)` (`Ns`, `Nm Ns`, `Nh MMm`), used at `:187`;
  - `apps/mobile/src/components/chat/progress-card.tsx:18-28` has the same function, used at `:151`.
- **`formatClock(ms)`** is exported from `@zilar/chat-core` (`packages/chat-core/src/format-duration.ts`, T-1562): `0:48`, `4:12`, `61:05`.
- **The fallbacks:**
  - web `apps/web/src/components/StepsPanel.tsx:56`;
  - phone `apps/mobile/src/components/chat/steps-sheet.tsx:83`.
  Both map only `step.state === 'planned' ? 'stopped' : step.state`.
- **Leave alone:** the phone voice recorder has its own `formatElapsed` (`apps/mobile/src/components/chat/voice-recorder-flow.ts:164`).

### Steps
1. **Both cards:** delete the local `formatElapsed` and show `formatClock(elapsed)`. Keep every other part of the timer as it is (the ticking, and `elapsedFor`).
2. **Both fallbacks:** map `planned` and `doing` to `stopped` (the sheet and panel open only for finished cards).

### Tests
None.

### Allowed files
- `apps/web/src/components/ProgressCard.tsx`
- `apps/web/src/components/StepsPanel.tsx`
- `apps/mobile/src/components/chat/progress-card.tsx`
- `apps/mobile/src/components/chat/steps-sheet.tsx`
- `work/T-1568-card-timer-mss.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Web mock `/c/ai-dev-1%40zilar.test?mock=1`:** the finished "Reviewing the open PRs" card shows `2:14`, not "2m 14s".
- **The phone card** shows the same.
- `git grep -n "function formatElapsed" -- apps/web/src apps/mobile/src/components/chat/progress-card.tsx` prints nothing.

---

## Report (written by the worker when done)

### What I did

- **Web card (`apps/web/src/components/ProgressCard.tsx`):** deleted the local
  `formatElapsed` and its doc comment; imported `formatClock` from `@/lib/format-duration`
  (the T-1562 re-export of `@zilar/chat-core`); the collapsed line now renders
  `formatClock(elapsed)`. Ticking and `elapsedFor` untouched.
- **Phone card (`apps/mobile/src/components/chat/progress-card.tsx`):** same — deleted
  `formatElapsed`, imported `formatClock` from `@zilar/chat-core`, use it at the elapsed
  `Text`. Ticking and `elapsedFor` untouched.
- **Web fallback (`apps/web/src/components/StepsPanel.tsx`):** `fallbackSteps` now maps
  both `planned` and `doing` to `stopped`.
- **Phone fallback (`apps/mobile/src/components/chat/steps-sheet.tsx`):** same mapping.
- Left the voice recorder's own `formatElapsed`
  (`apps/mobile/src/components/chat/voice-recorder-flow.ts:164`) alone.

No tests were added (spec says none; UI only).

### Checks run

`pnpm install` (worktree setup): done, no errors.

`git grep -n "function formatElapsed" -- apps/web/src apps/mobile/src/components/chat/progress-card.tsx`
→ no output (exit 1), so both card-local helpers are gone (acceptance line 55).

`pnpm gate` (from repo root):
```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (0.9s)
PASS  lint  (1.5s)
PASS  typecheck  (6.0s)
PASS  effect  (1.3s)
PASS  tests @zilar/mobile  (2.1s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

`formatClock(134_000)` is `"2:14"` per `packages/chat-core/src/format-duration.test.ts`
(`4:12` for 252000; the mock card's `2m 14s` becomes `2:14`).

I did not run the web/phone UI smoke (mock URL, phone card) — those are the lead's/owner's
live checks; no automated test covers them.

### Notes for the lead

- No deviations from the spec.
- The only residual `formatElapsed` in the repo is the voice recorder one the spec says to
  leave alone.
- No open questions.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **Web, headless** (`/c/ai-dev-1%40zilar.test?mock=1`): the finished card reads "Reviewing the open PRs 2:14 View steps", with 0 page errors.
- **Phone smoke** (`/chat/ai-dev-1@zilar.test`): PASS. The card shows `2:14` (it was "2m 14s").
- **Both fallbacks** (`StepsPanel.tsx:56`, `steps-sheet.tsx:83`) map `planned` and `doing` to stopped. Neither local `formatElapsed` remains; the voice recorder's own helper is untouched.

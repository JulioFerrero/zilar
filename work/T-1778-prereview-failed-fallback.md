---
id: T-1778
title: "Autopilot: a pre-review session that ends idle with outcome 'failed' and no PREREVIEW.md falls back to the next model, like a quota error, instead of only escalating STALLED"
status: merged
milestone: M5
branch: task/T-1778-prereview-failed-fallback
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1778: Pre-review falls back on a failed start

## Spec (written by Claude, do not edit)

### Why
On 2026-10-16, from about 23:14 UTC, every pre-review started on the free Muse (T-1768, T-1771, T-1773, T-1774, T-1776 and T-1777) went idle about 20 s after starting.
- **What the session showed:** `opencode2 api session.message.list` gave an `"type":"idle","outcome":"failed"` message right after the prompt, with no assistant output and no error text.
- **What the autopilot did:** it escalated `PRE-REVIEW STALLED` and stopped, so the queue stalled until the lead switched each session to paid Muse by hand. Those reviews then ran fine.
- **Why:** the fallback only fires on a recognised quota error.

### Facts (read by the lead on 2026-10-16)
- **The decision:** `packages/devtools/src/lead/decide.ts` (316 lines), section 4 (`:182-243`):
  - with `input.prereviewQuotaError` it falls back with `fallbackModel(input.record.prereview.model ?? FREE_MUSE, input.goPaused)` and escalates `LEAD: FALLBACK … pre-review continues on …` (`:197-209`);
  - otherwise, when the pre-review is idle with no `PREREVIEW.md`, it escalates `PRE-REVIEW STALLED` once (`:238-241`).
- **The inputs:** `DecideInput` (`decide.ts:22-…`) has `prereviewQuotaError: boolean` (`:46`). `packages/devtools/src/lead/autopilot.ts:102-110` (234 lines) fills it from `summarizeSession(...).quotaError`.
- **The summary:** `summarizeSession` (`packages/devtools/src/lead/session.ts:130-176`) already returns `outcome` (the newest idle message's outcome, `:138-148`).
- **The chain:** `fallbackModel` and the model ids live in `packages/devtools/src/lead/models.ts` (`FREE_MUSE`, `PAID_MUSE`, …). When the chain is exhausted it returns `undefined`.

### Steps
1. **The input:** add `prereviewFailed: boolean` to `DecideInput`.
   - Set it in `autopilot.ts` from the pre-review summary: `summary.state === 'idle' && summary.outcome === 'failed'`.
2. **The decision:** in `decide.ts` section 4, treat `input.prereviewQuotaError || (input.prereviewFailed && !input.prereviewFilePresent)` as the fallback trigger, using the same `fallback-model` action and the same `FALLBACK` line.
   - When `fallbackModel` returns `undefined` (the chain is exhausted), keep today's `PRE-REVIEW STALLED` escalation. That guarantees no loop.
3. **Tests (2)** in `packages/devtools/src/lead/autopilot.test.ts`, or wherever the decide cases live (read the file):
   - an idle pre-review with outcome `failed` and no `PREREVIEW.md`, on the free Muse, gives the `fallback-model` action and the FALLBACK line;
   - on the last model in the chain, the same input gives `PRE-REVIEW STALLED` and no fallback.

### Allowed files
- `packages/devtools/src/lead/decide.ts`
- `packages/devtools/src/lead/autopilot.ts`
- `packages/devtools/src/lead/autopilot.test.ts`
- `work/T-1778-prereview-failed-fallback.md`

### Checks
```bash
cd packages/devtools && pnpm exec vitest run src/lead/autopilot.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- A pre-review that fails at start moves to the next model on its own.
- An exhausted chain still escalates STALLED once.
- The tests and the gate pass.

---

## Report (written by the worker when done)

### What I did

- `packages/devtools/src/lead/decide.ts`: added `prereviewFailed: boolean` to `DecideInput`.
  The section 4 fallback trigger is now
  `input.prereviewQuotaError || (input.prereviewFailed && !input.prereviewFilePresent)`,
  using the same `fallback-model` action and the same `FALLBACK` line. When
  `fallbackModel` returns `undefined` the code falls through to the existing
  `PRE-REVIEW STALLED` escalation, so an exhausted chain still says it once and
  cannot loop.
- `packages/devtools/src/lead/autopilot.ts`: set
  `prereviewFailed = summary.state === 'idle' && summary.outcome === 'failed'`
  from the pre-review summary (the same summary that already supplies
  `prereviewSessionState` and `prereviewQuotaError`) and passed it into `decide`.
  On a failed `listMessages` the flag stays `false`, matching the `unknown`
  session state.
- `packages/devtools/src/lead/autopilot.test.ts`: added two cases that call the
  pure `decide` with a `status: review` task whose pre-review is idle on HEAD
  with `outcome: failed` and no `PREREVIEW.md`:
  1. on the free Muse it returns the `fallback-model` action with session
     `prereview` and model `FREE_GLM_FLASH`, plus the
     `LEAD: FALLBACK … pre-review continues on free GLM flash` line;
  2. on `PAID_MUSE` (the last model in the chain) it returns no fallback and
     exactly the `LEAD: PRE-REVIEW STALLED … (idle, no PREREVIEW.md)` line.
- `work/T-1778-prereview-failed-fallback.md`: status updates and this report.

No deviations from the Spec. No new dependencies.

### Checks run

- `pnpm install` — Done, 16.1s.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/autopilot.test.ts`
  — 1 file passed, 3 tests passed (the pre-existing T-1242 case plus the two new ones).
- `pnpm gate` (from the repo root), summary lines:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (1.4s)
  PASS  lint  (1.0s)
  PASS  typecheck  (2.0s)
  PASS  effect  (0.9s)
  PASS  tests @zilar/devtools  (22.1s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The first gate run failed only on `format` for the new test file; running
  `pnpm exec prettier --write` on that one file fixed it, and the re-run is the
  `GATE PASS` above.

### Notes for the lead

- The failed trigger is scoped to `!input.prereviewFilePresent`, as the Spec
  asks, so a pre-review that did write `PREREVIEW.md` is unaffected.
- No secrets or request logging are touched by this change; the security
  checklist does not apply here.
- Nothing was pushed, merged or moved off `task/T-1778-prereview-failed-fallback`.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `90eec19a0`.
- `prereviewFailed` is true when the session is idle with outcome `failed` (`autopilot.ts`). `decide.ts` falls back on that or on a quota error, but only when `PREREVIEW.md` is missing.
- The existing `fallback-model` action switches the session's model, then re-prompts it with `prereview-resume` (`autopilot/actions.ts:105-120`). So a failed start really resumes, the way the lead did by hand at 23:40 UTC.
- When the chain runs out, the autopilot still escalates `PRE-REVIEW STALLED` once.
- Two tests are added.

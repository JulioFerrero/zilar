---
id: T-1087
title: "Mobile approvals: mergeRulesFanOut returns the error state only when every AI's rules fetch failed (not when the successes were empty)"
status: merged
milestone: M5
branch: task/T-1087-mobile-rules-fanout-partial-failure
model: auto
effort: default
depends_on: []
estimate: 0.1 day
---

# T-1087: "Could not load the rules." only when every AI failed

## Spec (written by Claude, do not edit)

### Why
This BOARD follow-up was found in the T-1061 smoke on 2026-10-10. It also happens in real builds, for example with an AI deleted between the list and the rules fetch. The lead re-read main (2026-10-11):
- **What it should do:** `apps/mobile/src/components/approvals/rows.ts:76-80` documents the rule, "One AI's failure never blanks the others… `null` means every AI failed".
- **What it does:** the code at `:81-90` returns `null` whenever `succeeded.length === 0` and any result was rejected. If one AI fails and the others answer an **empty** list, the whole section shows the error.
- **The caller** `components/approvals/use-approvals.ts:148-160` turns `null` into `setRulesStatus('error')` and "Could not load the rules."; anything else becomes the ready list.

### What to build
1. **In `rows.ts`,** `mergeRulesFanOut` returns `null` only when `settled.length > 0` and **every** result is `rejected`. Otherwise it returns the merged successes, which may be empty.
2. **Keep the doc comment** accurate.
3. **Tests:** approvals are a permissions area (Julio, 2026-10-10, tests only for crucial code), so add **one** small test file, `apps/mobile/src/components/approvals/rows.test.ts`, with three cases:
   - all rejected gives `null`;
   - one rejected plus one fulfilled empty gives `[]`;
   - one rejected plus one fulfilled with a rule gives that rule.

   Use the repo's mobile vitest setup and no UI.
4. **No other changes.**

### Read first
`AGENTS.md`, `apps/mobile/src/components/approvals/rows.ts`, and `apps/mobile/src/components/approvals/use-approvals.ts`.

### Allowed files
`apps/mobile/src/components/approvals/rows.ts`, `apps/mobile/src/components/approvals/rows.test.ts`, `work/T-1087-mobile-rules-fanout-partial-failure.md`.

### Checks
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/approvals/rows.test.ts
pnpm gate
```

### Acceptance
- The Checks pass.

---

## Report (written by the worker when done)

**What I did**
- `mergeRulesFanOut` in `rows.ts` now returns `null` only when there is at least one result and **every** result is `rejected`; otherwise it returns the merged fulfilled successes, which may be empty. A single failed AI no longer blanks the section when the survivors answered an empty rule list.
- Updated the doc comment: `null` means every AI failed with at least one result; an empty merged list is valid.
- Added `apps/mobile/src/components/approvals/rows.test.ts` (no UI) with the three spec cases: all rejected → `null`; one rejected + fulfilled empty → `[]`; one rejected + fulfilled with a rule → that rule.

**Files changed**
- `apps/mobile/src/components/approvals/rows.ts` — return condition + comment.
- `apps/mobile/src/components/approvals/rows.test.ts` — new test file.
- `work/T-1087-mobile-rules-fanout-partial-failure.md` — status and this report.

**Commands and real results**
- `pnpm install` — completed, no error (Done in 9.6s).
- Single test file (task Checks): `pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/approvals/rows.test.ts` → `Test Files 1 passed (1)`, `Tests 3 passed (3)`.
- `pnpm gate` (repo root), summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.5s)
  PASS  lint  (1.3s)
  PASS  typecheck  (3.9s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/mobile  (1.0s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

**Problems / deviations**
- First `pnpm gate` failed at `format` on one over-long line in the new test file; I wrapped it manually and re-ran gate, which then passed. No deviation from the spec.

**Security checklist**
- Not applicable: this change is a pure function plus a pure unit test — no I/O, no routes, no secrets, no assets, no database. The affected area (approvals) is permissions-adjacent, but the only behaviour change is which HTTP failure maps to the error state; no data or permission logic changed.

**Open questions**
- None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The change:** `mergeRulesFanOut` returns `null` (the error state) only when `settled.length > 0` and every fetch was rejected. One failed AI next to AIs with empty rule lists now gives the empty list, as the doc comment says. This applies to real builds too.
- **The test:** `rows.test.ts` has 3 cases: all rejected gives `null`; rejected plus empty gives `[]`; rejected plus one rule gives that rule. The lead ran it: 3 passed.
- **No phone smoke:** it is a pure function change, and the test covers it.
- **Check:** the gate passed.

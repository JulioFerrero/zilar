---
id: T-1087
title: "Mobile approvals: mergeRulesFanOut returns the error state only when every AI's rules fetch failed (not when the successes were empty)"
status: todo
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

## Review (written by Claude)

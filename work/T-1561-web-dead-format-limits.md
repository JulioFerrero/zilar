---
id: T-1561
title: "Web dead code: delete formatLimits from apps/web/src/components/ais/limits.ts (no users since the lean My AIs rows); keep the chat-core re-exports"
status: merged
milestone: M5
branch: task/T-1561-web-dead-format-limits
model: auto
effort: default
depends_on: []
estimate: 10 min
---

# T-1561: Web drops formatLimits

## Spec (written by Claude, do not edit)

### Why
The lean My AIs rows (T-1510, T-1538) show spend and limits through chat-core's `aiHealth` and `formatUsd`. On 2026-10-15 the lead ran `git grep -n "formatLimits" -- apps packages`: the only hit is the web definition. The phone twin was removed in T-1550.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/web/src/components/ais/limits.ts` (24 lines):**
  - re-exports `formatLimit`, `MAX_MONTHLY_USD`, `validateLimits` and `LimitsValidation` from `@zilar/chat-core` (`:1-9`);
  - then defines `formatLimits` (`:11-24`).
- **Importers of the file:** `AiHealthRow.tsx:17` (`formatLimit`) and `AiPanel.tsx:38` (`validateLimits`).

### Steps
1. Re-run `git grep -n "\bformatLimits\b" -- apps packages`; if anything other than the definition uses it, stop and say so.
2. Delete `formatLimits` and its comment, and keep the re-exports.

### Tests
None.

### Allowed files
- `apps/web/src/components/ais/limits.ts`
- `work/T-1561-web-dead-format-limits.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- `formatLimits` no longer exists in `apps/` or `packages/`, and the gate passes.

---

## Report (written by the worker when done)

### What I did

Followed the spec exactly.

1. Re-ran `git grep -n "\bformatLimits\b" -- apps packages`. The only hit was
   `apps/web/src/components/ais/limits.ts:12` (the definition itself); no other code
   referenced it. Proceeded.
2. Deleted the `formatLimits` function and its JSDoc comment from
   `apps/web/src/components/ais/limits.ts`. The chat-core re-exports
   (`formatLimit`, `MAX_MONTHLY_USD`, `validateLimits`, `type LimitsValidation`) and the
   header comment are unchanged. After the edit the same grep returns no matches
   (exit 1).

Files changed:
- `apps/web/src/components/ais/limits.ts` (removed lines 11-24: `formatLimits` + comment)
- `work/T-1561-web-dead-format-limits.md` (this report)

### Checks run

- `git grep -n "\bformatLimits\b" -- apps packages` before: 1 hit, the definition at
  `limits.ts:12`. After: no matches (exit 1). Acceptance criterion met.
- `pnpm gate` from the repo root: exit 0, ends with `GATE PASS`. Summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (2.9s)
  PASS  format  (1.1s)
  PASS  lint  (1.7s)
  PASS  typecheck  (7.5s)
  PASS  effect  (3.5s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: the task specifies "Tests: None" and the gate skipped
  tests for `@zilar/web` (no nearby test files). No runtime code changed.

### Notes for the lead

- No deviations from the spec. The two importers listed in the spec
  (`AiHealthRow.tsx:17`, `AiPanel.tsx:38`) use only `formatLimit` / `validateLimits`,
  which are still re-exported, so nothing else needed touching.
- No new dependencies, no architecture or security decisions.

### Blocked / needs a decision

None.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- `formatLimits` is gone (`git grep` finds no use in `apps/` or `packages/`), and the chat-core re-exports in `limits.ts` stay.

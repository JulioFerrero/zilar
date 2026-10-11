---
id: T-1098
title: "Message search debounce and min length: one copy in @zilar/chat-core, used by web and mobile"
status: merged
milestone: M5
branch: task/T-1098-shared-message-search-constants
model: auto
effort: default
depends_on: [T-1093]
estimate: 0.05 day
---

# T-1098: Shared message-search constants

## Spec (written by Claude, do not edit)

### Why
Simplify plan item 0.2 (`docs/audit/simplify-status.md`, the N2 slice): the message search waits 250 ms after typing and needs at least 2 characters. Each app declares this itself:
- **web:** `apps/web/src/lib/useMessageSearch.ts:8` (`MESSAGE_SEARCH_DEBOUNCE_MS = 250`), with a literal `>= 2` at `:66`;
- **mobile:** `apps/mobile/src/components/chat/message-search-format.ts:4` (`MESSAGE_SEARCH_DEBOUNCE_MS = 250`) and `:7` (`MESSAGE_SEARCH_MIN_LENGTH = 2`). `apps/mobile/src/components/chat/message-search.ts:24-27` re-exports them.

### What to build
1. **A new `packages/chat-core/src/search.ts`** exports `MESSAGE_SEARCH_DEBOUNCE_MS = 250` and `MESSAGE_SEARCH_MIN_LENGTH = 2`, each with a one-line doc comment. Add `export * from './search';` to `packages/chat-core/src/index.ts`.
2. **Web:** `useMessageSearch.ts` imports both from `@zilar/chat-core`. It keeps its `MESSAGE_SEARCH_DEBOUNCE_MS` export as a re-export, and `:66` uses `MESSAGE_SEARCH_MIN_LENGTH`.
3. **Mobile:** `message-search-format.ts` imports both from `@zilar/chat-core` and re-exports them under the same names, so `message-search.ts` does not change.
4. **No tests,** and no other files change.

### Read first
`AGENTS.md` and the three files named above.

### Allowed files
`packages/chat-core/src/search.ts`, `packages/chat-core/src/index.ts`, `apps/web/src/lib/useMessageSearch.ts`, `apps/mobile/src/components/chat/message-search-format.ts`, `work/T-1098-shared-message-search-constants.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.

---

## Report (written by the worker when done)

### What I did
- Added `packages/chat-core/src/search.ts` exporting `MESSAGE_SEARCH_DEBOUNCE_MS = 250` and `MESSAGE_SEARCH_MIN_LENGTH = 2`, each with a one-line doc comment, and re-exported it from `packages/chat-core/src/index.ts` (`export * from './search';`).
- Web: `apps/web/src/lib/useMessageSearch.ts` now imports both constants from `@zilar/chat-core`, keeps `MESSAGE_SEARCH_DEBOUNCE_MS` as a re-export (`export { MESSAGE_SEARCH_DEBOUNCE_MS };`), and the minimum length at line 66 uses `MESSAGE_SEARCH_MIN_LENGTH` instead of the `2` literal.
- Mobile: `apps/mobile/src/components/chat/message-search-format.ts` imports both constants from `@zilar/chat-core` and re-exports them under the same names, so `message-search.ts` is unchanged.
- No tests added (per the spec); no other files changed.

### Files changed
- `packages/chat-core/src/search.ts` (new)
- `packages/chat-core/src/index.ts`
- `apps/web/src/lib/useMessageSearch.ts`
- `apps/mobile/src/components/chat/message-search-format.ts`
- `work/T-1098-shared-message-search-constants.md` (status + this Report)

### Commands run
- `pnpm install` — Done in 26.5s.
- `pnpm gate` — summary:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (0.7s)
  PASS  lint  (1.2s)
  PASS  typecheck  (6.8s)
  PASS  effect  (1.0s)
  PASS  tests @zilar/chat-core  (1.8s)
  SKIP tests @zilar/mobile (no nearby test files)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- Single test files: none ran separately — no test file is near this change (grep for `MESSAGE_SEARCH_`/`message-search`/`useMessageSearch` in `*.test.*` found nothing), and the spec says no tests.

### Problems / deviations
- None. No deviation from the spec.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The change:**
  - `packages/chat-core/src/search.ts` holds `MESSAGE_SEARCH_DEBOUNCE_MS = 250` and `MESSAGE_SEARCH_MIN_LENGTH = 2`;
  - web `useMessageSearch.ts` and mobile `message-search-format.ts` import them and re-export them under the old names;
  - web `:66` uses the constant instead of a literal `2`.
- **The lead read the diff:** the values are identical, so behaviour does not change, and the lead ran no UI check.
- **Check:** the gate passed.

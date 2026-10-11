---
id: T-1098
title: "Message search debounce and min length: one copy in @zilar/chat-core, used by web and mobile"
status: todo
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

## Review (written by Claude)

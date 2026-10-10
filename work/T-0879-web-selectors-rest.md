---
id: T-0879
title: "Web: ChatView and the remaining useChatStore() call sites use useChatSelector; GroupHeaderRow memoised"
status: todo
milestone: M5
branch: task/T-0879-web-selectors-rest
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0879: Web: ChatView and the remaining useChatStore() call sites use useChatSelector; GroupHeaderRow memoised

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Follow-up of T-0845 (web store selectors; read its Report in `work/T-0845-web-store-selectors.md`).
- **ChatView:** it still uses `useChatStore()` (the whole state) and passes new `onReply`, `onForward` and `selection` callbacks on every render, so `MessageList` re-renders on every store change.
- **The rest:** about 30 other call sites of `useChatStore()` remain (`grep -rn "useChatStore()" apps/web/src`), and `GroupHeaderRow` is not memoised.

Line numbers come from the audit and may have moved since: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Convert `ChatView` to narrow `useChatSelector` selectors, and make its callbacks stable.
2. Convert the remaining `useChatStore()` call sites the same way. Selectors must return stable values.
3. Memoise `GroupHeaderRow`.
4. Once nothing uses `useChatStore()`, remove it. Keep `useChatStoreApi` for actions.
5. Extend T-0845's render-count tests to `ChatView`: a typing event in another chat must not re-render `MessageList`.

Rendered output stays the same.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), the audit section and task Reports cited above, and the files listed.

### Allowed files
`apps/web/src/**`, `work/T-0879-web-selectors-rest.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/web test --reporter=dot
pnpm --filter @zilar/web typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit. The machine is shared, so note `uptime` next to any timing.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Lines removed (and every other number the spec asks for) are in the Report, measured.
- Live check for Julio's single test: Julio streams an AI reply in a long chat on web.

---

## Report (written by the worker when done)

## Review (written by Claude)

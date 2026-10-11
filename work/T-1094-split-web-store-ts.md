---
id: T-1094
title: "Split apps/web/src/store/store.ts (555 lines) into types + selectors + chat groups, pure relocation"
status: todo
milestone: M5
branch: task/T-1094-split-web-store-ts
model: auto
effort: default
depends_on: [T-1093]
estimate: 0.15 day
---

# T-1094: Split the web `store.ts`

## Spec (written by Claude, do not edit)

### Why
- **The rule:** Julio's 400-line limit (2026-10-10, `CLAUDE.md`).
- **The file:** `apps/web/src/store/store.ts` has 555 lines. It holds:
  - the option types (`:37-84`);
  - the `ChatStore` interface (`:85-379`) and `ChatStoreState` (`:380`);
  - the folder selectors `matchesFolder` (`:409`), `activeFolderOf` (`:416`) and `visibleChats` (`:423`);
  - the chat grouping: `ChatGroup` (`:447`), `groupTitleOf` (`:457`), `groupChats` (`:472`), `groupPinTime` (`:527`), `sortGroupsPinnedFirst` (`:533`) and `folderUnread` (`:543`);
  - the re-exports at the end (`:555`).
- **Why it can be split now:** it waited for the mock rebuild, which is done (T-1074).
- **The plan:** `docs/audit/size-plan.md` §2.3 #59.

### What to build
1. **Move, unchanged:**
   - the folder selectors to `apps/web/src/store/selectors.ts`;
   - the chat grouping and `folderUnread` to `apps/web/src/store/chatGroups.ts`.
2. **Keep in `store.ts`:** the types and the interface. Re-export every moved name from it (`export { … } from './selectors'` and so on), so **no importer changes**. If `store.ts` is still over 400 lines, also move the option types (`:37-84`) to `apps/web/src/store/storeOptions.ts` and re-export them.
3. **Constraints:**
   - this is a pure relocation, with no dedup and no renames;
   - every resulting file is at most 400 lines;
   - no other files change.
4. **The Report:** the before/after line counts, and the output of `grep -rn "from '@/store/store'\|from './store'\|from '../store'" apps/web/src | wc -l`, the same before and after.

### Read first
`AGENTS.md` and `apps/web/src/store/store.ts`.

### Allowed files
`apps/web/src/store/store.ts`, `apps/web/src/store/selectors.ts`, `apps/web/src/store/chatGroups.ts`, `apps/web/src/store/storeOptions.ts`, `work/T-1094-split-web-store-ts.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- Every file is at most 400 lines.

---

## Report (written by the worker when done)

## Review (written by Claude)

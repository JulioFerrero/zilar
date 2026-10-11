---
id: T-1094
title: "Split apps/web/src/store/store.ts (555 lines) into types + selectors + chat groups, pure relocation"
status: merged
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

Status: review

### What I did

Pure relocation of `apps/web/src/store/store.ts` (555 lines) into three new
modules, with `store.ts` re-exporting every moved name so no importer changes.

- `apps/web/src/store/selectors.ts` (new): `matchesFolder`, `visibleChats` and
  `activeFolderOf`.
- `apps/web/src/store/chatGroups.ts` (new): `ChatGroup`, `groupChats`,
  `folderUnread` and the private helpers `groupTitleOf`, `groupPinTime`,
  `sortGroupsPinnedFirst`.
- `apps/web/src/store/storeOptions.ts` (new): the option types
  `ConnectionStatus`, `ChatsState`, `HistoryState`, `TypingState`, `DraftState`,
  `SendTextOptions`, `VoiceRecording`, `SendAttachmentOptions`,
  `SendStickerInput`. These were moved because `store.ts` was still over 400
  lines after the first two moves (spec step 2, "If `store.ts` is still over 400
  lines, also move the option types").
- `store.ts` keeps the `ChatStore` interface and `ChatStoreState`, and re-exports
  the moved names plus the pre-existing chatPrefs re-exports:
  `export type { … } from './storeOptions'`,
  `export { matchesFolder, visibleChats } from './selectors'`,
  `export { groupChats, folderUnread } from './chatGroups'`,
  `export type { ChatGroup } from './chatGroups'`.

### Line counts

- before: `store.ts` 555
- after: `store.ts` 382, `selectors.ts` 40, `chatGroups.ts` 115,
  `storeOptions.ts` 49. Every file ≤ 400.

### Importer grep

`grep -rn "from '@/store/store'\|from './store'\|from '../store'" apps/web/src | wc -l`

- before: 9
- after: 11

Deviation from the spec (which says "the same before and after"): the two extra
matches are the new internal type-only imports of `ChatStoreState` (which the
spec keeps in `store.ts`): `selectors.ts:4` and `chatGroups.ts:3`. No external
importer changed — the 9 pre-existing matches (`@/store/store` from
components/provider, `./store` from `realStore.ts`, `../store` from
`effects/*`) are untouched. The moved functions need the state type that stays
in `store.ts`, so these two reverse (`type`-only) imports are unavoidable.

### Other notes

- `activeFolderOf` was a private function in `store.ts`; it is now exported from
  `selectors.ts` (still not re-exported from `store.ts`) so `chatGroups.ts` can
  call it. No public API change.
- `store.ts` imports the moved option types with `import type` and re-exports
  them with `export type` because `verbatimModuleSyntax` is on.

### Commands run

- `pnpm install` — done in 14s with pnpm v10.32.1 (1 deprecated subdependency
  `uuid@7.0.3`; a pre-existing peer warning for `@types/react-dom` in
  `apps/mobile`).
- `pnpm gate` — **GATE PASS**. Summary lines:
  - `install (frozen)` 1.8s, `format` 0.7s, `lint` 1.2s, `typecheck` 5.0s,
    `effect` 0.7s, `tests @zilar/web` 7.5s
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
- No standalone test runs: no test file changed, so the gate ran the store
  folder's nearest tests.

### Files changed

- `apps/web/src/store/store.ts` (modified)
- `apps/web/src/store/selectors.ts` (new)
- `apps/web/src/store/chatGroups.ts` (new)
- `apps/web/src/store/storeOptions.ts` (new)
- `work/T-1094-split-web-store-ts.md` (modified)

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The change:** web `store.ts` goes from 555 to 382 lines, with `selectors.ts` (40), `chatGroups.ts` (115) and `storeOptions.ts` (49). `store.ts` re-exports every moved name, so no importer changed.
- **The lead's line check:** sorted removed lines against sorted added lines, leaving out imports and re-exports. The only difference is that `activeFolderOf` gained `export`, because `chatGroups.ts` uses it. The bodies are identical.
- **Check:** the gate passed.

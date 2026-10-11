---
id: T-1095
title: "Split apps/mobile/src/store/types.ts (507 lines): list-view helpers and send option types out, ChatStoreState unchanged, pure relocation"
status: merged
milestone: M5
branch: task/T-1095-split-mobile-store-types
model: auto
effort: default
depends_on: [T-1093]
estimate: 0.15 day
---

# T-1095: Split the mobile `store/types.ts`

## Spec (written by Claude, do not edit)

### Why
- **The rule:** Julio's 400-line limit (2026-10-10).
- **The file:** `apps/mobile/src/store/types.ts` has 507 lines. It holds:
  - the send option types: `SendTextOptions` (`:41`), `SendAttachmentOptions` (`:48`), `SendVoiceRecording` (`:54`) and `SendStickerChoice` (`:64`);
  - the list-view helpers: `LoadState` (`:79`), `DraftState` (`:82`), `draftEntryKey` (`:92`), `ChatsListView`/`chatsListView` (`:101-108`), `MessagesListView`/`messagesListView` (`:122-125`) and `emptyChatsText` (`:142`);
  - `interface ChatStoreState`, from `:150` to the end.
- **Why it can be split now:** it waited for the mock rebuild, which is done.
- **The plan:** `docs/audit/size-plan.md` §2.3 #82.

### What to build
1. **Move, unchanged:**
   - the list-view helpers and types (`:79-149`) to `apps/mobile/src/store/list-views.ts`;
   - the send option types (`:41-78`) to `apps/mobile/src/store/send-types.ts`.
2. **Re-export** every moved name from `types.ts`, so **no importer changes**.
3. **If `types.ts` is still over 400 lines:** split `ChatStoreState` with `extends`. Move one coherent block of its members (the group and topic members, for example) into an `interface ChatStoreGroups` in `apps/mobile/src/store/types-groups.ts`, and declare `export interface ChatStoreState extends ChatStoreGroups { … }`. Member names, types and doc comments stay the same.
4. **Constraints:**
   - this is a pure relocation, with no dedup and no renames;
   - every file is at most 400 lines;
   - no other files change.
5. **The Report:** the before/after line counts.

### Read first
`AGENTS.md` and `apps/mobile/src/store/types.ts`.

### Allowed files
`apps/mobile/src/store/types.ts`, `apps/mobile/src/store/list-views.ts`, `apps/mobile/src/store/send-types.ts`, `apps/mobile/src/store/types-groups.ts`, `work/T-1095-split-mobile-store-types.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- Every file is at most 400 lines.

---

## Report (written by the worker when done)

### What I did
Pure relocation of `apps/mobile/src/store/types.ts`, no dedup, no renames, no importer changes.

- Moved the four send option types (`SendTextOptions`, `SendAttachmentOptions`,
  `SendVoiceRecording`, `SendStickerChoice`) to `apps/mobile/src/store/send-types.ts`.
- Moved the list-view helpers (`LoadState`, `DraftState`, `draftEntryKey`,
  `ChatsListView`/`chatsListView`, `MessagesListView`/`messagesListView`,
  `emptyChatsText`) to `apps/mobile/src/store/list-views.ts`.
- `types.ts` is now a barrel: it re-exports every moved name (`export type … from`
  for the types and `export … from` for the three functions), and it locally
  imports only the names `ChatStoreState` still references.
- `types.ts` was still over 400 lines after the first two moves, so per spec
  step 3 I split `ChatStoreState` with `extends`: the group/channel/topic/invite/
  role members now live in `interface ChatStoreGroups` in
  `apps/mobile/src/store/types-groups.ts`, and `types.ts` declares
  `export interface ChatStoreState extends ChatStoreGroups`. Member names, types
  and doc comments are unchanged. `ChatStoreGroups` is also re-exported from
  `types.ts`.

### Files changed
- `apps/mobile/src/store/types.ts` (modified)
- `apps/mobile/src/store/send-types.ts` (new)
- `apps/mobile/src/store/list-views.ts` (new)
- `apps/mobile/src/store/types-groups.ts` (new)
- `work/T-1095-split-mobile-store-types.md` (this Report + status)

### Before / after line counts
- Before: `types.ts` 507 lines.
- After: `types.ts` 239, `send-types.ts` 40, `list-views.ts` 77, `types-groups.ts` 203. Every file is under 400.

### Commands and real results
- `pnpm install`: done (`Done in 20.2s`; only unrelated peer-dependency warnings).
- `pnpm gate`, first run: `FAIL format` on `apps/mobile/src/store/types.ts` (Prettier
  wanted the `@zilar/chat-core` import wrapped). Fixed with `pnpm exec prettier --write apps/mobile/src/store/types.ts`.
- `pnpm gate`, second run:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  tests @zilar/mobile
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  The gate ran the mobile package tests; I ran no other test command because this
  is a type-only relocation and the task's Checks list only `pnpm gate`.

### Notes / deviations
- The spec described the send block as `:41-78` and the list-view block as `:79-149`.
  Line 73 was blank and lines 74-78 are the `LoadState` doc comment, so I moved the
  send types as lines 41-72 and the list-view block (with its `LoadState` doc comment)
  as 74-144, which matches the intent (each comment travels with its declaration).
- No dependencies added, no `any`, no `@ts-ignore`, no files outside the Allowed list.

### Open questions
- None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The change:** mobile `store/types.ts` goes from 507 to 237 lines, with `list-views.ts`, `send-types.ts` and `types-groups.ts`. `ChatStoreState extends ChatStoreGroups`, and every name is re-exported from `types.ts`.
- **The lead's line check:** sorted removed lines against sorted added lines. The only differences are the new header comments and the `interface … extends` line. No member and no function body changed.
- **Check:** the gate passed.

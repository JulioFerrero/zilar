---
id: T-1095
title: "Split apps/mobile/src/store/types.ts (507 lines): list-view helpers and send option types out, ChatStoreState unchanged, pure relocation"
status: todo
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

## Review (written by Claude)

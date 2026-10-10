---
id: T-1020
title: "Size split T72: apps/mobile/src/app/(tabs)/index.tsx (537 lines) into components/chat/{search-header,chat-search-results,chat-rows,chat-list,chat-actions-host,use-chat-actions}; one Chat/Group row switch"
status: todo
milestone: M5
branch: task/T-1020-split-mobile-chats-tab
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1020: Split the mobile chats tab

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/app/(tabs)/index.tsx` is 537 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #68 (task T72). The new files go in `apps/mobile/src/components/chat/`:
- `search-header.tsx`;
- `chat-search-results.tsx`;
- `chat-rows.tsx`;
- `chat-list.tsx`;
- `chat-actions-host.tsx`;
- `use-chat-actions.ts`.

The screen keeps the `searchOpen` wiring, the branch selection and its default export. None of these names exist in that folder today. Leave the existing `chat-list-item.tsx` and `chat-actions-sheet.tsx` as they are.

- **In scope:** the in-file Dedup. `chat-rows.tsx` holds the one Chat/Group row switch that replaces the three copies.
- **Out of scope:** the `withKey` → `lib/collections.ts` move, because that file does not exist. `withKey` (`index.tsx:44`) moves with its caller.

The lead runs a phone smoke of the Chats tab in a mock build: the list, search, and a long-press on a chat.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #68, and `apps/mobile/src/app/(tabs)/index.tsx`.

### Allowed files
`apps/mobile/src/app/(tabs)/index.tsx`, `apps/mobile/src/components/chat/search-header.tsx`, `apps/mobile/src/components/chat/chat-search-results.tsx`, `apps/mobile/src/components/chat/chat-rows.tsx`, `apps/mobile/src/components/chat/chat-list.tsx`, `apps/mobile/src/components/chat/chat-actions-host.tsx`, `apps/mobile/src/components/chat/use-chat-actions.ts`, `work/T-1020-split-mobile-chats-tab.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)

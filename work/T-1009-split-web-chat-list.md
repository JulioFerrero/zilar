---
id: T-1009
title: "Size split T84: apps/web/src/components/ChatList.tsx (509 lines) into components/chatList/{rowsSelector,ChatListMenu,ChatListBody}; one NavMenuItem"
status: todo
milestone: M5
branch: task/T-1009-split-web-chat-list
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1009: Split `ChatList.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/ChatList.tsx` is 509 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #80 (task T84). The new files go in a new `apps/web/src/components/chatList/` folder: `rowsSelector.ts`, `ChatListMenu.tsx` and `ChatListBody.tsx`. `ChatList.tsx` keeps the list and every export it has today.

The in-file Dedup is in scope: the menu's near-identical "close the menu, then navigate" items become one `NavMenuItem({ to, label, badge })`. Each item keeps its own label, target and badge, and the order stays the same.

The lead checks it in Chrome in mock mode: the chat list, the ☰ menu and each of its links.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #80, and `apps/web/src/components/ChatList.tsx`.

### Allowed files
`apps/web/src/components/ChatList.tsx`, `apps/web/src/components/chatList/rowsSelector.ts`, `apps/web/src/components/chatList/ChatListMenu.tsx`, `apps/web/src/components/chatList/ChatListBody.tsx`, `work/T-1009-split-web-chat-list.md`.

### Checks
```bash
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for, plus the menu items' labels and targets before and after.

---

## Report (written by the worker when done)

## Review (written by Claude)

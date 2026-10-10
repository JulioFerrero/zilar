---
id: T-0974
title: "Size split T26: apps/mobile/src/app/group/[id].tsx (835 lines) into components/chat/{group-header,group-topic-list,use-group-roles,use-group-invite-links,use-group-visibility,use-group-new-topic,group-action}"
status: todo
milestone: M5
branch: task/T-0974-split-mobile-group-screen
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0974: Split the mobile group screen

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/app/group/[id].tsx` is 835 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #22 (task T26). The new files go in `apps/mobile/src/components/chat/`:
- `group-header.tsx`, `group-topic-list.tsx`;
- `use-group-roles.ts`, `use-group-invite-links.ts`, `use-group-visibility.ts`, `use-group-new-topic.ts`;
- `group-action.ts`.

The route file keeps its default export, the header, the notices and the five sheets.

The in-file Dedup is in scope. `group-action.ts` holds the `rawCall` and the fixed-sentence `catch` plus `ensuring` wrapper that the roles, links, archive, pref and visibility blocks each repeat. Every error sentence stays exactly the same.

The lead runs a phone smoke of `/group/g-devteam` in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #22, and `apps/mobile/src/app/group/[id].tsx`.

### Allowed files
`apps/mobile/src/app/group/[id].tsx`, `apps/mobile/src/components/chat/group-header.tsx`, `apps/mobile/src/components/chat/group-topic-list.tsx`, `apps/mobile/src/components/chat/use-group-roles.ts`, `apps/mobile/src/components/chat/use-group-invite-links.ts`, `apps/mobile/src/components/chat/use-group-visibility.ts`, `apps/mobile/src/components/chat/use-group-new-topic.ts`, `apps/mobile/src/components/chat/group-action.ts`, `work/T-0974-split-mobile-group-screen.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, the Report has everything `split-rules.md` item 8 asks for, and the lead's phone smoke passes.

---

## Report (written by the worker when done)

## Review (written by Claude)

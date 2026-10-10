---
id: T-1048
title: "Mock backend: every seeded group and channel gets its General topic in /chats, like the real server, so the mobile channel and group screens open"
status: todo
milestone: M5
branch: task/T-1048-mock-backend-group-general-topics
model: auto
effort: default
depends_on: [T-0949]
estimate: 0.25 day
---

# T-1048: General topics for every seeded group

## Spec (written by Claude, do not edit)

### Why
The real server gives every group entry in `GET /chats` its visible topics, General included (`apps/server/src/chats/api.ts:147`, `:152-163`).

The mock seed sets `topics` only for Dev team: `packages/mock-backend/src/domains/chats/seed.ts:34` uses `seedTopicViews()`. Every other group has none, Acme Announcements included (the channel at `:12-24`). Mobile's group route calls `router.back()` when a group has no topics (`apps/mobile/src/app/group/[id].tsx:189`), and needs a topic with `chatKind: 'channel'` to show the channel screen (`:198-202`). So in mock mode the Acme channel screen (info, admins, invite links) cannot be reached (lead, 2026-10-10, T-1041).

### What to build
1. **A General topic for every group entry** in `packages/mock-backend/src/domains/chats/seed.ts` that has no `topics` today (Acme Announcements, Viernes and the others).
   - The topic has the shape the real server builds: General, keeping the group's room `chatJid`, as the comment at `apps/server/src/chats/api.ts:50` says.
   - Build it from the same view type the topics domain uses (`packages/mock-backend/src/domains/topics/seed.ts`, `seedTopicViews` and `buildTopicView`).
   - Dev team keeps its 7 topics unchanged.
2. **The channel's topic:** for Acme, check what mobile reads to set `topic.chatKind`: the topic view itself, or the group entry's `chatKind: 'channel'`. Make the topic carry what the real server would send. Name the file:line you checked in the Report.
3. **No change outside `packages/mock-backend`.** Read the topics domain's builders, and touch only the chats seed (and a small helper in the chats folder if needed). T-1045 and T-1046 work in other domain folders of this package in parallel.
4. **Size:** keep every file under 400 lines.

Prove it in the Report with a throwaway script against `createMockBackend()`: `GET /chats`, decoded with the contract schema, listing each group's title with its topic count and the Acme topic's fields.

The lead then runs a phone smoke in mock mode: open the Acme channel screen, and open Viernes.

### Read first
`AGENTS.md`, `docs/audit/mock-plan.md`, `apps/server/src/chats/api.ts:120-170`, `packages/mock-backend/src/domains/chats/seed.ts`, `packages/mock-backend/src/domains/topics/seed.ts`, and `apps/mobile/src/app/group/[id].tsx:185-205`.

### Allowed files
`packages/mock-backend/src/domains/chats/seed.ts`, `packages/mock-backend/src/domains/chats/general-topics.ts`, `work/T-1048-mock-backend-group-general-topics.md`.

### Checks
```bash
pnpm --filter @zilar/mock-backend typecheck
pnpm gate
```

### Acceptance
- The Checks pass.
- The decoded `/chats` proof shows a General topic on every group, and 7 topics on Dev team.

---

## Report (written by the worker when done)

## Review (written by Claude)

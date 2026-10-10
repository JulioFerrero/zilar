---
id: T-1048
title: "Mock backend: every seeded group and channel gets its General topic in /chats, like the real server, so the mobile channel and group screens open"
status: merged
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

### What I did

- Added `packages/mock-backend/src/domains/chats/general-topics.ts`: builds one
  group's General topic as a live-shaped `MockTopic` row and runs it through the
  topics domain's `buildTopicView` (`../topics/view.ts`), so the row is the same
  `Topic` view the topics seed and the live routes produce. The row mirrors what
  the real server inserts on group create (`apps/server/src/groups/service.ts:160-171`):
  `name: 'General'`, `glyph: 'G'`, `kind: 'chat'`, `status: 'open'`,
  `visibility: 'public'`, `isGeneral: true`, `chatJid` = the group's room JID.
  `withGeneralTopic(entry)` returns the entry with `topics: [general]`.
- `packages/mock-backend/src/domains/chats/seed.ts`: wrapped Acme Announcements,
  Viernes, Familia, QA squad, Gym buddies and Product in `withGeneralTopic(...)`.
  Dev team keeps `topics: seedTopicViews()` (its 7 rows) unchanged, and all DMs
  are unchanged.
- The `/chats` route (`chats/routes.ts`) already rebuilds a group's topics from
  the live table and falls back to the entry's own `topics` when the table has
  none, so the seeded General is what `/chats` returns for these groups and a
  later topic edit still replaces it. No route change was needed.

### Point 2: what mobile reads for the channel

Mobile reads `ChatSummary.chatKind` — the top-level field on the topic's chat
row, not a field on the topic view. The shared mapper sets it from the group
entry's `chatKind`: `packages/client-core/src/store/chat-rows.ts:169-177` reads
`entry.chatKind`, and `:141-148` copies it onto every topic row of the group.
`apps/mobile/src/app/group/[id].tsx:198` then does
`topics.find((topic) => topic.chatKind === 'channel')`. The contract puts
`chatKind` only on `GroupChatEntry` (`packages/api-contract/src/chats.ts:46`);
the `Topic` view has none. So the General topic carries exactly the real
server's `TopicView` shape (no `chatKind`), and Acme's entry keeps its
`chatKind: 'channel'`; mobile finds the channel feed from the entry, as it does
against the real server.

### Files changed

- `packages/mock-backend/src/domains/chats/general-topics.ts` (new)
- `packages/mock-backend/src/domains/chats/seed.ts`
- `work/T-1048-mock-backend-group-general-topics.md` (this file)

### Proof (`createMockBackend()` → `GET /chats`, decoded with the contract)

A throwaway Vitest file (run from `@zilar/web`, which has `effect`, then
deleted) decoded `ChatList`, then each `ChatEntry` and each `Topic`:

```
Acme Announcements: 1 topics
Dev team: 7 topics
Viernes 🍻: 1 topics
Familia: 1 topics
QA squad: 1 topics
Gym buddies: 1 topics
Product: 1 topics
Acme General topic: {
  "id": "t-acme-general", "groupId": "g-acme", "name": "General", "glyph": "G",
  "chatJid": "acme@rooms.zilar.test", "visibility": "public", "kind": "chat",
  "status": "open", "owner": null, "linkUrl": null, "linkLabel": null,
  "isGeneral": true, "archived": false, "memberCount": 120, "ais": [],
  "roles": [], "approverRole": null
}
Test Files 1 passed (1); Tests 1 passed (1)
```

All 7 groups have a General topic; Dev team stays at 7 topics; the Acme topic
decodes as `isGeneral: true`, `chatJid` = the Acme room JID, `kind: 'chat'`.

### Commands run

- `pnpm --filter @zilar/mock-backend typecheck` → PASS (no output beyond tsc).
- proof (throwaway, since deleted):
  `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/__tmp-t1048-proof.test.ts`
  → 1 file passed, 1 test passed.
- `pnpm gate`:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (1.3s)
  PASS  lint  (0.9s)
  PASS  typecheck  (4.8s)
  PASS  effect  (1.5s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations

- None. No file outside the Allowed files was changed. The seeded General lives
  only in the `chats` seed, not the topics table; a group that later gets a live
  topic would have its General replaced by the live list. That matches the mock
  route's existing fallback and no seeded demo group creates topics.
- `memberCount` on the General topic comes from the group entry's `memberCount`
  (the number the entry shows), matching what a public General lists.

### Open questions

- None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit and 1 follow-up.**
- **The change:** a new `packages/mock-backend/src/domains/chats/general-topics.ts`. `withGeneralTopic` gives every seeded group except Dev team a General topic, built with the topics domain's `buildTopicView`. Dev team keeps its 7 topics.
- **The worker's check of point 2 is correct:** mobile takes `chatKind` from the group entry and copies it onto each topic row (`packages/client-core/src/store/chat-rows.ts:141-177`), so General needs no `chatKind` of its own.
- **The lead's phone smoke** (mock):
  - `zilar://group/g-acme` now opens the channel screen: title, 120 subscribers, the description, the feed card, and the members list with Demote on Ana and Promote on Luis;
  - Invite links opens the sheet ("No invite links yet."), and Create makes `····4f6c`, which Revoke marks revoked;
  - `zilar://group/g-viernes` opens with "5 members, 0 AIs, 1 topic", General.

  This is also the channel-screen smoke T-1041 could not run.
- **The follow-up (board):** the General rows live only in the `/chats` entry, so `GET /groups/:id/topics` still returns `[]` for those groups.
- **The nit:** General's member count (120) comes from the inflated chats seed, while the group detail lists 3 members. That predates this task.
- **Check:** the gate passed.

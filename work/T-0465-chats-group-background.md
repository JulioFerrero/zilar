---
id: T-0465
title: "Backgrounds G1 (server): GET /api/chats group entries carry the group background"
status: merged
milestone: M5
branch: task/T-0465-chats-group-background
model: auto
effort: low
depends_on: [T-0463]
estimate: 0.1 day
---

# T-0465: group background in the chat list

## Spec (written by Claude, do not edit)

### Why
This is the T-0463 pre-review follow-up. `listGroupsForUser` returns `background`, but `GET /api/chats` drops it, so clients cannot paint a group background from the chat list.

### Verified facts (do not re-derive)
- **`GroupBackground`:** `{ backgroundPreset, backgroundImageId, backgroundDim }`, all nullable, exported from `apps/server/src/groups/service.ts:64-68`. `ChatGroup.background: GroupBackground` is at line 120.
- **The group entry type:** `apps/server/src/chats/routes.ts:12-40` defines `ChatListEntry`. The group variant (from line 23) ends with `handle` and `topics`.
- **The group entries** are built at lines 102-123 from `listGroupsForUser`, with no `background`.
- **Tests:** `apps/server/src/chats/chats.test.ts`, under `describe('GET /api/chats')` (line 33).

### What to build
1. **`chats/routes.ts`:** add `background: GroupBackground` to the group variant of `ChatListEntry` (import the type), and set `background: group.background` on every group entry.
2. **`chats/chats.test.ts`:** one test. Set `groups.background_preset = 'navy'` on a group directly in the DB. That group's entry has `background: { backgroundPreset: 'navy', backgroundImageId: null, backgroundDim: null }`, and a group without one has all nulls.

### Read first
`AGENTS.md`, `apps/server/src/chats/routes.ts:1-130`, `apps/server/src/groups/service.ts:60-125`, `apps/server/src/chats/chats.test.ts:1-120`.

### Allowed files
`apps/server/src/chats/routes.ts`, `apps/server/src/chats/chats.test.ts`, `work/T-0465-chats-group-background.md`.

If any other test breaks (for example a test with an exact chat-entry `toEqual`), stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot chats/chats
pnpm gate
```

### Acceptance
- Every group entry in `GET /api/chats` has `background` with the three fields.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/chats/routes.ts`: imported `type GroupBackground` from `../groups/service`, added `background: GroupBackground` to the group variant of `ChatListEntry`, and set `background: group.background` on every group entry built from `listGroupsForUser`.
- `apps/server/src/chats/chats.test.ts`: added `background` to the local `ChatsBody` entry type and one test, "carries every group background in the chat list". It creates two groups, sets `groups.background_preset = 'navy'` on one directly with the DB, and asserts the painted group's entry has `{ backgroundPreset: 'navy', backgroundImageId: null, backgroundDim: null }` while the other has all three nulls.

### Files changed
- `apps/server/src/chats/routes.ts`
- `apps/server/src/chats/chats.test.ts`
- `work/T-0465-chats-group-background.md`

### Commands and results
- `pnpm install`: done, exit 0.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot chats/chats`: 1 file passed, 8 tests passed, exit 0.
- `pnpm gate`: exit 0, ended with `GATE PASS`. Summary lines:
  - `gate: 3 changed file(s) against main`
  - `PASS  install (frozen)  (2.9s)`
  - `PASS  format  (31.2s)`
  - `PASS  lint  (1.8s)`
  - `PASS  typecheck  (14.5s)`
  - `PASS  tests @zilar/server  (355.7s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Problems / deviations
- None. No other test broke; no exact `toEqual` on the whole chat entry existed.

### Open questions
- None.

## Review (written by Claude)

Approved (lead, 2026-10-07). Group entries in GET /api/chats now carry background (GroupBackground), with a test for set and unset. Pre-review clean.

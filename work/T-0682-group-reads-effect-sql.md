---
id: T-0682
title: "effect/sql: move the read helpers in groups/service.ts (getGroupDetail, getMembership, requireGroup, listGroupsForUser, listGroupMembers, listGroupAis, listMembersForViewer, assertContacts, resolveGroupBackground, removeGroupAi's pre-reads) onto effect/sql (groups slice 3)"
status: merged
milestone: M5
branch: task/T-0682-group-reads-effect-sql
model: auto
effort: low
depends_on: [T-0678]
estimate: 0.2 day
---

# T-0682: group reads on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. T-0670 and T-0678 moved the group-AI paths. This slice moves every plain read in `groups/service.ts`; the member writes and `createGroup` and `patchGroup` come later.

### Verified facts (do not re-derive)
- **`apps/server/src/groups/service.ts`** has a private `runSql` (line 42) and a `groupTopicRows` helper (T-0678). Copy their style. No read helper is ever called with a transaction (no `(tx` call in the file outside the `db.transaction` callbacks).
- **The reads to move, one drizzle statement each unless noted:**
  - `resolveGroupBackground` (line 221): `SELECT id FROM chat_backgrounds WHERE id AND user_id LIMIT 1`;
  - `getGroupDetail` (line 474): `SELECT * FROM groups WHERE id LIMIT 1`; the row's `createdAt` must stay a `Date`;
  - `getMembership` (line 528, exported; also used by `groups/api.ts:431`): `SELECT * FROM group_members WHERE group_id AND user_id LIMIT 1`;
  - `listMembersForViewer` (line 886): `SELECT * FROM groups WHERE id LIMIT 1`;
  - `removeGroupAi` (line 1064), its two reads before the transaction: the AI (`id, jid, owner` from `ais` where `id`, `LIMIT 1`) and the `group_ais` membership (`ai_id` where `group_id`, `ai_id`, `LIMIT 1`);
  - `listGroupsForUser` (line 1173), four reads:
    - memberships: `group_id, role` from `group_members` where `user_id`;
    - groups: the listed columns where `id IN`;
    - counts: `group_id, count(*)` grouped, where `group_id IN`; use `count(*)::int`, since the code already calls `Number(row.total)`;
    - handles: `group_id, handle` where `group_id IN`;
  - `listGroupMembers` (line 1244): `group_members` (`user_id`, `role`) join `"user"` (`name`), left join `handles ON handles.user_id = group_members.user_id` (`handle`), where `group_id`;
  - `listGroupAis` (line 1285): `group_ais` join `ais` (`ai_id`, `jid`, `name`, `owner AS owner_id`) where `group_id`;
  - `requireGroup` (line 1297): `SELECT * FROM groups WHERE id LIMIT 1`;
  - `assertContacts` (line 1307): `SELECT contact_user_id FROM contacts WHERE user_id AND contact_user_id IN`, guarded by the existing empty-list return.
- **The recipe:** result names are camelCased; write `"user"` quoted; lists go through `sql.in(list)` (the empty-list guards already exist); `SELECT *` gives the drizzle row shape, as in `topics/access.ts:95` `getTopic`.
- **Tests:** `apps/server/src/groups/*.test.ts`, `apps/server/src/topics/topics.test.ts`, `apps/server/src/chats/*.test.ts`.

### What to build
1. **Rewrite each listed statement** with `runSql`, keeping the same columns, joins, filters and JS post-processing, and every error and text.
2. **Change no write path.** `createGroup`, `patchGroup`'s update, `addGroupMembers`, `removeGroupMember`, `changeMemberRole`, `assertChannelKeepsAnAdmin` and `syncChannelVoice` stay as they are.
3. **Keep the drizzle imports** those functions still use.

### Read first
`AGENTS.md`, `apps/server/src/groups/service.ts` (lines 1-60, 215-260, 470-545, 880-915, 1060-1100, 1170-1340), `apps/server/src/topics/access.ts` (lines 85-105).

### Allowed files
`apps/server/src/groups/service.ts`, `work/T-0682-group-reads-effect-sql.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups src/chats
pnpm gate
```

### Acceptance
- The listed functions have no drizzle calls.
- The groups and chats tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What I did**
- Moved every listed read in `apps/server/src/groups/service.ts` onto `runSql` (the `effect/sql` client), with the same columns, joins, filters, JS post-processing, errors and texts:
  - `resolveGroupBackground`: `chat_backgrounds` id check.
  - `getGroupDetail`: `SELECT * FROM groups`.
  - `getMembership`: `SELECT * FROM group_members`.
  - `listMembersForViewer`: `SELECT * FROM groups`.
  - `removeGroupAi` pre-reads: the AI (`id, jid, owner`) and the `group_ais` membership, both before the transaction.
  - `listGroupsForUser`: four statements (memberships, groups `IN`, `count(*)::int ... GROUP BY`, handles `IN`). Empty-list guard kept.
  - `listGroupMembers`: `group_members` join `"user"` and left join `handles`.
  - `listGroupAis`: `group_ais` join `ais` (`owner AS owner_id`).
  - `requireGroup`: `SELECT * FROM groups`.
  - `assertContacts`: `contacts` `IN`, with `contact_user_id AS id` so the existing `row.id` code is unchanged.
- Added two row types next to `GroupRole`: `GroupRow = typeof groups.$inferSelect` and `GroupMemberRow = typeof groupMembers.$inferSelect`.
- Removed the imports the moved reads no longer used: `count` from drizzle, and `ais`, `chatBackgrounds`, `contacts`, `user` from the schema.
- No write path changed. `createGroup`, `patchGroup`, `addGroupMembers`, `removeGroupMember`, `changeMemberRole`, `assertChannelKeepsAnAdmin` and `syncChannelVoice` still use drizzle, as the spec says.
- Column names were checked against `apps/server/src/db/schema.ts` (`room_localpart`, `background_preset`, `background_image_id`, `background_dim`, `group_id`, `user_id`, `role`, `ai_id`, `jid`, `owner`, `contact_user_id`, `chat_backgrounds.user_id`, `"user".name`, `handles.handle`/`group_id`/`user_id`).
- Files changed: `apps/server/src/groups/service.ts` and this task file (status and Report only).

**Tests** (run one file at a time with `--maxWorkers=2 --reporter=dot`)
- `src/groups/groups.test.ts`: 56 passed, 0 failed.
- `src/groups/visibility.test.ts` and `src/chats/chats.test.ts`: 32 passed, 0 failed. The spec's single command `src/groups src/chats` was not run as one call; I ran the same files separately.
- `src/topics/topics.test.ts` (named in the spec's Tests line): 32 passed, 0 failed.
- None of these tests call `vi.mock`, so no test needed a change and none was edited.

**`pnpm gate`** (log kept outside the worktree; summary lines):
```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (14.9s)
PASS  lint  (0.9s)
PASS  typecheck  (3.5s)
PASS  tests @zilar/server  (25.1s)
scope: every changed file is inside the Allowed files
GATE PASS
```

**Problems / deviations**: none against the spec.

**Blocked / needs a decision**: none.

**Open questions**: none. One thing I did not assert directly: that `createdAt` is still a `Date` through `SELECT *` on the effect/sql client. The groups tests pass, but I did not add a check for the type.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 3.7 min). The lead reviewed the SQL directly: the same columns, joins (inner `"user"`, left `handles`), filters and `IN` lists behind the existing empty guards, with `count(*)::int`. The JS post-processing is unchanged, and `SELECT *` gives the drizzle row types. The groups and chats tests and the gate passed.

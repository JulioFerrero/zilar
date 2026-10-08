---
id: T-0686
title: "effect/sql: move the group member writes in groups/service.ts (addGroupMembers, removeGroupMember, changeMemberRole transactions; assertChannelKeepsAnAdmin, syncChannelVoice reads) onto effect/sql (groups slice 4)"
status: todo
milestone: M5
branch: task/T-0686-group-member-writes-effect-sql
model: auto
effort: low
depends_on: [T-0682]
estimate: 0.2 day
---

# T-0686: group member writes on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. After T-0682, `groups/service.ts` uses drizzle only in `createGroup` and `patchGroup` (slice 5, later) and in the member paths below.

### Verified facts (do not re-derive)
- **`apps/server/src/groups/service.ts`** has `runSql` (line 42) and already runs XMPP calls inside `sql.withTransaction` through `Effect.tryPromise({ try, catch: (error) => error })` (see `addGroupAi` and `removeGroupAi`), all under `try/catch` with `mapXmppError`. **Copy that shape.**
- **`addGroupMembers`** (line 552):
  - `SELECT user_id FROM group_members WHERE group_id`, and when there is something to add, `SELECT ai_id FROM group_ais WHERE group_id`;
  - the transaction: for each `userId`, `adminClient.setAffiliation(group.roomLocalpart, jidFor(localpartFor(userId), input.domain), 'member')`, in order; then one `INSERT INTO group_members (group_id, user_id, role)` for every new id, with `role = 'member'` (use `sql.insert(rows)`, as `apps/server/src/roles/service.ts:563` does).
- **`removeGroupMember`** (line 621), its transaction:
  1. `setAffiliation(…, 'none')`;
  2. `DELETE FROM group_members WHERE group_id AND user_id`;
  3. `SELECT id FROM topics WHERE group_id`;
  4. if there are ids, `DELETE FROM topic_members WHERE topic_id IN ids AND user_id`.
- **`changeMemberRole`** (line 760): its transaction is one statement, `UPDATE group_members SET role WHERE group_id AND user_id`, under `try/catch` with `mapXmppError`.
- **`assertChannelKeepsAnAdmin`** (line 871): `SELECT user_id, role FROM group_members WHERE group_id`.
- **`syncChannelVoice`** (line 930): `SELECT * FROM groups WHERE id LIMIT 1`, then `SELECT user_id, role FROM group_members WHERE group_id`.
- **The recipe:** camelCased result names, `sql.in(list)`, and `SELECT *` gives the drizzle row type.
- **Tests:** `apps/server/src/groups/*.test.ts` (members, roles, channels), `apps/server/src/topics/topics.test.ts`, `apps/server/src/roles/*.test.ts`.

### What to build
1. **Rewrite these five functions' drizzle statements** with `runSql`, keeping the same order and errors. The three transactions become `sql.withTransaction`, with the XMPP calls through `Effect.tryPromise` in the same positions.
2. **Leave `createGroup` and `patchGroup` alone,** and keep the drizzle imports they still need.

### Read first
`AGENTS.md`, `apps/server/src/groups/service.ts` (lines 1-60, 545-960, and `removeGroupAi` as the model), `apps/server/src/roles/service.ts` (lines 555-575).

### Allowed files
`apps/server/src/groups/service.ts`, `work/T-0686-group-member-writes-effect-sql.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups src/topics/topics.test src/roles
pnpm gate
```

### Acceptance
- The five functions have no drizzle calls.
- The groups, topics and roles tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

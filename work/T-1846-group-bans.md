---
id: T-1846
title: "SG-8: a member an owner/admin removes is banned from rejoining by themselves (public join and invite links answer the same 404 a private group or bad link does); an owner/admin adding them back lifts the ban; leaving by yourself never bans"
status: merged
milestone: M5
branch: task/T-1846-group-bans
model: auto
effort: default
depends_on: []
estimate: 40 min
---

# T-1846: Removed members can't rejoin on their own

## Spec (written by Claude, do not edit)

### Why
**Audit SG-8 is still `partly`** (`docs/audit/findings-sweep-server.md:27`): "no ban list — … `removeGroupMember` still just deletes the row, so a removed member can rejoin a public group or a still-valid link immediately." So a kicked spammer can walk straight back in.

**The fix works like Telegram:**
- a removal by an owner or admin bans;
- an owner or admin adding the person back unbans;
- leaving by yourself never bans.

No new UI is needed. **This is a DB-schema task.**

### Facts (read by the lead on 2026-10-17)
- **`apps/server/src/groups/members.ts`** (271 lines):
  - **`removeGroupMember`** (`:152-…`): `isSelf = input.actorId === input.targetUserId` (`:167`). A non-self removal needs owner or admin (`:168-170`). The transaction (`:183-213`) sets the ejabberd affiliation to `none`, deletes the `group_members` row and deletes the person's `topic_members` rows.
  - **`addGroupMembers`** (`:22-…`): owner or admin only (`:31-33`); `toAdd` (`:48`) is inserted at `:113`.
- **The public join** (`apps/server/src/groups/join.ts`, 198 lines): it refuses private or unknown groups with 404 `not_found` 'Group not found' (`:64-66`), and a block with the same 404 (`:67-73`). The insert is at `:126-130`.
- **The invite-link join** (`apps/server/src/invite-links/join.ts`, 290 lines): a block answers `toInvalidLink()` (`:106-109`); `isGroupMember` comes before it (`:110-112`); the insert is at `:149`.
- **Migrations:**
  - they are hand-written SQL in `apps/server/drizzle/`, and the latest is `0071_block-cards.sql`, which starts `SET lock_timeout = '5s';--> statement-breakpoint`;
  - row types live in `apps/server/src/db/rows.ts` (387 lines; `GroupMemberRow` at `:60-66`).
- **Tests:** `apps/server/src/invite-links/invite-links.test.ts`. The groups tests live in `apps/server/src/groups/*.test.ts`.

### Steps
1. **Migration `apps/server/drizzle/0072_group-bans.sql`:** start with `SET lock_timeout = '5s';--> statement-breakpoint`, then create table `group_bans`:
   - `group_id text NOT NULL REFERENCES groups(id) ON DELETE CASCADE`;
   - `user_id text NOT NULL`;
   - `banned_by text`;
   - `created_at timestamptz DEFAULT now() NOT NULL`;
   - `PRIMARY KEY (group_id, user_id)`.

   Read how `0071` and an older group migration name the `groups` table and the user id type before writing it.
2. **`apps/server/src/db/rows.ts`:** add `GroupBanRow`. If `rows.ts` would pass 400 lines, put it in a new `rows-groups.ts` instead (also Allowed).
3. **New `apps/server/src/groups/bans.ts`:** `isBanned(db, groupId, userId)` and the SQL fragments or helpers the other steps need.
4. **`removeGroupMember`:** when `!isSelf`, insert the ban row (`ON CONFLICT DO NOTHING`) inside the same transaction.
5. **`addGroupMembers`:** delete the ban rows for `toAdd` in the insert transaction, so adding someone back unbans them.
6. **The public join and the invite-link join:** a banned user gets the same refusal a block gets: 404 `not_found` for the public join, `toInvalidLink()` for links. It's never an oracle. Check this before the insert.
7. **Tests (permissions):** two cases in the existing test files.
   - **Removal:** an admin removes a member; that member's invite-link join is refused, and after the admin adds them back a link join works again (or the add succeeds and the ban row is gone).
   - **Self-leave:** someone who leaves by themselves can rejoin by link.

   Every source file stays at most 400 lines.

### Allowed files
- `apps/server/drizzle/0072_group-bans.sql`
- `apps/server/src/db/rows.ts`
- `apps/server/src/db/rows-groups.ts`
- `apps/server/src/groups/bans.ts`
- `apps/server/src/groups/members.ts`
- `apps/server/src/groups/join.ts`
- `apps/server/src/invite-links/join.ts`
- `apps/server/src/invite-links/invite-links.test.ts`
- `work/T-1846-group-bans.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/invite-links/invite-links.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **A member removed by an admin** can't rejoin through a public join or an invite link, and gets the usual 404.
- **Adding them back** works and lifts the ban.
- **Someone who left by themselves** can rejoin.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- Added migration `apps/server/drizzle/0072_group-bans.sql`: a `group_bans` table
  (`group_id` FK to `groups(id)` with `ON DELETE CASCADE`, `user_id`, nullable
  `banned_by`, `created_at`, PK `(group_id, user_id)`). Additive only, so it is safe
  for a rolling deploy.
- Added `GroupBanRow` to `apps/server/src/db/rows.ts` (the file is 395 lines).
- New `apps/server/src/groups/bans.ts`: `isBanned` (standalone query), `isBannedIn`
  (the same check on a caller's transaction connection), `banMember` (idempotent
  insert) and `unbanMembers` (scoped delete by group and user ids).
- `removeGroupMember`: when the actor is not the target, the same transaction that
  deletes the member row also inserts the ban. A self-leave never bans.
- `addGroupMembers`: the insert transaction deletes the ban rows of the people it
  adds, so adding someone back unbans them; a failed add rolls the lift back too.
- Public join (`groups/join.ts`): a banned user gets the same 404 `not_found`
  'Group not found' as a private/unknown group. The check runs with the block check
  before the pre-checks and again inside the transaction under the per-group
  advisory lock, before the insert.
- Invite-link join (`invite-links/join.ts`): a banned user gets `toInvalidLink()`
  (404 `invalid_link`), before any use is claimed, and again inside the transaction
  before the claim/insert.
- Two tests in `apps/server/src/invite-links/invite-links.test.ts`:
  - an owner removes a member (public group + link): public join 404 `not_found`,
    link join 404 `invalid_link` with `uses` still 0, the `group_bans` row is gone
    after `addGroupMembers`, then the link join answers 200 `alreadyMember: true`;
  - someone who leaves by themselves leaves no ban row and rejoins by link (200,
    `alreadyMember: false`).

### Checks run

- `pnpm install` (worktree setup): done, no errors.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/invite-links/invite-links.test.ts`
  → 1 file passed, 24 tests passed.
- `pnpm gate` (repo root) → GATE PASS, with these summary lines:
  - `gate: 8 changed file(s) against main`
  - `PASS  install (frozen)`, `PASS  format`, `PASS  lint`, `PASS  typecheck`,
    `PASS  effect`, `PASS  tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`

### Notes for the lead

- The removal test calls `removeGroupMember` / `addGroupMembers` directly (like the
  existing groups tests) and exercises both refusal paths over HTTP; the
  self-leave test also removes through the service so `actorId === targetUserId`
  is covered.
- The ban is re-checked inside both join transactions, so a removal that commits
  after the pre-check still refuses the join and a link use is never consumed.
- `previewInviteLink` was left unchanged: it only shows the title and member count
  and is not a way into the group; the spec asked for the join only.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `6a433c293`.
- **Read in full:**
  - migration `0072_group-bans.sql` (lock timeout; `groups` FK with cascade; a composite primary key);
  - `groups/bans.ts`.
- **The behaviour:**
  - a ban lands in the removal's transaction (owner or admin, not yourself), and adding someone back lifts it in the add's transaction;
  - both joins re-check the ban inside their transaction and answer the same 404 a block does;
  - the permission tests cover remove → refused → re-add, and leave → rejoin.
- **Nits accepted:**
  - the unused `GroupBanRow`;
  - the test removes via the owner, which takes the same branch as an admin;
  - a rare concurrent add/remove can leave a member with a ban row, which only matters if they leave and try to rejoin.
- **After the deploy,** the lead checks that `group_bans` exists on live.


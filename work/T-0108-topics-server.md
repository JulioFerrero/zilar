---
id: T-0108
title: Topics (server): each group is a list of topics, public or private, one XMPP room per topic
status: merged
milestone: M5
branch: task/T-0108-topics-server
model: meta/muse-spark-1.3-contributor
depends_on: []
estimate: 2 days
---

# T-0108: Topics, server side

## Spec (written by Claude, do not edit)

### Why
Decisions D25, D26 and D29 in `docs/PROJECT_PLAN.md` (Julio, 2026-09-29). Telegram forum mode with Discord-style access: a group is a list of **topics**; each topic is its own conversation with its own history and unread count; a topic is **public** (every group member) or **private** (only chosen people); a private topic is **hidden completely** from everyone else; every topic carries a thin **task strip** (type, status, owner, link). The mockup is the Claude artifact "Galena Topics Mockup" (https://claude.ai/artifact/YKvuBAcmXzRdiyx83eppSd): read it if you can; the text below is the contract.

**The design rule that matters most: every topic is its own XMPP MUC room.** One room per group could not keep a private topic private (every room member receives every message). With one members-only room per topic, ejabberd itself refuses to deliver a private topic to anyone who is not in it. Our database owns *who may see what* and syncs it into the rooms.

### Decisions already made (do not change; raise doubts in the Report)
- The group's **existing room becomes its "General" topic** (same room, same history). Every group has exactly one General topic, always public, can be renamed but not archived, not made private.
- Group owner/admin do **not** automatically see private topics they were not added to (Julio's privacy expectation for things like hiring or HR). They can create private topics and add people. If a private topic ends up with no members it is archived.
- AIs are **not** added to new topics automatically (T-0109 adds AIs to topics). In this task, group AIs keep working in General exactly as today.
- Unread counts stay client-side (as now); nothing to build for them here beyond exposing each topic as its own chat with its own room JID.

### Data model (`apps/server/src/db/schema.ts`; migrations only via `pnpm --filter @galena/server db:generate`, never `npx`; the backfill via `pnpm --filter @galena/server exec drizzle-kit generate --custom --name=general-topics`)
- `topics`: `id` (uuid text), `group_id` (fk cascade), `name` (1–80 chars, no control characters), `glyph` (1–2 chars, default the first letter of the name, uppercased), `room_localpart` (unique), `visibility` (`public` | `private`), `kind` (`chat` | `task` | `bug` | `ui` | `routine`, default `chat`), `status` (`open` | `in_progress` | `in_review` | `blocked` | `done`, default `open`), `owner_user_id` (fk user, nullable, on delete set null), `owner_ai_id` (fk ais, nullable, on delete set null; at most one of the two owners is set), `link_url` (https URL ≤ 300, nullable), `link_label` (≤ 40, nullable), `is_general` (bool), `archived_at` (nullable), `created_by` (fk user), `created_at`, `updated_at`. Partial unique index on `(group_id, lower(name))` where `archived_at is null`; partial unique index on `(group_id)` where `is_general`.
- `topic_members`: `topic_id` (fk cascade), `user_id` (fk cascade), `added_by`, `added_at`, pk `(topic_id, user_id)`. Rows exist **only for private topics**; a public topic's members are all group members (no rows).
- `groups.members_can_create_topics` (bool, default false).
- **Backfill** (the custom migration): one General topic per existing group (`room_localpart = groups.room_localpart`, `name = 'General'`, `visibility = 'public'`, `is_general = true`, `created_by = groups.created_by`). `createGroup` creates the General topic in the same transaction as the group.

### Room sync (`apps/server/src/topics/rooms.ts`)
One function decides who belongs in a topic's room and one applies it:
- `desiredMembers(topic)`: public → all `group_members` of the group; private → its `topic_members`. The group owner is the room's `owner` affiliation for General; for other topics the topic creator is `owner` (if they are still allowed), everyone else `member`.
- `syncTopicRoom(deps, topic)`: read the room's current affiliations (`EjabberdAdminClient`; add `getRoomAffiliations` to `xmpp/admin-client.ts` only if it is not there, mirroring the existing methods and their fake), set the missing ones (then a direct invitation to newly added users, like `inviteNewMembers`), and set `none` for anyone who should no longer be there (in a members-only room this removes them from the room). Idempotent; failures are logged by class name only and reported to the caller so a route can answer 502 instead of leaving the database and the room disagreeing silently.
- Creating a topic: DB row + `createRoom` (members-only, persistent, MAM on, non-anonymous, exactly like `createGroup`) + `syncTopicRoom`; on any failure destroy the room and roll the row back (same pattern as `createGroup`).
- Group membership changes (`groups/service.ts`: add members, remove member, member leaves) call the sync for **every** topic of the group (public topics gain/lose the person; a removed person also loses their `topic_members` rows). Keep those calls inside the existing flows; do not change their signatures more than needed.

### Access rules (`apps/server/src/topics/access.ts`, used by every later task)
- `canSeeTopic(db, topicId, userId)`: the topic is not deleted, the user is a group member, and the topic is public or the user is in `topic_members`.
- `visibleTopics(db, groupId, userId)`.
- **Manage** a topic (rename, kind, visibility, archive, members): the creator, or a group owner/admin who can also **see** it. **Edit the task strip** (status, owner, link, kind): anyone who can see the topic.
- **Create** a topic: group owner/admin always; plain members only if `members_can_create_topics`. Creating a private topic requires the same permission; the creator is always a member of it.
- A user who cannot see a topic gets the same 404 as for a missing id, everywhere.

### Routes (`apps/server/src/topics/routes.ts`, mounted under `/api`)
- `GET /api/groups/:id/topics` → visible topics, each `{ id, groupId, name, glyph, chatJid, visibility, kind, status, owner: { kind: 'user' | 'ai', id, name } | null, linkUrl, linkLabel, isGeneral, archived, memberCount }`. `chatJid` is `<room_localpart>@<mucDomain>`.
- `POST /api/groups/:id/topics` `{ name, kind?, visibility?, memberIds? (private only, group members), glyph?, owner?, linkUrl?, linkLabel? }` → 201 with the topic.
- `GET /api/topics/:id`, `PATCH /api/topics/:id` `{ name?, glyph?, kind?, status?, owner?, linkUrl?, linkLabel?, archived?, visibility?, confirmExposeHistory? }`. Changing `private → public` **exposes the topic's history** to every group member: refuse with 400 `confirmation_required` unless `confirmExposeHistory: true`. `public → private` needs `memberIds` in the same PATCH, which must include the acting manager. General: name/glyph/strip fields only.
- `GET /api/topics/:id/members` (visible; for public topics the group members), `POST /api/topics/:id/members` `{ userId }`, `DELETE /api/topics/:id/members/:userId` (manager, or a member removing themselves); private only (400 `not_private` for public). Only group members can be added. Removing the last member archives the topic.
- `PATCH /api/groups/:id` (the existing groups route file) accepts `membersCanCreateTopics` from group owner/admin.
- `GET /api/chats`: each `group` entry gains `topics: [...]` (the same visible shape, archived excluded) and keeps `chatJid` = the General room. Old clients ignore the extra field.
- Owner names come from the user/AI tables; never return e-mail addresses.
- Audit (existing recorder): `topic.created`, `topic.updated`, `topic.archived`, `topic.member_added`, `topic.member_removed`, `topic.visibility_changed`. **Detail never contains the topic name for a private topic** (ids and counts only), and the group Activity read route (`audit` routes used by `GroupPanel`) must **not return topic entries of private topics to a viewer who cannot see that topic**.
- Rate limit: creating topics 30 per hour per user.

### Read first
- `AGENTS.md`; `docs/PROJECT_PLAN.md` D25–D29 and §6.1–6.3; the mockup artifact.
- `apps/server/src/groups/service.ts` (`createGroup`, add/remove members, `removeGroupAi`, `inviteNewMembers`, `destroyQuietly`), `groups/routes.ts`, `chats/routes.ts`, `xmpp/admin-client.ts` and its fake in `test-support.ts` / `groups.test.ts`, `db/schema.ts` (`groups`, `groupMembers`, `groupAis`), the audit recorder and its group-activity read route, `authz-sweep.test.ts`.
- `docs/LEAD_PLAYBOOK.md` gotchas about drizzle migrations and PGlite tests.

### Allowed files
- `apps/server/src/topics/**` (new), `apps/server/src/db/schema.ts` + generated migrations and meta
- `apps/server/src/groups/**`, `apps/server/src/chats/**`, `apps/server/src/xmpp/admin-client.ts` (+ fake), `apps/server/src/test-support.ts`
- `apps/server/src/audit/**` (action names and the private-topic filter), `apps/server/src/app.ts`, `authz-sweep.test.ts`
- `docs/SERVER_CONFIG.md` (a short "Topics" note)
- `work/T-0108-topics-server.md`

**Not allowed:** web, mobile, packages, the agent gateway and actions (T-0109/T-0110), dependencies.

### Tests (Vitest, PGlite, the fake admin client; no network)
- Migration backfill: two groups created before the migration each get one General topic with the group's room localpart.
- Create/patch/archive/members through HTTP with the rules above; every 404 for a stranger is byte-identical to a missing id; a group admin who is not in a private topic gets 404 on it and does not see it in the list or in `GET /api/chats`.
- Room sync with the fake: public topic room gets all members; adding a member to the group adds them to every public topic room and none of the private ones; removing a member removes them from every topic room and deletes their `topic_members` rows; private membership changes call the right affiliation operations; a failing admin client makes the route answer 502 and leaves no half-created topic (row and room both gone).
- Visibility change private→public without the confirmation → 400; with it, everyone in the group is synced in.
- General cannot be archived or made private; last private member leaving archives the topic.
- Strip edits: any visible member; name/visibility: creator or a group admin who can see it; a plain member creating a topic when `members_can_create_topics` is off → 403.
- Audit: no private topic name in any audit row; the group activity route hides those entries from a non-member admin.
- The authz sweep covers every new route.

### Acceptance criteria
- [ ] A private topic's messages can only reach its members (proved with the fake by asserting the room's desired members), and it is invisible in every API to everyone else, including group admins who were not added.
- [ ] Existing groups keep working: their room is now the General topic, `/api/chats` still returns the same `chatJid`.
- [ ] Database and rooms never silently disagree (failures roll back or answer 502).
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint re-run after your last edit.

### Checks (all must pass; run the full server suite once, at the end, with `--maxWorkers=2`)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/server test -- --maxWorkers=2
pnpm build
```

### Out of scope
- AIs in topics (T-0109), topic-scoped approvals/rules/tools (T-0110), all UI (T-0111), roles (T-0116), unread counts on the server, hard delete of topics, usage or cost tracking.

---

## Report (written by the worker when done)

### What I did
- Schema: added `topics` and `topic_members` tables, `groups.members_can_create_topics` (default false), partial unique indexes `(group_id, lower(name))` active-only and `(group_id)` General-only. Migration `0018_lethal_warhawk.sql` via `db:generate`; custom backfill `0019_general-topics.sql` inserts one General topic per group (`room_localpart` copied, deterministic md5 id, `ON CONFLICT DO NOTHING`).
- `topics/access.ts`: `canSeeTopic`/`canSeeTopicById`/`requireVisibleTopic`, `visibleTopics`, `canManageTopic`/`requireManagedTopic` (creator or group owner/admin who can see it), `canCreateTopic` (owner/admin always, members if flag), same-404 rule, `toTopicView(s)` (chatJid, owner names from user/AI tables, never e-mail, memberCount).
- `topics/rooms.ts`: `desiredMembers` (public → all group members; private → topic_members∩group; General → group owner is room owner, other topics → creator is owner) and idempotent `syncTopicRoom` (diff affiliations, invite new, `none` for removed; failures logged by class name, rethrown as 502/503). `getAffiliations` already existed on the admin client, so no change there.
- `topics/service.ts`: create (DB row + `createRoom` + sync; any failure destroys room and deletes row), patch (strip open to visible members; name/glyph/visibility/archive need manager; private→public needs `confirmExposeHistory`, public→private needs `memberIds` incl. manager; General guards), members (private only, group-members only; self-leave or manager; last member archives), audit `topic.created/updated/archived/member_added/member_removed/visibility_changed` with no private name in detail.
- `groups/service.ts`: `createGroup` inserts General in the same transaction; add/remove member syncs every active topic room (remove also deletes `topic_members` rows and archives drained private topics); new `patchGroup` (`membersCanCreateTopics`, owner/admin only); `GroupDetail` gains the flag.
- Routes: `topics/routes.ts` mounted in `app.ts` (`GET/POST /api/groups/:id/topics`, `GET/PATCH /api/topics/:id`, `POST /api/topics/:id/archive`, member routes); `PATCH /api/groups/:id`; `GET /api/chats` group entries gain `topics` (General keeps `chatJid`). Rate limit 30/hour/user on creation. `test-support.ts` fake now tracks affiliation state and supports read failures. Audit group-activity route filters private-topic entries the viewer cannot see. `docs/SERVER_CONFIG.md` Topics note.

### Files changed
- `apps/server/src/db/schema.ts`, `apps/server/drizzle/0018_lethal_warhawk.sql`, `apps/server/drizzle/0019_general-topics.sql` (+ meta snapshots/journal)
- `apps/server/src/topics/access.ts`, `rooms.ts`, `service.ts`, `routes.ts`, `topics.test.ts` (20 tests), `backfill.test.ts` (1 test)
- `apps/server/src/groups/service.ts`, `apps/server/src/groups/routes.ts`, `apps/server/src/chats/routes.ts`, `apps/server/src/audit/service.ts`, `apps/server/src/app.ts`, `apps/server/src/test-support.ts`
- `docs/SERVER_CONFIG.md`, `work/T-0108-topics-server.md`

### Commands run and real results
- `pnpm install`: pass (7.1s)
- `pnpm format:check`: pass ("All matched files use Prettier code style!")
- `pnpm lint`: pass (oxlint clean; rewrote a control-char regex as a code-point loop, no disables)
- `pnpm typecheck`: pass (turbo 10/10)
- `pnpm --filter @galena/server test --maxWorkers=2`: 64 files passed, 5 skipped; 1093 passed, 7 skipped (269s). Note: the first attempt used the wrong `-- --maxWorkers=2` form and was killed by the lead; re-ran once with the correct form, alone.
- `pnpm build`: pass (2/2 turbo tasks)
- Scoped: `src/topics` 21 passed; `groups.test.ts`+`chats.test.ts` 35 passed; `audit/routes`+`authz-sweep` 16 passed.
- `grep` for `eslint-disable|oxlint-disable|@ts-ignore|console.log|: any` in all touched source: no hits.

### Problems, deviations from the spec, open questions
- Spec says `glyph` is "1–2 chars"; zod counts UTF-16 units, so I capped the raw string at 8 units and enforced 1–2 code points. Emoji glyphs work.
- `POST /api/topics/:id/archive` added as a convenience; archiving also works via `PATCH { archived: true }`. Both need a manager (creator or group admin who can see it).
- Archived topics are invisible to everyone (404 + excluded from lists), stricter than "archived excluded from chats" only; re-creating the name is allowed. No hard delete (out of scope).
- `DELETE .../members/:userId` on the last private member archives and answers 404 (topic gone). Chose 404 over 200+archived so it matches "invisible everywhere".
- Group add/remove member room sync is best-effort post-commit (logged, never throws): the DB stays the source of truth and the next change retries. Topic routes answer 502 instead when sync fails, and creation rolls back row+room.
- Audit `subjectId` for member add/remove is the topic id (action regex requires dotted `topic.*`, `argsHash` pattern rejects user ids); the affected user sits in `detail.subjectUserId`. Group-activity pagination over-fetches 2x to absorb filtered rows; the cursor still advances.
- Backfill test replays migrations 0000–0019 from SQL text on a blank PGlite (two pre-existing groups) instead of snapshotting prod data; `topics.test.ts` covers General-on-create.
- No `any`, no disables, no new dependencies.

### Blocked / needs a decision
- None.

### Round 2 (review fixes)
- Fix 1: `RemoveGroupMemberInput` gains `logger: InviteLogger`; `groups/routes.ts` passes the real route logger; both `addGroupMembers` and `removeGroupMember` pass it into `syncGroupTopicRooms`. `silentLogger` deleted; the catch logs `could not sync a topic room after a group membership change` with `{ groupId }` (never a topic name). Sync stays best-effort, no rollback. New test in `groups.test.ts` (`TopicRoomsDownClient` fails room writes except the group room): removal answers 200, the DB row is gone, and the log contains the warning.
- Fix 2: `removeTopicMember` runs `syncTopicRoom` on the archived topic before returning (desired members now empty, everyone removed), same 502 handling as the other branch. Extended the last-member test: the room's affiliation map is empty afterwards.
- Fix 3: `'bad name'` control byte rewritten as `'bad\u0007name'`; `topics.test.ts` is plain ASCII and diffs as text.
- Small suggestion applied: `mapXmppError` in `topics/service.ts` maps `code 23505` to 409 `topic_exists` (precise Postgres unique-violation code, same under PGlite).
- Checks (correct form, one run at a time): scoped topics+groups 49 passed; format/lint/typecheck/build pass; full server suite 64 files passed, 5 skipped — 1094 passed, 7 skipped. No disables, no `any` (grep clean).

---

## Review (written by Claude)

**Verdict:** Approved and merged after one round of fixes.

### Findings
- Design matches the spec: one members-only room per topic, DB-owned visibility, same 404 for missing and hidden topics, private topic names never in audit rows, group owners and admins do not see private topics they were not added to. Migration `0018` (generated) and `0019` (idempotent General backfill) read correctly.
- Fixed after review: (1) removing a group member synced topic rooms with a silent logger, so a failed room call was invisible; the real logger is now passed and the failure is logged with the group id. (2) the last member leaving a private topic archived it without removing their room affiliation; the room is now synced empty. (3) a raw control byte in a test made git treat the file as binary. (4) a unique-index race on the topic name answered 503; it now answers 409.
- Lead cleanup: removed three unused exported functions the pre-review found (`syncGroupTopics`, `removeGroupMemberTopics`, `archiveEmptyPrivateTopics`); `archived` in PATCH is now `true` only (un-archiving was an unreachable path).
- Checks re-run by the lead: format, lint, typecheck pass; server suite 64 files passed, 1094 tests passed, 7 skipped (227 s, `--maxWorkers=2`).

### Follow-ups
- Room membership can drift if a room call fails after a group membership change (the sync is best effort and logged). A reconcile pass for topic rooms is worth adding (T-0109 or a small task).
- `GET /api/chats` and the topic list do per-topic count and owner lookups (N+1); fine now, batch later.
- A topic owner AI is only checked to exist, not to be in the group; T-0109 (topic AIs) should tighten this.
- Error bodies carry a request id, so 404s are identical in code and message but not byte for byte (pre-existing global behaviour).

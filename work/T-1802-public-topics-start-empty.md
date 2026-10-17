---
id: T-1802
title: "Flip PUBLIC_TOPICS_START_EMPTY to true: a new public topic starts with its creator only and a new group member joins no public topic (the Join UI W9/W10 has shipped)"
status: merged
milestone: M5
branch: task/T-1802-public-topics-start-empty
model: auto
effort: default
depends_on: [T-1797, T-1798]
estimate: 15 min
---

# T-1802: Public topics start empty

## Spec (written by Claude, do not edit)

### Why
Julio's rule (2026-10-16, `docs/design/mockups/topic-people/README.md` "Round 2") is that a public topic includes nobody until people join; General stays everyone. The reads already follow it (T-1757). The writes were held back by a switch until the Join UI shipped. W9 (T-1797, web) and W10 (T-1798, phone) ship it, so the switch flips now.

Existing topics keep their members, since their rows were backfilled. Only new topics and new group members change.

### Facts (read by the lead on 2026-10-17)
- `apps/server/src/topics/public-compat.ts:14`: `export const PUBLIC_TOPICS_START_EMPTY = false;`. The comment at `:6-13` says the Join UI batch sets it to `true`.
- It is the default for `initialPublicMemberIds(db, groupId, creatorId, startEmpty)` (`:19-37`) and `addToPublicTopics(db, groupId, userIds, startEmpty)` (`:45-66`).
- Its callers are `apps/server/src/topics/service.ts`, `apps/server/src/groups/join.ts`, `apps/server/src/groups/members.ts` and `apps/server/src/invite-links/join.ts`.
- `apps/server/src/topics/public-members.test.ts:94-95` passes the flag explicitly, so it doesn't depend on the default.

### Steps
1. Set `PUBLIC_TOPICS_START_EMPTY = true`. Rewrite the comment at `:6-13` to say the Join UI has shipped (T-1797, T-1798) and what the flag now does.
2. Run the topic and group tests that touch these paths. Fix only expectations that assumed the old default (a new member landing in public topics, or a new public topic holding the whole group), and say which in the Report. Change no other behaviour.
3. Keep every file at most 400 lines.

### Allowed files
- `apps/server/src/topics/public-compat.ts`
- `apps/server/src/topics/public-members.test.ts`
- `apps/server/src/topics/service.test.ts`
- `apps/server/src/groups/join.test.ts`
- `apps/server/src/groups/members.test.ts`
- `apps/server/src/invite-links/join.test.ts`
- `apps/server/src/topics/join-leave.test.ts`
- `apps/server/src/topics/public-reads.test.ts`
- `apps/server/src/invite-links/invite-links.test.ts`
- `work/T-1802-public-topics-start-empty.md`

### Checks
```bash
cd apps/server && pnpm exec vitest run src/topics/public-members.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- A new public topic holds only its creator.
- A person who joins a group joins no public topic.
- General is unchanged.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- `apps/server/src/topics/public-compat.ts`: set `PUBLIC_TOPICS_START_EMPTY = true` and rewrote the comment at the old `:6-13` to say the Join UI has shipped (web W9 in T-1797, phone W10 in T-1798) and what the flag now does: a new public topic starts with only its creator, a new group member joins no public topic, and existing topics keep their backfilled members. No other production behaviour changed.
- `apps/server/src/topics/public-members.test.ts`: fixed the two expectations that assumed the old default. "starts a public topic with only its creator" now expects `[owner]`, and "does not add a new group member to public or private topics" now expects the public topic to stay `[owner]`; the private assertion was already correct. The test that passes `startEmpty` explicitly still covers the old path.
- `apps/server/src/topics/join-leave.test.ts`: the refused-removal test now has `member` join the topic first, so the 403 still protects a real member; removed the stale T-1762 comments and the now-unused `deleteTopicMember` helper (its delete had become a no-op).
- `apps/server/src/topics/public-reads.test.ts`: `seedPublicTopic` now adds `joined` with the existing `addTopicMember` helper instead of relying on `createTopic` seeding the whole group; removed the two `removeTopicMember` calls, the unused helper and the stale T-1762 comment.
- `apps/server/src/invite-links/invite-links.test.ts`: the "Side" topic is private and gets a third group user as a real member, so the join's topic sync still makes a failing affiliation call. Deviation from the lead's suggested `memberIds`: creating the topic with `memberIds` syncs its room immediately, so the join sync has nothing left to write and cannot fail. Instead the user is inserted into `group_members` and then the `topic_members` row is inserted after the room was created, leaving the room behind its rows; the join then sets that affiliation and hits the failing client. The test still asserts the 200 and the committed membership.
- Files under 400 lines except `invite-links.test.ts`, which was already 1002 lines before this task (now 1016); I did not split it because that is outside this task.

### Checks run

```bash
cd apps/server && pnpm exec vitest run src/topics src/groups src/invite-links --reporter=dot --maxWorkers=2
# Test Files  17 passed (17)
# Tests  97 passed (97)

pnpm gate
# PASS  install (frozen)  (2.0s)
# PASS  format  (1.0s)
# PASS  lint  (0.8s)
# PASS  typecheck  (3.1s)
# PASS  effect  (0.6s)
# PASS  tests @zilar/server  (23.0s)
# scope: every changed file is inside the Allowed files
# migration: every added migration continues from the base
# images: every workspace package an app image needs is copied into its Dockerfile
# GATE PASS
```

I added `--maxWorkers=2` to the targeted run, per AGENTS.md's shared-machine rule. Before that run I also ran each file alone: `public-members` 5 passed, `join-leave` 5 passed, `public-reads` 4 passed, `invite-links` 22 passed.

`apps/server/src/topics/service.test.ts`, `apps/server/src/groups/join.test.ts`, `apps/server/src/groups/members.test.ts` and `apps/server/src/invite-links/join.test.ts` from Allowed files do not exist on this branch, so they could not be run; the real tests covering those paths are the ones fixed above.

### Notes for the lead

- Commits on the branch: one for the flag + `public-members`, then one per affected test file.
- The invite-links test needed a stale room, not just a member, because under the new default an invite join adds no topic membership and every room is otherwise already in sync.
- Security checklist: no new route, write, log line, secret or URL; the change only alters which `topic_members` rows a new topic/member gets.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `31b65b103`.
- **`PUBLIC_TOPICS_START_EMPTY = true`**, per Julio's 10-16 decision ("new public topics start empty"). W9 (T-1797) and W10 (T-1798) are merged.
- **The three stale tests** were reworked under the lead's scope widening, and each keeps its intent:
  - a real member joins before the refused removal;
  - `seedPublicTopic` adds the joined member;
  - "Side" has a real member, so the room sync failure is still exercised.
- Membership only shrinks for new topics and new members; existing rows stay.
- **Nits left:** two helper comments in `public-compat.ts` still say "until the Join UI ships"; `invite-links.test.ts` was already over 400 lines (tests are exempt).
- **Live check after the deploy:** create a public topic and check that only the creator is in it.

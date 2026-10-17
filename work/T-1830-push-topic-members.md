---
id: T-1830
title: "Push only to a topic's members: a message in a non-General topic no longer notifies group members who haven't joined it (public topics today; private ones are already hidden by canSeeTopic)"
status: merged
milestone: M5
branch: task/T-1830-push-topic-members
model: auto
effort: default
depends_on: [T-1829]
estimate: 25 min
---

# T-1830: Push only to a topic's members

## Spec (written by Claude, do not edit)

### Why
Since T-1802 a public topic has its own members, and T-1829 keeps a topic you haven't joined out of your list and unread counts. Push still notifies every group member:
- `memberIdsForTopic` reads all `group_members` of the topic's group (`apps/server/src/push/group-notifier.ts:86-96`);
- `resolveCandidate` only re-checks `canSeeTopic` (`apps/server/src/push/candidates.ts:90-95`), which a public topic passes for any group member.

So a group member gets pushes from public topics they never joined.

### Facts (read by the lead on 2026-10-17)
- **`apps/server/src/push/candidates.ts`** (235 lines), in `resolveCandidate`:
  - it loads the topic (`:79-89`);
  - then `if (!(await canSeeTopic(deps.db, topic, userId))) { return { status: 'hidden' }; }` (`:93-95`).
  - The same function serves the group notifier (`push/group-notifier.ts:147`), the notification preview route (`push/api-handlers.ts:188`) and the archive scan (`push/archive-scan.ts:100`).
- **`isTopicMember(db, topicId, userId)`** (`apps/server/src/topics/access.ts:106-115`): a `topic_members` row or a role on the topic.
- **`apps/server/src/push/candidates.test.ts`** (527 lines): the private-topic case is at `:273-306`, and other topic cases follow (`:307`, `:321`).

### Steps
1. **In `resolveCandidate`,** right after the `canSeeTopic` check: when `!topic.isGeneral && !(await isTopicMember(deps.db, topic.id, userId))`, return `{ status: 'hidden' }`. General keeps every group member. Update the comment.
2. **One test in `candidates.test.ts`:** in a public topic, a group member without a `topic_members` row is `hidden`, and a joined member is `ok`.
   - Existing topic tests that relied on group membership alone get an `addTopicMember` call in their setup. Change no assertion meaning.
3. **If `group-notifier.test.ts` relies on the old behaviour,** add topic members to its fixtures the same way.

### Allowed files
- `apps/server/src/push/candidates.ts`
- `apps/server/src/push/candidates.test.ts`
- `apps/server/src/push/group-notifier.test.ts`
- `work/T-1830-push-topic-members.md`

### Checks
```bash
cd apps/server && pnpm exec vitest run src/push/candidates.test.ts src/push/group-notifier.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- A non-General topic's message notifies only its members (direct or by role).
- General still notifies the whole group.
- The tests pass, and the gate passes.

---

## Report (written by the worker when done)

### What I did

- In `apps/server/src/push/candidates.ts`, `resolveRoomCandidate` now applies a
  membership gate after the `canSeeTopic` check: when the topic is not General and
  the user has neither a `topic_members` row nor a role on the topic
  (`isTopicMember`), the verdict is `hidden`. General keeps notifying every group
  member; private topics keep their existing `canSeeTopic` behaviour, so a private
  topic still hides both non-members and non-joiners with the same `hidden`.
- In `apps/server/src/push/candidates.test.ts` I added the test "hides a public
  topic from a group member who has not joined it": a group member without a
  `topic_members` row resolves `hidden`, a joined member resolves `ok`.
- Existing room tests that relied on group membership alone now call the existing
  `addTopicMember` helper in their setup: "skips a room message from the user",
  "mutes a topic through its group General mute", "notifies a topic once its group
  General mute has expired" and "marks a channel room as a channel and carries it
  in the native wake". No assertion changed meaning; the private-topic test already
  had its member seeded.
- `apps/server/src/push/group-notifier.test.ts` needed no change: its fixtures only
  seed the group's General topic, which the new gate lets through unchanged.

### Checks run

- `pnpm install --frozen-lockfile` — Done in 12s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/candidates.test.ts src/push/group-notifier.test.ts` — 2 files passed, 21 tests passed.
- `pnpm gate` (repo root) — summary:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (0.7s)
  PASS  lint  (1.5s)
  PASS  typecheck  (3.6s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/server  (7.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- Only `candidates.ts` and `candidates.test.ts` changed among source files; the
  task file carries the report.
- `memberIdsForTopic` in `group-notifier.ts` still enumerates every `group_members`
  row of the topic's group. Non-members are now rejected inside `resolveCandidate`,
  so the behaviour is correct, but the notifier still does a candidate read per
  group member for non-General topics. I left it alone because the spec scoped the
  change to `resolveCandidate`; tightening the query would be a follow-up.
- No deviation from the spec.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `6526b5c4f`.
- **`resolveCandidate`:** after `canSeeTopic`, a non-General topic hides from anyone who isn't `isTopicMember` (direct or by role). That covers the group notifier, the preview route and the archive scan. General still reaches the whole group. The mute check is unchanged; only its comment moved.
- **The test** covers a public topic: a non-member is hidden, a member is ok.
- **The pre-review follow-up** (the notifier still loops over all group members and rejects non-members one read at a time) is a perf note, not filed.

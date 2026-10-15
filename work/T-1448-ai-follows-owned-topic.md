---
id: T-1448
title: "An AI that owns a topic follows it (UX Task I): every human message in that topic reaches it with no @, until the owner changes or Stop; an AI owner must be one of the topic's AIs"
status: merged
milestone: M5
branch: task/T-1448-ai-follows-owned-topic
model: auto
effort: default
depends_on: []
estimate: 0.6 day
---

# T-1448: An AI follows the topic it owns

## Spec (written by Claude, do not edit)

### Why
Julio decided on 2026-10-15: an AI **assigned** as a topic's owner (the topic's owner chip) **follows that topic**. Every new message there reaches it with no @ needed, until the owner changes or Stop. This is Task I of `docs/audit/agent-ux-plan.md:630-640`; its open question 4 (`:687-688`) is now answered.

Today a group AI answers only when it is @mentioned or replied to.

### Facts (the lead read them on main, 2026-10-15)
- **Each topic is its own MUC room:**
  - the `topics` table has `room_localpart`, `owner_user_id`, `owner_ai_id` and `archived_at` (`apps/server/drizzle/0018_lethal_warhawk.sql:9-25`);
  - the topic's chat JID is `${room_localpart}@${mucDomain}` (`apps/server/src/topics/views.ts:99`);
  - a topic's AIs are in `topic_ais` (`apps/server/src/topics/ais.ts`, `addTopicAi` / `removeTopicAi`).
- **Owner check:** `assertOwner(db, groupId, owner)` (`apps/server/src/topics/members.ts:44-70`) checks only that an AI owner **exists** (`SELECT id FROM ais WHERE id = …`). It doesn't check that the AI belongs to this topic.
  - Topic update calls it at `apps/server/src/topics/service.ts:241-244` and writes `patch.ownerAiId` at `:256-258`. The file is **380 lines**.
  - Create calls it at `:80`; no client sends an owner at create.
  - The apps offer as candidates the topic's members plus its AIs (`apps/mobile/src/components/chat/use-chat-screen.ts:216-223`; web `apps/web/src/components/topic/OwnerMenu.tsx`).
- **Group ingest:** `apps/server/src/agents/gateway/group-ingest.ts` (258 lines).
  - It computes `mentioned` (a mention of this AI, or a reply to it) at `:137-145`, and returns at `:150-153` when not mentioned ("No mention, nobody replies").
  - AI senders are told apart with `isAiSender(normBareJid(message.fromJid))`.
  - Each human message opens a round (`:126-136`), and an accepted message is queued in `session.roomPending` (`:183-193`).
- **Stop:** `createStopTurn(sessions).stopTurn(aiId, chatJid)` (`apps/server/src/agents/gateway/stop.ts:34-48`) aborts the running turn for that chat. For a room, the chat id is the room JID.

### What to build
1. **Owner rule (permissions):** `assertOwner` takes the topic id when there is one.
   - An AI owner must be in `topic_ais` for that topic; otherwise 400 `invalid_request` "Add the AI to the topic first".
   - On create (no topic yet), an AI owner is refused with the same message.
   - User owners keep today's rule.
2. **New `apps/server/src/agents/gateway/topic-follow.ts`:**
   - `followingAiFor(db, roomJid): Promise<string | null>`: the `owner_ai_id` of the non-archived topic whose `room_localpart` is the room JID's localpart. Cache it per room for 15 s in a `Map`, capped at 2,000 entries.
   - `invalidateTopicFollow(roomLocalpart)`.
   - The pause set `pauseFollow(aiId, roomJid)`, `resumeFollow(aiId, roomJid)` and `isFollowPaused(aiId, roomJid)` is in memory. A server restart clears it; say so in a comment.
3. **Ingest:** in `group-ingest.ts`, when `mentioned` is false, the sender is **not** an AI, and `!isFollowPaused(session.aiId, roomJid)` and `await followingAiFor(db, roomJid) === session.aiId`, treat the message as if it were a mention and queue it as today.
   - A real mention or reply also calls `resumeFollow`.
   - AI senders never trigger following, so two AIs can't loop.
   - Keep the file at 400 lines or fewer; move the check into `topic-follow.ts` if needed.
4. **Stop:** `stopTurn(aiId, chatJid)` also calls `pauseFollow(aiId, chatJid)`, whether or not a turn was running.
5. **Owner change:** in `topics/service.ts`, after the owner is written:
   - call `invalidateTopicFollow(topic.roomLocalpart)`;
   - when the new owner is an AI, call `resumeFollow(newAiId, roomJid)`, so assigning it again restarts following.
   - Keep the file at 400 lines or fewer.

### Tests (message pipeline and permissions are crucial)
In `apps/server/src/agents/gateway/topic-follow.test.ts` (and the nearest topics test for the owner rule):
1. A human message with no mention in a topic owned by AI A queues a turn for A, and not for AI B in the same room.
2. An AI sender's message there queues nothing.
3. After `stopTurn(A, room)`, a plain message queues nothing; a mention of A queues one and resumes following.
4. `assertOwner` refuses an AI that is not in `topic_ais` for that topic, and accepts one that is.

### Allowed files
- `apps/server/src/agents/gateway/topic-follow.ts`, `apps/server/src/agents/gateway/topic-follow.test.ts`
- `apps/server/src/agents/gateway/group-ingest.ts`, `apps/server/src/agents/gateway/stop.ts`
- `apps/server/src/topics/members.ts`, `apps/server/src/topics/service.ts`
- the nearest existing topics test file (name it in the Report)
- `work/T-1448-ai-follows-owned-topic.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/gateway/topic-follow src/topics --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes and the four tests pass.
- After deploy, the lead checks that a plain message in an AI-owned topic gets an answer, using the test AI once Julio has set it up.

---

## Report (written by the worker when done)

### What I built

An AI assigned as a topic's owner now follows that topic: every plain human
message in the room reaches it with no `@`, until the owner changes or the owner
presses Stop.

1. **`apps/server/src/agents/gateway/topic-follow.ts`** (new, 105 lines):
   - `followingAiFor(db, roomJid)`: the `owner_ai_id` of the non-archived topic
     whose `room_localpart` is the room JID's localpart; cached per room for
     15 s in a `Map` capped at 2,000 entries (oldest evicted).
   - `invalidateTopicFollow(roomLocalpart)`.
   - In-memory pause set `pauseFollow` / `resumeFollow` / `isFollowPaused`.
     A server restart clears it (said so in a comment). Keys reduce to the room
     localpart, so a caller may pass either a room JID or a localpart.
2. **`group-ingest.ts`**: when `mentioned` is false, the sender is not an AI,
   and the AI is not paused, it resolves the owner asynchronously and, when the
   AI owns the room, queues the message exactly like a mention. A real mention
   or reply calls `resumeFollow` first. The queue step is now the shared
   `queueRoomTurn`, used by mentions, replies and follows. AI senders never
   trigger following.
3. **`stop.ts`**: `stopTurn(aiId, chatJid)` calls `pauseFollow(aiId, chatJid)`
   whether or not a turn was running.
4. **`topics/members.ts`**: `assertOwner(db, groupId, owner, topicId?)`. An AI
   owner must be in `topic_ais` for that topic; otherwise, and at create (no
   topic yet), it is a 400 `invalid_request` "Add the AI to the topic first".
   The old "owner AI was not found" check was replaced by the membership check
   (`topic_ais.ai_id` has an FK to `ais`, so existence is implied). User owners
   keep the group-member rule.
5. **`topics/service.ts`**: `patchTopic` passes `topic.id` to `assertOwner`;
   after the owner row is written it calls `invalidateTopicFollow(roomLocalpart)`
   and, for a new AI owner, `resumeFollow`.

### Files changed
- `apps/server/src/agents/gateway/topic-follow.ts` (new)
- `apps/server/src/agents/gateway/topic-follow.test.ts` (new)
- `apps/server/src/agents/gateway/group-ingest.ts`
- `apps/server/src/agents/gateway/stop.ts`
- `apps/server/src/topics/members.ts`
- `apps/server/src/topics/service.ts`
- `work/T-1448-ai-follows-owned-topic.md`

Nearest existing topics test file: `apps/server/src/topics/visible-batch.test.ts`
(see the deviation below).

### Commands I ran (real results)
- `pnpm install`: done in 11.1s (peer warning about `@types/react-dom` only).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/topic-follow`
  → 7 passed (the four spec cases plus create-refusal and user-owner-rule).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/topic-follow src/topics`
  (the Checks command with the required worker cap) → 2 files, 8 passed.
- `pnpm gate` from the repo root:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.2s)
  PASS  lint  (1.2s)
  PASS  typecheck  (3.5s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/server  (6.6s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Deviations and decisions
- **Owner-rule test placement.** The spec puts test 4 "in the nearest topics test".
  The gate's scope parser (`packages/devtools/src/gate/scope.ts`) only reads
  backticked paths from the Allowed files section; the spec's line for the nearest
  topics test is prose, so a change to
  `apps/server/src/topics/visible-batch.test.ts` is reported as outside scope
  (I confirmed this: the first gate run failed with exactly that file listed).
  I therefore keep all four tests in the allowed
  `apps/server/src/agents/gateway/topic-follow.test.ts` instead, which keeps the
  gate green. I did not edit the Spec to add the path. If you prefer the test in
  `visible-batch.test.ts`, the Allowed files section needs that backticked path.
- **Follow key is the room localpart.** `topic-follow` reduces any given room JID
  to its localpart before using it as a key, because `TopicServiceDeps` carries
  the user `domain`, not the MUC domain, and `schemas.ts` is outside the Allowed
  files. `service.ts` therefore calls `invalidateTopicFollow(topic.roomLocalpart)`
  and `resumeFollow(ownerAiId, topic.roomLocalpart)`. Functionally identical for
  room JIDs from any domain.
- **Async follow check.** `handleRoomIncoming` must stay synchronous because its
  call site is in `gateway.ts` (outside the Allowed files), so the follow lookup
  runs on the effect runtime (`Effect.runFork`), like the existing pump. The
  cached path resolves synchronously in practice; the first uncached message is
  queued a tick later. Ordering within a room's queue is preserved.
- **General topic.** An AI can no longer be set as the General topic's owner,
  because General AIs live in `group_ais`, not `topic_ais`. This follows the spec
  rule literally ("must be one of the topic's AIs" = `topic_ais`). Flagging it in
  case the owner menu offers group AIs for General.

### Open questions
- Is refusing an AI owner for the General topic intended, or should General also
  accept a `group_ais` member as owner?
- Should test 4 live in `visible-batch.test.ts`? If so, it must be backticked in
  the Allowed files section.

### Round 1 (fix round)

Findings fixed:

- **Finding 1 (Stop race) — fixed.** `group-ingest.ts` `followOwnedTopic` now
  re-checks `isFollowPaused` after the async owner lookup, so a Stop that lands
  mid-lookup suppresses the in-flight follow. Test added:
  `topic-follow.test.ts` "does not queue a follow whose owner lookup lands after
  Stop" (fails on the old code, passes on the fix). Commit
  `T-1448: fix finding 1 - re-check Stop pause after the owner lookup`.
- **Finding 2 (archive invalidation) — fixed.** `topics/service.ts` `patchTopic`
  now invalidates the follow cache when the topic is archived, not only when the
  owner changes, so a stale owner entry cannot keep answering in an archived
  topic for up to 15 s. Test added: `topic-follow.test.ts` "stops following a
  topic once it is archived" (fails on the old code, passes on the fix). Commit
  `T-1448: fix finding 2 - invalidate the follow cache when a topic is archived`.

Findings not changed:

- **Finding 3 (General-topic AI owner)** needs the lead's decision (see below).
- Nits 4 and 5 left as they are (nits; finding 5's call site,
  `gateway.ts:268`, is outside the Allowed files). The new find-1 test waits out
  the owner lookup (`await followingAiFor(...)` then `tick(40)`) instead of a
  bare `tick`, so it does not repeat nit 4's race.

Tests run:

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/topic-follow.test.ts`
  → 1 file, 9 passed (Duration 4.61s). I also ran each new test alone against the
  pre-fix code: finding 1 failed (`expected [] to have a length of 0`) and
  finding 2 failed (`expected 'ai-…' to be null`), confirming both exercise the
  fix.
- `pnpm gate` from the repo root:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (5.8s)
  PASS  format  (1.6s)
  PASS  lint  (1.2s)
  PASS  typecheck  (4.7s)
  PASS  effect  (1.6s)
  PASS  tests @zilar/server  (11.4s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Round 2 (lead decision)

The lead decided finding 3 (below) and asked for the Round 1 fixes as well, so
this round implements: **finding 3** — the General topic accepts a `group_ais` AI
owner (`topics/members.ts`; test "accepts a group AI as the owner of the General
topic"); **finding 1** — `group-ingest.ts` now returns the follow check's promise
(`Effect.runPromise`) and re-checks the pause after the lookup, and the Stop test
awaits that promise; **finding 2** — `patchTopic` invalidates the follow cache on
any archive change (`input.archived !== undefined`); **finding 4** — the AI-sender
and Stop negative tests await the follow check instead of a fixed `tick`. One
commit per item. Checks: `vitest run src/agents/gateway/topic-follow src/topics
--reporter=dot` → 2 files, 11 passed; `pnpm gate` → `GATE PASS`. `status: review`.

### Finding 3 decision (resolved)

The pre-review marks finding 3 "(needs lead decision)": requiring an AI owner to
be in `topic_ais` makes a General-topic AI owner impossible (General's AIs live
in `group_ais` and `addTopicAi` refuses General), where previously any existing
AI was accepted. The two outcomes it names — the rule is intended, or General
must also accept a `group_ais` member — are a product/permission choice, and the
second one also conflicts with the Spec's literal wording ("An AI owner must be
in `topic_ais` for that topic") and with the owner-rule test, so I did not change
`members.ts`. Please decide which option you want; I will implement it in a
follow-up round. Everything else in this round is fixed and the gate is green,
which is why that item was blocked until the lead's Round 2 decision.

### Round 3 (fix round)

Pre-review findings: F1 (must-fix), F2 (should-fix), F3 (follow-up, outside the
Allowed files), F4 (nit).

Findings fixed:

- **Finding 2 (should-fix) — fixed.** `topics/members.ts` `removeTopicMember`
  now calls `invalidateTopicFollow(topic.roomLocalpart)` right after it archives
  a drained topic, so the cached owner cannot keep the archived room followed for
  the rest of the 15 s window. This is the `members.ts` archive path; Round 1
  fixed only the `service.ts` one. Test added: `topic-follow.test.ts` "stops
  following a topic archived when its last member is removed"; it fails on the
  pre-fix code (`expected null, received "<aiId>"`). Commit
  `T-1448: fix finding 2 - invalidate the follow cache when a member removal archives the topic`.

Findings not changed:

- **Finding 1 (must-fix) — disagreed; code left unchanged, evidence test added.**
  See "Disagreements". Commit
  `T-1448: fix finding 1 - document disagreement and add a resolve guard test`.
- **Finding 3 (follow-up)** needs `apps/server/src/topics/ais.ts`, outside the
  Allowed files; left as reported.
- **Finding 4 (nit)** is in `stop.ts`/`topic-follow.ts` lines not otherwise
  changed; left as reported.
- **Lead merge fix (runner typecheck):** `topic-follow.ts` imports `bareJid` from `../../jid` instead of `normBareJid` from `../context`, so nothing reachable from `topics/service.ts` pulls `@zilar/xmpp-core` (even type-only) into `apps/runner`; `apps/runner` `tsc --noEmit` and `pnpm gate` pass.

### Disagreements

- **Finding 1 — the described crash does not reproduce, and the suggested fix
  would introduce it.** F1 says `followOwnedTopic`'s `Effect.catchDefect` "misses
  typed `SqlError` failures", so a DB error on a cache-missed lookup rejects the
  promise and the ignored return value at `gateway.ts:268` becomes an unhandled
  rejection. In this code the promise is wrapped in `Effect.promise`, and
  `Effect.promise` lifts a rejection into a **defect**, not a typed failure
  (`effect@4.0.4`, `Effect.promise`: "If it rejects, the rejection is treated as
  a defect"). `catchDefect` catches exactly that, so the returned promise
  resolves. I reproduced the scenario with a real `SqlError` from a cache-missed
  lookup (the `topics` query against a renamed table): `followingAiFor` rejects,
  but `handleRoomIncoming`'s promise resolves and queues nothing. The test
  "resolves when the owner lookup fails, and queues nothing" passes on the
  unmodified code. The suggested `catchAll` (v4 `Effect.catch`) catches **only**
  typed failures and would let the defect through — I verified it turns the
  resolve into a rejection — so applying it as written would create the bug it
  warns about. `catchCause` (`catchAllCause`) would be safe, but it changes
  nothing today (that pipeline has no typed failure) and the current
  `catchDefect` already meets the requirement. Per the task's instruction I left
  the code as it is and added the guard test as evidence. If belt-and-braces is
  still wanted, the one-line change is `Effect.catchDefect` → `Effect.catchCause`
  at `group-ingest.ts:217`.

Commands I ran:

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/topic-follow.test.ts`
  → 1 file, 12 passed (Duration 5.27s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/topic-follow src/topics`
  (the spec Checks command with the required worker cap) → 2 files, 13 passed.
- Against the pre-fix `members.ts`, the F2 test alone fails
  (`expected null, received "<aiId>"`), confirming it exercises the fix.
- `pnpm gate` from the repo root:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (1.8s)
  PASS  lint  (0.9s)
  PASS  typecheck  (3.8s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/server  (14.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

## Review (written by Claude)
Lead, 2026-10-15: approved after one lead round and 2 auto rounds. Pre-review CLEAN, nit 3, follow-up 1.
- **The lead's decision:** General accepts a `group_ais` AI as its owner; other topics need `topic_ais`.
- **The fixes:**
  - the pause is re-checked after the async owner read;
  - archiving invalidates the follow cache;
  - the negative tests are deterministic.
- The topic-follow and topics tests (13) pass locally.
- **Follow-up:** clear `owner_ai_id` when the owner AI is removed from the topic or group. Following can't continue then anyway, since the AI leaves the room, but the chip would go stale.

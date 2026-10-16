---
id: T-1760
title: "Topic people S5: join and leave a topic - POST /api/topics/:id/join for public topics; self-leave from a public topic; General can't be left; a public topic with no members stays live"
status: merged
milestone: M5
branch: task/T-1760-topic-join-leave
model: auto
effort: default
depends_on: [T-1754]
estimate: 45 min
---

# T-1760: Join and leave a topic (server)

## Spec (written by Claude, do not edit)

### Why
Julio asked for joining other topics in a group and leaving a topic (`docs/design/mockups/topic-people/README.md`, "Round 2"; boards `PhoneGroup.dc.html`, `PhoneJoin.dc.html` and `PhoneLeave.dc.html`). His rule: a new public topic includes nobody until people join, and General stays everyone.
- **T-1754 (merged):** public topics carry real `topic_members` rows.
- **T-1757 (done, merging with this task):** the reads follow those rows.

This task adds the server half of joining and leaving.

### Facts (read by the lead on 2026-10-16)
- **`apps/server/src/topics/members.ts`** (270 lines): `addTopicMember` is at `:125-164`; `removeTopicMember` at `:166-270`. `removeTopicMember`:
  - throws `toMissingTopic()` for a missing, archived or unseen topic (`:172-178`);
  - refuses every non-private topic with `400 not_private` (`:179-181`);
  - 404s when the target isn't a member (`:182-194`);
  - lets a member remove themselves, or a manager remove anyone (`:195-202`);
  - deletes the row, then **archives the topic when no direct members and no role holders remain** (`:211-243`);
  - otherwise it syncs the room (`syncTopicRoom`), emits dropped AIs (`emitDroppedTopicAis`) and audits `topic.member_removed` (`:244-269`).
  - `addTopicMember` audits `toAuditEntry(updated, 'topic.member_added', actorId, { subjectUserId })` (`:158-162`).
- **The contract:** `packages/api-contract/src/topics.ts` (312 lines). `TopicsGroup` is at `:250-311`; `removeMember` is `DELETE /topics/:id/members/:userId` (`:286-289`); `create` carries `.middleware(TopicsCreateRateLimit)` (`:263`).
  - `TopicsCreateRateLimit` is declared in `packages/api-contract/src/middleware.ts:164-167` (305 lines).
- **The handlers:** `apps/server/src/topics/api.ts` (294 lines).
  - `removeMember` (`:205-220`) answers the topic, or `toMissingTopic()` when the remove archived it.
  - The create limiter is built at `:71-75` from `TOPIC_CREATE_RATE_LIMIT_MAX = 30` and `TOPIC_CREATE_RATE_LIMIT_WINDOW_MS` (`:50-51`), and wired with `rateLimitLayer(TopicsCreateRateLimit, createLimiter, …)` at `:283-289`.
- **Test setup to copy:** `apps/server/src/topics/public-members.test.ts:1-40` (`createTestContext`, `seedGroup`/`seedUser`, `depsFor`, `memberIdsOf`, and `createTopic` to make a public topic whose only member is its creator).

### Steps
1. **Join:** add `export async function joinTopic(deps, topicId, actorId): Promise<TopicRow>` to `members.ts`.
   - A missing, archived or unseen topic (`canSeeTopic`) throws `toMissingTopic()`.
   - **General:** `400 'is_general'` with "Everyone in the group is in General".
   - **A private topic the caller can see:** they're already in it, so return the topic unchanged (managers add people to private topics).
   - **A public topic:** `INSERT INTO topic_members (topic_id, user_id, added_by) VALUES (…, actorId, actorId) ON CONFLICT DO NOTHING`.
     - Then `syncTopicRoom(deps, updated)` with the same `HttpError`/`xmppUnavailable` mapping as `removeTopicMember`.
     - Audit `topic.member_added` with `subjectUserId: actorId`, only when a row was inserted.
     - Return the fresh row.
   - Keep `members.ts` at most 400 lines.
2. **Leave:** change `removeTopicMember`.
   - **General:** `400 'is_general'` with "Leaving General is leaving the group".
   - **A public non-General topic:** **self only**. When `actorId !== targetUserId`, answer `403 'forbidden'` with "People leave a public topic themselves", **managers included**.
   - **A private topic:** unchanged.
   - Remove the `not_private` guard; these rules replace it.
   - **Archive-on-drain stays private-only:** wrap the drain branch (`:224-243`) in `topic.visibility === 'private'`. A public topic with no members stays live and joinable.
   - Update the comment in `api.ts`'s `removeMember` handler to match ("removing the last private member archives…").
3. **The route:**
   - In the contract, `HttpApiEndpoint.post('join', '/topics/:id/join', { params: TopicIdParams, success: Topic }).middleware(TopicsJoinRateLimit)`.
   - In `middleware.ts`, a `TopicsJoinRateLimit` class copied from `TopicsCreateRateLimit`.
   - In `api.ts`:
     - a `joinLimiter` with `TOPIC_JOIN_RATE_LIMIT_MAX = 60` per `TOPIC_JOIN_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000`;
     - a `'join'` handler that calls `joinTopic` and returns `toTopicView(deps.db, topic, mucDomain)`;
     - its `rateLimitLayer(TopicsJoinRateLimit, joinLimiter, 'Too many joins, try again later')`.
4. **Tests (permissions, 2)** in a new `apps/server/src/topics/join-leave.test.ts`, with the setup copied from `public-members.test.ts`:
   - **Joining:**
     - a plain group member joins a public topic, which leaves their `topic_members` row;
     - joining again keeps one row;
     - joining General throws 400.
   - **Leaving:**
     - a group owner (a manager) removing another member from a public topic throws 403;
     - the creator leaving their public topic as its last member leaves it **not** archived (`archivedAt` null).

### Allowed files
- `apps/server/src/topics/members.ts`
- `apps/server/src/topics/api.ts`
- `packages/api-contract/src/topics.ts`
- `packages/api-contract/src/middleware.ts`
- `apps/server/src/topics/join-leave.test.ts`
- `work/T-1760-topic-join-leave.md`

### Checks
```bash
cd apps/server && pnpm exec vitest run src/topics/join-leave.test.ts src/topics/public-members.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- `POST /api/topics/:id/join` adds the caller to a public topic (it's idempotent, and refuses General).
- On a public topic only the person themselves can leave; General can't be left; a public topic never archives when it empties.
- The tests and the gate pass.

---

## Report (written by the worker when done)

### What I did

Implemented server-side join and leave for public topics.

**`apps/server/src/topics/members.ts`**
- Added `joinTopic(deps, topicId, actorId)`: a missing/archived/unseen topic throws the shared `toMissingTopic()` (404); General throws `400 is_general` ("Everyone in the group is in General"); a private topic the caller can see is returned unchanged; a public topic gets an idempotent `INSERT ... ON CONFLICT DO NOTHING RETURNING user_id` at `(topic_id, user_id, added_by) = (topic.id, actorId, actorId)`, then `syncTopicRoom` with the same `HttpError`/`xmppUnavailable` mapping as `removeTopicMember`, and audits `topic.member_added` with `subjectUserId: actorId` only when a row was inserted (RETURNING tells us).
- `removeTopicMember`: added the General guard (`400 is_general`, "Leaving General is leaving the group"); replaced the `not_private` guard with the new rules — a public non-General topic is self-only (`403 forbidden`, "People leave a public topic themselves", managers included), a private topic keeps its old 404-then-manager check exactly. The archive-on-drain branch (and its role-holder lookup) is now guarded by `topic.visibility === 'private'`, so an emptied public topic stays live.
- File stays well under 400 lines (≈320).

**`apps/server/src/topics/api.ts`**
- Added `TOPIC_JOIN_RATE_LIMIT_MAX = 60` / `TOPIC_JOIN_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000`, a `joinLimiter`, the `'join'` handler (calls `joinTopic`, returns `toTopicView`), and `rateLimitLayer(TopicsJoinRateLimit, joinLimiter, 'Too many joins, try again later')`.
- `joinTopic` is imported directly from `./members` (not re-exported through `service.ts`) because `service.ts` is not in the Allowed files.
- Updated the `removeMember` comment to "Removing the last private member archives the topic".

**`packages/api-contract/src/middleware.ts`** — added `TopicsJoinRateLimit`, copied from `TopicsCreateRateLimit`.

**`packages/api-contract/src/topics.ts`** — added `POST /topics/:id/join` (`join`) with `TopicIdParams` / `success: Topic` and `.middleware(TopicsJoinRateLimit)`.

**`apps/server/src/topics/join-leave.test.ts`** — 5 tests (setup copied from `public-members.test.ts`): a plain member joins a public topic; joining twice keeps one row; joining General throws 400; a group owner (manager) removing another member from a public topic throws 403 and the member stays; the creator leaving their public topic as its last member leaves `archivedAt` null.

### Checks run

- `pnpm install` — done, succeeded.
- `pnpm --filter server test --maxWorkers=2 --reporter=dot src/topics/join-leave.test.ts src/topics/public-members.test.ts` — **2 files passed, 7 tests passed** (the same two files as the task's check command, in the AGENTS-approved filter form).
- `pnpm gate` (from repo root) — **GATE PASS**. Summary lines:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.0s)
  PASS  lint  (1.2s)
  PASS  typecheck  (3.5s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/server  (7.8s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  Changed files: `apps/server/src/topics/members.ts`, `apps/server/src/topics/api.ts`, `packages/api-contract/src/middleware.ts`, `packages/api-contract/src/topics.ts`, `apps/server/src/topics/join-leave.test.ts`, `work/T-1760-topic-join-leave.md` — all inside the Allowed files.
- One `pnpm gate` run first failed on `format` for `join-leave.test.ts`; fixed with `pnpm exec prettier --write` on that one file, then the gate passed.

### Notes for the lead

- Deviation from the literal spec wording: `api.ts` imports `joinTopic` straight from `./members` instead of re-exporting it through `service.ts`, because `service.ts` is not in the Allowed files. Behavior is unchanged.
- The new `POST /api/topics/:id/join` route is picked up automatically by `authz-sweep.test.ts` (it enumerates `app.routes`), so the 401 sweep covers it.
- Join idempotency is enforced by the insert's `ON CONFLICT DO NOTHING` against the existing unique constraint on `topic_members`, not a check-then-insert; the audit fires only on a real insert.

## Review (written by Claude)

- **Accepted at `3823e0fd6`.** It's clean, with no nits. The lead ran `join-leave.test.ts` and `public-members.test.ts`: 7 pass.
- **`joinTopic`:**
  - a missing or unseen topic gets the same 404;
  - General gets 400 `is_general`;
  - a private topic is a no-op;
  - a public topic is an idempotent insert (`ON CONFLICT … RETURNING`), then a room sync, with an audit only on a real insert.
- **`removeTopicMember`:**
  - General gets 400;
  - on a public topic it's self only (403 for anyone else, managers included);
  - archive-on-drain is private-only.
- **The join route** has its own rate limit (60 an hour) and is covered by the authz sweep.
- **Safe to deploy before T-1757:** under today's reads, public topics are still the whole group, so join and leave rows have no visible effect until T-1757 switches the reads.


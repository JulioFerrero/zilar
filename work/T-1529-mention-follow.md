---
id: T-1529
title: "AI work in topics, step 4 (docs/audit/ai-work-plan.md T4, Julio's 10-15 decision): the last @mentioned AI follows a topic — topics.follower_ai_id (migration 0065, backfilled from owner_ai_id); topic-follow reads it; a human @mention sets it; Stop or marking the topic done pauses it; removing the AI clears it"
status: merged
milestone: M5
branch: task/T-1529-mention-follow
model: auto
effort: default
depends_on: []
estimate: 60 min
---

# T-1529: The last @mentioned AI follows a topic

## Spec (written by Claude, do not edit)

### Why
The approved "AI work in topics" design removes the single owner AI (`docs/audit/ai-work-plan.md` §5c, §5e, §6e). Today the owner AI follows its topic (T-1448): every human message reaches it with no @, until Stop (T-1493 saves the pause).

**Julio decided on 2026-10-15:** the **last @mentioned AI** follows each topic.
- One follower per topic, like today's owner, but chosen by the latest human @mention (or reply) of an AI in that topic.
- Stop, or a person marking the topic done (T-1521), pauses it.
- No AI-to-AI chatter.

This task moves following off `owner_ai_id` so a later step can drop the owner (T8). The owner chip keeps working until then: assigning an AI owner also makes it the follower.

**Lead decision:** the **General topic** is never followed. A mention there gets one answer, as today in General.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/server/src/agents/gateway/topic-follow.ts` (194 lines)** reads `owner_ai_id` in:
  - `followingAiFor` (`:54-73`, cached 15 s, keyed by room localpart);
  - `initTopicFollow` (`:92-111`, loads the saved pauses);
  - `pauseFollow` (`:124-138`, `UPDATE topics SET follow_paused_at = now() WHERE room_localpart = … AND owner_ai_id = …`);
  - `resumeFollow` (`:141-159`).
  
  Its test is `topic-follow.test.ts` (512 lines, exempt from the size rule).
- **`apps/server/src/agents/gateway/group-ingest.ts` (313 lines):**
  - `mentioned` is computed at `:140-146` (an @mention or a reply to this AI);
  - a non-mention goes to `followOwnedTopic` (`:153-158`, `:196-227`), which queues a turn when `followingAiFor(...) === session.aiId` and the room isn't paused;
  - a mention calls `resumeFollow(session.aiId, roomJid)` (`:161`);
  - `isAiSender(normBareJid(message.fromJid))` tells an AI sender apart (`:164`).
- **`apps/server/src/topics/patch.ts`:**
  - an owner change sets `ownerAiId` and clears `followPausedAt` (`:126-131`), then calls `invalidateTopicFollow` and `resumeFollow` (`:148-156`);
  - T-1521's `done` sets `doneAt` (`:125`).
- **Topic create:** `apps/server/src/topics/service.ts:71`, `:95` writes `owner_ai_id`.
- **Removing an AI:**
  - from a topic: `apps/server/src/topics/ais.ts:154-160` clears `owner_ai_id` and invalidates;
  - from a group: `apps/server/src/groups/ais.ts:217-218`, `:261` (390 lines; do not grow it by more than 2 lines).
- **Columns:** `topics.is_general` and `topics.archived_at` exist; `TopicRow` is in `apps/server/src/db/rows.ts` (`followPausedAt` at `:88`). The last migration is `0064_topic_done_at.sql`, and the pattern is `SET lock_timeout = '5s';--> statement-breakpoint` first.

### Steps
1. **Migration `apps/server/drizzle/0065_topic_follower.sql`:**
   ```sql
   SET lock_timeout = '5s';--> statement-breakpoint
   ALTER TABLE "topics" ADD COLUMN "follower_ai_id" text REFERENCES "ais"("id") ON DELETE SET NULL;--> statement-breakpoint
   UPDATE "topics" SET "follower_ai_id" = "owner_ai_id" WHERE "owner_ai_id" IS NOT NULL AND "is_general" = false;
   ```
   `ais.id` is `text` (`apps/server/drizzle/0005_clean_frightful_four.sql:9`), like `owner_ai_id`. `TopicRow` gains `followerAiId: string | null`.
2. **`topic-follow.ts`:** every query reads and writes `follower_ai_id` instead of `owner_ai_id`. Add `setTopicFollower(roomJid, aiId): Promise<void>`: fire-and-forget like `saveFollowChange`, it runs `UPDATE topics SET follower_ai_id = $ai, follow_paused_at = NULL WHERE room_localpart = $lp AND archived_at IS NULL AND is_general = false`, then updates the cache entry and clears this AI's in-memory pause for the room.
3. **`group-ingest.ts`:** on a **human** sender's mention or reply (where `resumeFollow` is called today), call `setTopicFollower(roomJid, session.aiId)` instead. AI senders (handoffs) change nothing. Rename `followOwnedTopic` to `followTopic`; same logic, so the cached follower must equal `session.aiId`. The file stays under 400 lines.
4. **`patch.ts`:**
   - an owner change to an AI also sets `followerAiId` to it, and clearing the owner leaves the follower as is;
   - `done: true` pauses the current follower: set `followPausedAt = now` in the same update, and call `pauseFollow(followerAiId, roomLocalpart)` after it when there is one;
   - keep `invalidateTopicFollow` after any change to owner, archive or done.
5. **Create (`service.ts`):** an AI owner at create also sets `follower_ai_id`, unless the topic is General.
6. **Removing an AI (`topics/ais.ts`, `groups/ais.ts`):** also clear `follower_ai_id` where it is that AI. Put both clears in the same `UPDATE`, so `groups/ais.ts` grows by at most 2 lines.
7. **Tests (message pipeline), in `topic-follow.test.ts`:** update the existing cases to the new column, and add:
   - a human mention of AI B in a topic followed by AI A makes B the follower, so A no longer gets plain messages and B does;
   - an AI sender's mention changes nothing;
   - the General topic is never followed;
   - marking the topic done pauses the follower, and a later mention resumes following.

### Not in scope
- dropping `owner_ai_id` (T8);
- any UI;
- notices.

### Allowed files
- `apps/server/drizzle/0065_topic_follower.sql` (new)
- `apps/server/src/db/rows.ts`
- `apps/server/src/agents/gateway/topic-follow.ts`
- `apps/server/src/agents/gateway/topic-follow.test.ts`
- `apps/server/src/agents/gateway/group-ingest.ts`
- `apps/server/src/topics/patch.ts`
- `apps/server/src/topics/service.ts`
- `apps/server/src/topics/ais.ts`
- `apps/server/src/groups/ais.ts`
- `work/T-1529-mention-follow.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/gateway/topic-follow.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- After the migration, every existing owner AI (outside General) is its topic's follower.
- A human @mention or reply moves following to that AI.
- Stop pauses following, and so does marking the topic done; the next mention resumes it.
- Removing the AI clears it.
- The General topic is never followed.
- Every file stays under 400 lines.

---

## Report (written by the worker when done)

### What I did
- **Migration `apps/server/drizzle/0065_topic_follower.sql` (new):** adds `topics.follower_ai_id` (`text` → `ais(id)`, `ON DELETE SET NULL`), then backfills it from `owner_ai_id` for non-General topics. Starts with `SET lock_timeout = '5s';`.
- **`apps/server/src/db/rows.ts`:** `TopicRow` gains `followerAiId: string | null`.
- **`topic-follow.ts`:** every query now reads/writes `follower_ai_id`; `followingAiFor` and `initTopicFollow` also filter `is_general = false` so the General topic is never followed. Added `setTopicFollower(roomJid, aiId)`: fire-and-forget `UPDATE topics SET follower_ai_id = $ai, follow_paused_at = NULL WHERE room_localpart = $lp AND archived_at IS NULL AND is_general = false`, then updates the cache and clears this AI's in-memory pause.
- **`group-ingest.ts`:** a **human** mention/reply now calls `setTopicFollower(roomJid, session.aiId)` (in the non-AI-sender branch only); an AI sender's mention is a handoff and changes nothing. `followOwnedTopic` renamed to `followTopic`, same logic against the cached follower. 317 lines.
- **`patch.ts`:** an owner change to an AI also sets `followerAiId` (except General); clearing the owner leaves the follower. `done: true` sets `followPausedAt = now` in the same update and calls `pauseFollow(topic.followerAiId, …)` afterwards when there is one. `invalidateTopicFollow` now runs after any owner/archive/**done** change, and `resumeFollow` is kept after an AI-owner assignment.
- **`service.ts` (create):** an AI owner at create also sets `follower_ai_id` (create always makes a non-General topic).
- **Removing an AI:** `topics/ais.ts` and `groups/ais.ts` clear `owner_ai_id` and `follower_ai_id` in the same `UPDATE`, using `NULLIF(col, $ai)` so each is cleared only when it is that AI (a *different* AI's owner/follower survives). `groups/ais.ts` stayed at 390 lines (no growth).
- **Tests (`topic-follow.test.ts`):** the fixture writes `follower_ai_id`; `followPausedAt`/`followerOf`/`waitForFollower` helpers added. New cases: a human mention moves following from A to B (A gets no plain message afterwards, B does); an AI sender's mention does not resume a paused follower; the General topic is never followed even when the row carries a follower; marking the topic done pauses the follower and a later mention resumes it.

### Checks run
- `pnpm install` → Done (13.5s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/topic-follow.test.ts` → **17 passed** (1 file).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics/patch.test.ts src/topics/ais.test.ts src/groups/ais.test.ts` → **6 passed** (3 files).
- `pnpm gate` → **GATE PASS**. Summary lines:
  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)  (2.4s)
  PASS  format  (1.0s)
  PASS  lint  (1.1s)
  PASS  typecheck  (4.4s)
  PASS  effect  (1.0s)
  PASS  tests @zilar/server  (24.5s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Deviations from the spec
- Spec step 6 said "put both clears in the same `UPDATE`" while growing `groups/ais.ts` by at most 2 lines. A plain `SET owner_ai_id = NULL, follower_ai_id = NULL` with `WHERE owner_ai_id = $ai OR follower_ai_id = $ai` would clear a *different* AI's owner/follower, so I used `NULLIF(owner_ai_id, $ai)` / `NULLIF(follower_ai_id, $ai)` in the one update. `groups/ais.ts` is unchanged in length (390 lines); `topics/ais.ts` grew by a few lines (190, well under 400). All Acceptance items ("clears it", "under 400 lines") hold.

### Notes for the lead
- `followingAiFor` and `initTopicFollow` filter `is_general = false`, and `setTopicFollower` refuses to write for General, so the General topic can never be followed even if a follower value is present on its row.
- `resumeFollow` is still used by `patch.ts` (AI-owner assignment) to clear the in-memory pause; its DB write is now keyed on `follower_ai_id`.
- I did not add a test for "removing an AI clears `follower_ai_id`": the nearest removal tests live in `topics/ais.test.ts` / `groups/ais.test.ts`, which are not in my Allowed files. The removal SQL is small and covered by inspection; flagging in case you want a test there.
- No UI, no owner-column drop, no notices touched.

### Round 2 (fix round)
Findings fixed:
- **Finding 1 (must-fix) — General follow-cache poisoning.** `setTopicFollower` now `invalidateTopicFollow`s the room instead of `rememberRoom(aiId, …)`, so a mention in General is never written into the follow cache. The next `followingAiFor` re-reads the row, where the `is_general = false` guard applies. Commit `e19417822`.
- **Finding 2 (should-fix) — done + owner change in one request.** `patchTopic` now skips `resumeFollow` when `input.done === true`, and pauses the post-update follower (`patch.followerAiId ?? topic.followerAiId`) instead of the stale pre-update row. Commit `ebe5a2ddc`.

Tests added (`apps/server/src/agents/gateway/topic-follow.test.ts`):
- Extended "never follows the General topic": a human @mention in General (one answer) followed by a plain message inside the 15 s window queues no second turn and leaves `followingAiFor` null — this fails on the pre-fix cache write.
- New "pauses the new follower when done and an owner change arrive in one request": asserts the new AI owner becomes the follower, the pause lands on it (`isFollowPaused`), a plain message queues nothing, and a later mention resumes.

`pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/topic-follow.test.ts` → **18 passed** (1 file). `src/topics/patch.test.ts` → **2 passed**.

`pnpm gate` → **GATE PASS**: `PASS install, format, lint, typecheck, effect, tests @zilar/server`; `scope: every changed file is inside the Allowed files`; `migration`, `images`, `size` pass. (First gate run failed lint on an unused `followerJid` in the new test; fixed, re-ran to pass.)

Nits 3 and 4 were left untouched: the instructions allow nits only on a line already changed, and neither comment line was otherwise part of this fix.

### Disagreements
None.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** one autopilot round fixed two findings:
  - a mention in General is no longer cached as a follower;
  - "done" plus an owner change in one PATCH pauses the new follower.
  
  The second packet was clean.
- **Two nits, left as they are:**
  - a Stop in General can stamp `follow_paused_at` on the General row, which no read ever uses;
  - one long line in `groups/ais.ts`.
- **Migration `0065_topic_follower.sql`** (read by the lead):
  - `lock_timeout 5s`;
  - one nullable `follower_ai_id text REFERENCES ais(id) ON DELETE SET NULL`;
  - a backfill from `owner_ai_id` outside General.
  
  Following keeps working across the deploy.
- **Behaviour matches Julio's 10-15 decision:**
  - the last @mentioned AI follows a topic; only a human sender sets it, never AI-to-AI;
  - Stop or "done" pauses it;
  - removing the AI clears it;
  - General is never followed.
- **After the deploy,** the lead checks the column live. T-1534 (web) and T-1540 (phone) drop the owner chip on top of this.



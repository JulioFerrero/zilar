---
id: T-1753
title: "Topic people S3: GET /api/topics/:id/routines lists one topic's routines for the In this topic 'Tools and routines' row"
status: merged
milestone: M5
branch: task/T-1753-topic-routines-read
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1753: The per-topic routines read

## Spec (written by Claude, do not edit)

### Why
The approved topic boards show a "Tools and routines · 1 · 2" row inside each topic. The design is in `docs/design/mockups/topic-people/`: `PhonePeople.dc.html` and `WebTopic.dc.html`. The plan is `docs/plan/topic-people.md` §2.4 and task S3.
- **Tools** already have a per-topic read (`GET /api/topics/:id/tools`).
- **Routines** only have per-group and per-AI reads. This task adds the per-topic one, server and contract only. The web and phone rows come in later tasks.

### Facts (read by the lead on 2026-10-16)
- **The routines contract** is `packages/api-contract/src/routines.ts:49-78` (78 lines). `listForGroup` is `HttpApiEndpoint.get('listForGroup', '/groups/:id/routines', { params: RoutineIdParams, success: Schema.Array(Routine) })` at `:57-60`.
- **The handlers** are in `apps/server/src/routines/api.ts` (204 lines). `listForGroup` (`:104-128`):
  - checks group membership (404 when the caller isn't a member);
  - then, for each non-archived topic the caller `canSeeTopic`, collects `listRoutinesForTopic(deps.db, topic.id)`;
  - and returns `result.map(toListWire)`.
- **The helpers:**
  - `findTopicById(db, topicId): Promise<TopicRow | null>` is at `apps/server/src/routines/reads.ts:14` (224 lines);
  - `canSeeTopic(db, topic, userId)` at `apps/server/src/topics/access.ts:81-100` returns false for an archived topic, a non-member of the group, and a private topic the caller isn't in or holds no role in;
  - `listRoutinesForTopic` is at `apps/server/src/routines/queries.ts:65`.
- **Test setup to copy:** `apps/server/src/routines/mine.test.ts`:
  - `createTestContext`, `seedUser`, `seedGroup` and `seedAi` from `../test-support`;
  - a `seedPrivateTopic` helper at `:34-58`;
  - `createPromptRoutine` to make a routine.

### Steps
1. **Contract:** in `packages/api-contract/src/routines.ts`, add after `listForGroup`:
   `HttpApiEndpoint.get('listForTopic', '/topics/:id/routines', { params: RoutineIdParams, success: Schema.Array(Routine) })`.
2. **Server:** in `apps/server/src/routines/reads.ts`, add `listVisibleTopicRoutines(db, topicId, userId): Promise<PublicRoutine[] | null>`. It returns `null` when the topic is missing or `!canSeeTopic`, and otherwise `listRoutinesForTopic(db, topicId)`. Import what you need; keep the file at most 400 lines.
3. **Handle `'listForTopic'`** in `apps/server/src/routines/api.ts`, after `listForGroup`:
   - call the helper;
   - `null` throws `new HttpError(404, 'not_found', 'Topic not found')`;
   - otherwise return `rows.map(toListWire)`.
   - A topic the caller can't see answers exactly like a missing one.
4. **One test (permissions)** in a new `apps/server/src/routines/topic-routines.test.ts`:
   - a group member who isn't in a private topic gets `null` from `listVisibleTopicRoutines`, while the topic's creator gets its routine (one routine made with `createPromptRoutine` in that topic).
   - Copy the setup from `mine.test.ts`; don't import from it.

### Allowed files
- `packages/api-contract/src/routines.ts`
- `apps/server/src/routines/reads.ts`
- `apps/server/src/routines/api.ts`
- `apps/server/src/routines/topic-routines.test.ts`
- `work/T-1753-topic-routines-read.md`

### Checks
```bash
cd apps/server && pnpm exec vitest run src/routines/topic-routines.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- `GET /api/topics/:id/routines` returns the topic's routines to someone who can see the topic, and 404 otherwise.
- The test and the gate pass.

---

## Report (written by the worker when done)

### What I did
- **Contract** (`packages/api-contract/src/routines.ts`): added `HttpApiEndpoint.get('listForTopic', '/topics/:id/routines', { params: RoutineIdParams, success: Schema.Array(Routine) })` right after `listForGroup`.
- **Read helper** (`apps/server/src/routines/reads.ts`): added `listVisibleTopicRoutines(db, topicId, userId): Promise<PublicRoutine[] | null>`. It returns `null` when `findTopicById` finds nothing or `canSeeTopic` is false, and otherwise `listRoutinesForTopic(db, topicId)`. Imported `listRoutinesForTopic` from `./queries` alongside the existing `toPublicRoutines`. File is 239 lines, under the 400 cap.
- **Handler** (`apps/server/src/routines/api.ts`): handled `'listForTopic'` after `listForGroup`. It calls the helper; `null` throws `new HttpError(404, 'not_found', 'Topic not found')`; otherwise it returns `rows.map(toListWire)`. A topic the caller cannot see answers exactly like a missing one.
- **Test** (`apps/server/src/routines/topic-routines.test.ts`): one permission test copied (not imported) from `mine.test.ts`. It seeds an owner and a plain member in one group and one AI, creates a private topic with a `topic_members` row for its creator (mirroring `topics/service.ts`, which adds the creator on private-topic creation), and makes one routine in it with `createPromptRoutine`. It asserts the member gets `null`, the creator gets that routine, and a random missing id gets `null`.

No files outside the Allowed list were touched. No deviations from the spec.

### Checks run
- `pnpm install` → `Done in 16.7s using pnpm v10.32.1`.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/routines/topic-routines.test.ts` → `Test Files 1 passed (1)`, `Tests 1 passed (1)`.
- `pnpm gate` (first run) → `FAIL format` on `apps/server/src/routines/topic-routines.test.ts`; fixed with `pnpm exec prettier --write` on that file only.
- `pnpm gate` (final run) → summary lines:
  ```
  PASS  install (frozen)  (2.9s)
  PASS  format  (1.4s)
  PASS  lint  (2.8s)
  PASS  typecheck  (6.4s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/server  (10.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- The new route picks up the existing `/api` prefix and `Session` middleware from `RoutinesGroup`, so it is covered by the authz sweep automatically; the gate's `tests @zilar/server` run (which includes `authz-sweep.test.ts`) passed.
- The wire mapper is the existing `toListWire`, so the response is the same `Routine` shape as `listForGroup`.
- The web and phone "Tools and routines" rows are out of scope for this task as the spec says.

## Review (written by Claude)

- **Accepted at `be47352d3`.** It's clean, with no nits.
- **What the lead checked:**
  - `listVisibleTopicRoutines` returns null for a missing or unseen topic, so both answer the same 404 and ids can't be probed;
  - the handler reuses `toListWire`;
  - the contract adds one endpoint inside `RoutinesGroup`, so the session and the authz sweep cover it.
- **The lead ran `topic-routines.test.ts`:** 1 passes.
- **Next:** the In this topic row (web W5, phone W6) calls it.

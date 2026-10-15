---
id: T-1514
title: "AI work in topics, step 2 (docs/audit/ai-work-plan.md T2): the topic list carries each topic's AI activity [{aiId, name, avatarUrl?, state}] from the T-1505 read model — server views, contract, chat-core TopicInfo, client mapping, mock seed"
status: merged
milestone: M5
branch: task/T-1514-ai-activity-in-topic-list
model: auto
effort: default
depends_on: []
estimate: 1 day
---

# T-1514: The topic list carries AI activity

## Spec (written by Claude, do not edit)

### Why
This is step 2 of the approved "AI work in topics" plan (`docs/audit/ai-work-plan.md` §6b and §7 T2; the design is in `docs/design/mockups/ai-work/README.md`).

The sidebar will show, on each topic row, the pictures of the AIs at work there, each with its state mark. Step 1 (T-1505, merged) built the read model, `topicAiActivity` in `apps/server/src/topics/ai-activity.ts`. This task puts its answer on the topic list that the web and the phone already load. **No UI here:** the web and mobile UIs are later steps.

### Facts (the lead read them on main, 2026-10-15)
- **The read model:**
  - `topicAiActivity(deps: { db; getGateway: () => TurnWatcher | null }, topics)` returns a `Map<topicId, Array<{ aiId; state: 'working' | 'waiting' | 'done' }>>`; idle AIs are left out;
  - `TurnWatcher` is in `apps/server/src/agents/gateway/stop-types.ts`;
  - the gateway now returns `AgentGateway & TurnWatcher` (`apps/server/src/agents/gateway.ts`).
- **The topic views:** `apps/server/src/topics/views.ts` (346 lines):
  - `buildTopicView` (`:95-125`);
  - `toTopicView` (`:127-141`, one topic);
  - `toTopicViews` (`:322-346`, a batch);
  - `TopicView` is in `apps/server/src/topics/access.ts:45` (382 lines).
- **The callers:**
  - the sidebar's `/api/chats` builds topics with `toTopicViews` at `apps/server/src/chats/api.ts:233-239`. That file is 391 lines, so keep it at or under 400 and split a helper out if needed;
  - the group topic list `apps/server/src/topics/api.ts:95` uses `toTopicViews`;
  - the single-topic routes there use `toTopicView`;
  - `ChatsApiDependencies` (`apps/server/src/chats/api.ts:114`) and `TopicsApiDependencies` (`apps/server/src/topics/api.ts:53`) have no gateway.
- **Wiring:**
  - `apps/server/src/app/routes-messaging.ts:95-97` creates both APIs from `base`;
  - `apps/server/src/app/deps.ts:60` has `getGateway?: () => TurnStopper | null`, which `apps/server/src/startup/components.ts:197` sets to `() => running.gateway`;
  - `apps/server/src/app/routes-ai.ts:113` passes it on with `...opt('getGateway', deps.getGateway)`.
- **AI names and pictures:** `apps/server/src/ais/api.ts:12,114-127` uses `avatarIdsByOwner(db, 'ai', ids)` and `avatarUrlFor(id)` from `apps/server/src/avatars/service.ts`, one query for a list.
- **Contract:** `packages/api-contract/src/topics.ts` (288 lines), `Topic` at `:187`.
- **Client:**
  - `TopicInfo` is at `packages/chat-core/src/types.ts:138-149`;
  - `topicInfoOf` is at `packages/client-core/src/store/chat-rows.ts:176-188` (368 lines).
- **Mock:**
  - `packages/mock-backend/src/domains/topics/view.ts:40-55` builds the topic;
  - the seed (`packages/mock-backend/src/domains/topics/seed.ts`) has `t-devteam-general` (`:18`) and `t-devteam-bug` "Checkout button hidden on Safari" (`:37`);
  - the mock AIs are `ai-dev-1` (Dev-1) and `ai-qa-1` (QA-1).

### Steps
1. **Server, `apps/server/src/topics/ai-activity.ts`:** add `withTopicActivity(deps, views: TopicView[]): Promise<TopicView[]>`.
   - It calls `topicAiActivity` once for all the views (`roomJid` is the view's `chatJid`), then loads the names (one `SELECT id, name FROM ais WHERE id IN …`) and pictures (`avatarIdsByOwner`) of every AI that appears, in one query each.
   - It sets `activity: Array<{ aiId: string; name: string; avatarUrl?: string; state }>` on each view, ordered working, then waiting, then done, then by name. An AI with no name row is left out.
   - Best-effort: any failure leaves `activity: []`.
2. **`TopicView`** (`apps/server/src/topics/access.ts`) gains `activity?: TopicActivityEntry[]` (export the entry type).
3. **Wire it in:**
   - `apps/server/src/chats/api.ts` and `apps/server/src/topics/api.ts` (the list at `:95`) run their `toTopicViews` result through `withTopicActivity`;
   - both dependency types gain `getGateway?: () => TurnWatcher | null`, with a missing one read as `() => null`;
   - `apps/server/src/app/deps.ts` widens `getGateway` to `() => (TurnStopper & TurnWatcher) | null`;
   - `apps/server/src/app/routes-messaging.ts` passes `getGateway` to both APIs (the `opt` pattern of `routes-ai.ts:113`).
   - The single-topic routes keep `toTopicView` without activity.
4. **Contract (`packages/api-contract/src/topics.ts`):** `Topic` gains an optional `activity`, an array of `{ aiId: String, name: String, avatarUrl: optional String, state: String }`. `state` stays a plain string, so a newer state still decodes; a missing array decodes as `[]`.
5. **Client:**
   - `packages/chat-core/src/types.ts`: export `TopicAiState = 'working' | 'waiting' | 'done'` and `TopicAiActivity { aiId; name; avatarUrl?: string; state: TopicAiState }`; `TopicInfo` gains `activity: TopicAiActivity[]`;
   - `packages/client-core/src/store/chat-rows.ts`: `topicInfoOf` maps `topic.activity`, keeps only the three known states, and defaults to `[]`.
   - Fix every other place that builds a `TopicInfo` (typecheck will list them) with `activity: []`.
6. **Mock:**
   - in the seed, `t-devteam-bug` gets `activity: [{ aiId: 'ai-dev-1', name: 'Dev-1', state: 'working' }, { aiId: 'ai-qa-1', name: 'QA-1', state: 'waiting' }]`, and `t-devteam-general` gets `[{ aiId: 'ai-dev-1', name: 'Dev-1', state: 'done' }]`;
   - `view.ts` passes it through, with `[]` for every other topic.
7. **One test** in `apps/server/src/topics/ai-activity.test.ts`: `withTopicActivity` adds the names in state order for two views, and gives `[]` when the read fails.

### Not in scope
- the UI;
- live notices (step 5);
- "mark done" (step 3);
- owner following (step 4).

### Allowed files
- `apps/server/src/topics/ai-activity.ts`
- `apps/server/src/topics/ai-activity.test.ts`
- `apps/server/src/topics/access.ts`
- `apps/server/src/topics/api.ts`
- `apps/server/src/chats/api.ts`
- `apps/server/src/app/deps.ts`
- `apps/server/src/app/routes-messaging.ts`
- `packages/api-contract/src/topics.ts`
- `packages/chat-core/src/types.ts`
- `packages/client-core/src/store/chat-rows.ts`
- `packages/mock-backend/src/domains/topics/view.ts`
- `packages/mock-backend/src/domains/topics/seed.ts`
- `packages/mock-backend/src/domains/topics/tables.ts`
- any file typecheck names for a missing `activity: []` in a `TopicInfo` literal (list them in the Report)
- `work/T-1514-ai-activity-in-topic-list.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/topics/ai-activity.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- `/api/chats` and the group topic list carry `activity` per topic: one batched read, plus one name query and one picture query.
- The client `TopicInfo.activity` is filled.
- The mock shows Dev-1 working and QA-1 waiting on "Checkout button hidden on Safari".
- Every file stays under 400 lines.

---

## Report (written by the worker when done)

### What I did

Server:
- `apps/server/src/topics/ai-activity.ts`: added `withTopicActivity(deps, views)`. It maps each view to an `AiActivityTopic` (`roomJid` = `chatJid`), calls `topicAiActivity` once for the whole batch, then loads the names of the AIs that appear in one `SELECT id, name FROM ais WHERE id IN …` and their pictures in one `avatarIdsByOwner(db, 'ai', ids)` call. It sets `activity` per view, ordered working, then waiting, then done, then by name; an AI with no name row is left out. Best-effort: any failure returns the views with `activity: []`. Added `TopicActivityDeps` whose `getGateway` is optional and read as `() => null`.
- `apps/server/src/topics/access.ts`: exported `TopicActivityEntry` and added `activity?: TopicActivityEntry[]` to `TopicView`.
- `apps/server/src/topics/api.ts`: `TopicsApiDependencies` gained `getGateway?`; the group `list` handler runs its `toTopicViews` result through `withTopicActivity`. Single-topic handlers keep `toTopicView` (no activity).
- `apps/server/src/chats/api.ts`: `ChatsApiDependencies` gained `getGateway?`; the `/api/chats` group topics run through `withTopicActivity`.
- `apps/server/src/app/deps.ts`: left `getGateway` as `() => TurnStopper | null` (widening it as the spec asked broke two callers outside the Allowed files — see Notes).
- `apps/server/src/app/routes-messaging.ts`: narrows the live gateway to its `TurnWatcher` read model with `turnWatcherOf` and passes that getter (`opt(...)`) to the topics and chats APIs. `apps/server/src/topics/ai-activity.ts` exports `turnWatcherOf`.

Contract and client:
- `packages/api-contract/src/topics.ts`: added `TopicActivity` (`{ aiId, name, avatarUrl?, state }`, `state` a plain `String`) and an optional `activity` on `Topic`. Optional so the single-topic routes and older payloads still decode.
- `packages/chat-core/src/types.ts`: exported `TopicAiState` and `TopicAiActivity`; `TopicInfo.activity` is now required.
- `packages/client-core/src/store/chat-rows.ts`: `topicInfoOf` fills `activity` from `topic.activity`, keeping only the three known states and defaulting to `[]`. This was the only place that built a `TopicInfo` literal, so no other file needed the `activity: []` fix (typecheck named none).

Mock:
- `packages/mock-backend/src/domains/topics/tables.ts`: added `MockTopicActivity` and an optional `activity` on `MockTopic` (optional so `routes.ts` and `general-topics.ts`, outside the Allowed files, stay unchanged).
- `packages/mock-backend/src/domains/topics/seed.ts`: `t-devteam-bug` gets Dev-1 working + QA-1 waiting; `t-devteam-general` gets Dev-1 done.
- `packages/mock-backend/src/domains/topics/view.ts`: passes `topic.activity` through, `[]` for every other topic.

Test:
- `apps/server/src/topics/ai-activity.test.ts`: added a `withTopicActivity` suite — two views get their AI names in state order (working before waiting before done) and a failing database read leaves every view's `activity` empty.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics/ai-activity.test.ts` — 10 passed (1 file).
- `pnpm gate` (from the repo root) — passed:
  ```
  gate: 14 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (0.6s)
  PASS  lint  (0.7s)
  PASS  typecheck  (3.5s)
  PASS  effect  (1.5s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/chat-core  (2.0s)
  PASS  tests @zilar/client-core  (9.4s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/server  (25.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- **Deviation — `getGateway` type.** Step 3 asked to widen `apps/server/src/app/deps.ts`'s `getGateway` to `() => (TurnStopper & TurnWatcher) | null`. That does not typecheck: `RunningServer.gateway` (`apps/server/src/startup/lifecycle.ts:29`) is `Pick<AgentGateway, 'stop' | 'postToChat' | 'stopTurn'> | null` and `apps/server/src/ais/stop-turn.test.ts:40` passes a `TurnStopper`-only double, so both fail with "Property 'runningAiIds' is missing". Both files are outside the Allowed files, so instead I left `deps.ts` unchanged and added `turnWatcherOf` in `ai-activity.ts` (a capability check: hand the gateway over as a `TurnWatcher` only when it has `runningAiIds`). `routes-messaging.ts` builds that getter and passes it to both APIs. The two API dependency types are exactly the spec's `getGateway?: () => TurnWatcher | null`. If you would rather have the literal `(TurnStopper & TurnWatcher)` type, `startup/lifecycle.ts` (widen `RunningServer.gateway`) and `ais/stop-turn.test.ts` need to be in scope.
- Files typecheck named for a missing `activity: []` on a `TopicInfo` literal: none. `packages/client-core/src/store/chat-rows.ts` was the only builder and I updated it.
- Contract `activity` is optional (the two list routes always set it; the single-topic routes omit it), matching the spec's "optional … a missing array decodes as `[]`": the `[]` default lives in `topicInfoOf`, where `TopicInfo.activity` is required.
- `withTopicActivity` takes `getGateway?` and reads a missing one as `() => null`, so both API dependency types keep the field optional.
- Mock `MockTopic.activity` is optional so `domains/topics/routes.ts` and `domains/chats/general-topics.ts` (outside the Allowed files) need no change.
- Line counts of the changed non-exempt files stay under 400 (largest: `apps/server/src/chats/api.ts` 398, `packages/client-core/src/store/chat-rows.ts` 397, `apps/server/src/topics/access.ts` 394).

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean (0 findings) for head `640b4a77f`.
- **The lead read the diff:**
  - `withTopicActivity` makes one `topicAiActivity` call per batch, then one name read (`ais`) and one picture read (`avatarIdsByOwner`); entries are ordered working, waiting, done, then by name. Any failure gives `activity: []`;
  - `/api/chats` and the group topic list (`topics/api.ts:96-103`) run through it; the single-topic routes don't;
  - the gateway is narrowed with `turnWatcherOf` in `routes-messaging.ts` instead of widening `deps.ts`, which is fine;
  - the contract adds an optional `activity` with `state` as a plain string. `topicInfoOf` keeps only the three known states and defaults to `[]`.
- **Watch:**
  - `chats/api.ts` is now 398 lines, `chat-rows.ts` 397 and `access.ts` 394. The next change to any of them must split first;
  - live: check the deploy logs and that `/api/chats` still answers 401 signed out.


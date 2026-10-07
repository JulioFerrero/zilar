# Effect plan for `apps/server/src/agents`

Status: audit only, written 2026-10-07 (T-0503). **This document changes no code.**

Scope: `apps/server/src/agents/` — `gateway.ts` (2,841 lines) plus `stream.ts`,
`reply.ts`, `context.ts`, `tools.ts`, `tool-guide.ts`, `delegation/service.ts`,
`listener/score.ts` and `memory/*.ts` (7,295 non-test lines total). The goal is a
sequence of small, behaviour-preserving tasks that move the runtime onto Effect,
following `docs/EFFECT_GUIDE.md` and the already-merged conversions
(T-0484, T-0486, T-0488, T-0489, T-0492, T-0495). Wave 6 of
`docs/audit/effect-everywhere-plan.md:507` lists `agents` last in the server
bulk; this file turns that one line into an ordered plan.

Method: every claim below was read from the code at the cited `file:line`. Test
names are quoted so the reviewer can check the pinned behaviour. Where a number
cannot be derived from the code, it is a question, not a guess (see the end).

---

## 1. Map of `gateway.ts`

`createAgentGateway` (`gateway.ts:534-2841`) is one factory whose inner functions
close over five mutable maps and three module-level flags (`gateway.ts:545-558`).
Everything below is inside that factory unless marked otherwise.

### 1.1 Declarations, types and pure helpers

| Responsibility | Lines | Owns | Side effects |
| --- | --- | --- | --- |
| Public contracts: `GatewayLogger`, `AgentGatewayDeps`, `AgentGatewayConfig`, `AgentGateway` | `101-158`, `293-316` | — | none (types) |
| Exported constants (`RECONCILE_INTERVAL_MS`, retry delays, `GATEWAY_RESOURCE`, group/round/listener caps) | `160-204` | — | none |
| Internal queue/session types (`PendingMessage`, `RoomPendingMessage`, `RoomRound`, `RoomSubscription`, `RoomListenerMessage`, `RoomListenerState`, `AiSession`) | `206-291` | — | none |
| `isAiSender` `318-320`, `retryDelayMs` `322-324`, `errorName` `326-331`, `denialReasonForModel` `336-347`, `formatModelText` `354-359`, `toRedactedError` `361-369` | `318-369` | — | none (pure; `toRedactedError` builds a redacted `Error`) |

### 1.2 Database reads

| Function | Lines | Reads |
| --- | --- | --- |
| `loadActiveAi` | `371-385` | `ais` by id + `status='active'` |
| `loadOwnerName` | `387-395` | `user.name` by owner id |
| `listAiRooms` | `401-471` | `group_ais` ⋈ `groups`, `topics`, `topic_ais`, plus `allowedTopicAiIds` per private topic (`436`) |
| `loadRoomGateState` | `493-527` | `groups`, `topics`, `topic_members`, `group_members` |
| `loadOwnerId` | `1504-1511` | `ais.owner` |
| `loadRoomJid` | `1515-1525` | `groups.roomLocalpart` |
| `loadTopicRoomJid` | `1530-1540` | `topics.roomLocalpart` + archive check |

### 1.3 Session lifecycle

| Function | Lines | Owns / touches | Side effects |
| --- | --- | --- | --- |
| `connectAi` | `1312-1392` | creates `AiSession` (`1337-1351`), `sessions` | `createCore` (`1320`), `core.on(...)` (`1353-1368`), `core.connect()` (`1371`), `syncAiRooms` (`1391`), `issueXmppToken` (`1325`) |
| `disconnectAi` | `1394-1422` | `sessions`, `session.stopped`, `retryTimer`, `unsubs` | `core.disconnect()` (`1417`), `dropRoomListenerIfUnused` (`1401`) |
| `scheduleRetry` | `1078-1105` | `session.retryAttempt`, `retryTimer` | `setTimeout` (`1087`), `core.connect()` (`1093`) |
| `syncAiRooms` | `1429-1476` | `session.rooms` | `listAiRooms` (`1435`), `joinRoom`/`leaveRoom` (`1455`, `1452`) |
| `leaveRoomQuietly` | `1478-1499` | `session.rooms/roomPending/roomBusy/roomTurns` | `core.leaveRoom` (`1490`) |
| `handleReplaced` | `1604-1614` | `superseded`, `session.pending/roomPending` | `disconnectAi` (`1613`) |
| `sessionIsLive` | `1113-1115` | `sessions` | none |

### 1.4 Send paths (the kill-switch gate)

`liveSendMessage` `1121-1132`, `liveSendTyping` `1288-1298`,
`liveMarkDisplayed` `1300-1310`, `liveProgressReporter` `1234-1286`,
`postToChat` `1557-1597` (+ `sendOptions` `1544-1546`). All check
`sessionIsLive` immediately before the XMPP call, so a `stopped`/replaced
session silently drops the send. `postToChat` also validates the group/topic
room membership (`1582`, `1592`) and looks up owner/room JIDs (`1569`, `1578`,
`1588`).

### 1.5 Turn queue — DM

| Function | Lines | Owns / touches | Side effects |
| --- | --- | --- | --- |
| `handleIncoming` | `1656-1688` | `session.pending` | `void pumpSession(...).catch` (`1682`) |
| `pumpSession` | `2462-2475` | `session.busy` | serializes turns |
| `runSessionTurn` | `2477-2692` | — | `loadActiveAi` (`2481`), `checkDailyLimit` (`2522`), `draftHub.publishTurn` (`2537`), `ensureAiModel` + key decrypt (`2540-2550`), `core.loadHistory` (`2554`), `loadMemoryContext` (`2568`), `buildDmMessages` (`2595`), `runDmTurn` (`2624`), `sendBudgetWarnings` (`2663`), `startCompaction` (`2669`) |

### 1.6 Turn queue — group and topics

| Function | Lines | Owns / touches | Side effects |
| --- | --- | --- | --- |
| `handleRoomIncoming` | `1913-2007` | `roomRounds`, `session.roomPending` | round open (`1940-1948`), hop budget (`1973-1988`), `noteListenerMessage` (`1957`), `void pumpRoom(...).catch` (`2001`) |
| `pumpRoom` | `2011-2035` | `session.roomBusy` | serializes turns; delegation always its own turn (`2022-2029`) |
| `sessionForAiJid` | `1901-1908` | `sessions` | none |
| `runGroupSessionTurn` | `2037-2458` | `session.roomTurns`, `roomRounds` | `loadActiveAi` (`2044`), `loadRoomGateState` (`2053`), daily limit (`2128`), rate limit (`2138-2152`), round budget (`2158-2171`), wake line (`2177`), group/topic name reads (`2192-2212`), `ensureAiModel`+key (`2215-2225`), `loadHistory` (`2229`), `loadMemoryContext` (`2242`), handoff targets read (`2281-2295`), `buildGroupMessages` (`2300`), `runGroupTurn` (`2371`), `finishDelegation` (`2412`), `sendBudgetWarnings` (`2425`), `startCompaction` (`2431`) |

### 1.7 Listener (T-0475)

`noteListenerMessage` `1695-1762` (per-room debounce; `setTimeout` at `1758`),
`clearListenerTimer` `1764-1769`, `fireRoomListener` `1773-1832` (DB switch +
`loadRoster` `1804` + `scoreRoom` `1808`; generation guard `1779`/`1817`),
`wakeListenerAis` `1838-1882` (queues the latest window message and pumps),
`dropRoomListenerIfUnused` `1885-1897`. State: `roomListeners`
(`gateway.ts:551`).

### 1.8 Tool execution and actions

`executeToolCall` `783-1017` (per-turn closure; memory tools, delegation tools,
persona tools, `request_action`), `runRequestAction` `1027-1076`,
`denialReasonForModel` `336-347`, `formatModelText` `354-359`. Closes over
`sessions` (`876`), `roomRounds` (`885`), `pumpRoom` (`940`), `deps` and
`deps.now` (`935`). Side effects: `ais.persona` write (`982`, `1010`), memory
rows (`829`, `834`, `851`), delegation rows (`896`, `969`), the action gateway
(`1040`), and DB reads before each.

### 1.9 Budget, notices and memory

- `utcDay` `643-645`; notice maps `637-641`; `checkDailyLimit` `655-701` (calls
  `getAiUsage`, soft cap, one notice per AI/chat/day); `sendBudgetWarnings`
  `708-749` (80% daily/monthly, one per kind per AI/chat/day).
- `aiDeps` `568-578`; `secretsFor` `580-585`; `nowMs` `560-562`; `roomJidFor`
  `564-566`.
- `loadMemoryContext` `590-633` (`indexMemory` then `listFacts` +
  `renderMemoryBlock`; never throws); `runningCompactions` (`1173`) and
  `startCompaction` `1175-1216` (never awaited, re-checks the round gate).
- `checkDmRoundGate` `1139-1166` (kill switch + budget before each tool round).
- `withToolGuide` `1223-1225`.

### 1.10 Lifecycle

`reconcile` `1616-1654`; `start` `2694-2803` (wires `onAiLifecycle`
`2710-2748`, `onGroupAi` `2749-2772`, `onTopicAi` `2776-2796`; the reconcile
`setInterval` at `2798-2802`); `stop` `2805-2831` (clears interval, unsubscribes,
disconnects every session, clears listener timers). Owns `started` (`556`),
`timer` (`557`), `unsubscribes` (`558`), `superseded` (`549`).

### 1.11 Timers (all in-memory, no `unref`)

1. Retry backoff per session: `setTimeout` at `1087`, cleared at `1404-1407`.
2. Listener debounce per room: `setTimeout` at `1758`, cleared at `1764-1768`
   and `2828`.
3. Reconcile safety net: `setInterval` at `2798`, cleared at `2808-2811`.

Effect's sleep uses a plain `setTimeout` without `unref`
(`docs/EFFECT_GUIDE.md:170`), so any loop fiber must be interrupted on `stop`.

---

## 2. Seams

The factory can be cut into modules without changing behaviour if the mutable
registry maps stay owned by the composition root (`gateway.ts`) and are passed
in, or move together with the functions that only touch them. Proposed layout:

```
agents/gateway/
  contracts.ts    types, deps, config, exported constants, queue/session types
  db.ts           the seven DB lookups (§1.2)
  registry.ts     sessions/superseded + connect/disconnect/retry/sync/leave/
                  replaced/sessionIsLive + the live* send wrappers + postToChat
  budget.ts       notice maps, utcDay, checkDailyLimit, sendBudgetWarnings,
                  checkDmRoundGate
  memory.ts       loadMemoryContext, runningCompactions, startCompaction
  tool-exec.ts    executeToolCall, runRequestAction
  listener.ts     roomListeners + note/clear/fire/wake/drop
  dm-turn.ts      handleIncoming, pumpSession, runSessionTurn
  group-turn.ts   handleRoomIncoming, pumpRoom, sessionForAiJid,
                  runGroupSessionTurn, roomRounds
  lifecycle.ts    reconcile, start, stop, notifier subscriptions
  index.ts        createAgentGateway: wires the above, owns all maps
```

`gateway.ts` stays as the import path for `index.ts:16` and
`AgentGateway` consumers, re-exporting from `gateway/index.ts`, so no caller
changes.

Seam detail (functions → shared state they need):

1. **`contracts.ts`** — pure move of `gateway.ts:101-316`. Nothing to pass.
2. **`db.ts`** — pure move of `gateway.ts:371-527` and `1504-1540`. Each
   function already takes `db` as its first argument; no closure state.
3. **`budget.ts`** — `637-645`, `655-749`, `1139-1166`. Needs `deps`
   (`litellm`, `db`, `now`), `logger`, and the three notice maps (they move
   with it). `checkDmRoundGate` needs `sessionIsLive`.
4. **`memory.ts`** — `590-633`, `1173-1216`. Needs `deps.db`, `deps.archive`,
   `logger`, `secretsFor`, `nowMs`, the LLM inputs `baseUrl`/`model`, and
   `checkDmRoundGate` (budget).
5. **`tool-exec.ts`** — `783-1076`. Needs `deps`, `logger`, `secretsFor`,
   `nowMs`, plus three cross-seam references: the `sessions` map (`876`),
   `roomRounds` (`885`), the session-liveness check (`797`), and `pumpRoom`
   (`940`). Pass a small `ToolHost` interface
   (`sessionForRoom`, `live`, `queueGroupTurn`, `roundFor`) instead of the
   whole factory. This is the one seam that is not a pure move.
6. **`registry.ts`** — `545`, `549`, `1078-1132`, `1288-1310`, `1234-1286`,
   `1312-1614`, `1504-1540`, `1544-1597` minus the tool-exec function. Needs
   `deps`, `logger`, `secretsFor`, `nowMs`, `roomJidFor`, `started`,
   `superseded`, the `sessions` map, and callbacks into
   `syncAiRooms` (self), `dropRoomListenerIfUnused` (listener), and
   `pumpRoom`/`pumpSession` (turns) — keep those as injected callbacks to
   avoid a cycle.
7. **`listener.ts`** — `1695-1897`. Needs `deps` (`db`, `listener`), `logger`,
   `baseUrl`, the `sessions` map, `roomRounds`, `sessionIsLive`, and the
   `pumpRoom` callback. Owns `roomListeners`.
8. **`dm-turn.ts`** — `1656-1688`, `2462-2692`. Needs `deps`, `logger`,
   `turnLogger`, `secretsFor`, `nowMs`, `baseUrl`, `draftHub`, the `sessions`
   map, and `registry`/`budget`/`memory`/`tool-exec` functions. Owns the DM
   `pending`/`busy` fields only.
9. **`group-turn.ts`** — `1901-2007`, `2011-2458`. Needs the same as
   `dm-turn` plus `roomRounds`, `listener` and `registry.sessionForAiJid`.
   Largest seam (~540 lines); see the split note in §3.
10. **`lifecycle.ts`** — `1616-1654`, `2694-2831`. Needs every module above;
    owns `started`, `timer`, `unsubscribes`.

One shared state fact that constrains ordering: `executeToolCall` reads
`sessions` and `roomRounds` directly (`gateway.ts:876,885`) and calls
`pumpRoom` (`940`). So `tool-exec.ts` cannot be a pure move until the registry
exposes lookups; that is why task G4 comes after G5 in the list, or lands
together with G5.

---

## 3. Ordered task list

Each task is one PR with an unchanged-test gate. "Changed lines" is the
worker's edit effort, not the file size. Idioms cite the merged example that
established them. Tests listed are the suites that must pass **unchanged**; the
named cases are the ones most likely to catch a regression.

Sizing note: 7,295 lines do not fit into 12 tasks of ≤400 changed lines; a
strict cap needs ~19. The list below keeps 12 tasks, groups the small pure
modules (which need no conversion), and marks the two oversized tasks
(G8, C2) so the lead can split them before dispatch. This is called out as a
question at the end.

| # | Task | Files | Phase | Est. changed | Deps | Parallel with | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| G1 | Extract contracts, pure helpers and DB lookups | new `gateway/contracts.ts`, `gateway/db.ts`; `gateway.ts` | extract | ~440 (split at impl if >400) | — | — | low |
| G2 | Extract budget, notices and the round gate | new `gateway/budget.ts`; `gateway.ts` | extract | ~230 | G1 | G3,G4 | low |
| G3 | Extract memory context and compaction | new `gateway/memory.ts`; `gateway.ts` | extract | ~210 | G1,G2 | G2,G4 | low |
| G4 | Extract the tool executor and `request_action` | new `gateway/tool-exec.ts`, `gateway/tool-host.ts`; `gateway.ts` | extract | ~330 | G1,G5 | G7 | medium |
| G5 | Extract the session registry, lifecycle and live send wrappers | new `gateway/registry.ts`; `gateway.ts` | extract | ~360 | G1,G2 | G2,G3 | medium |
| G6 | Extract the listener window | new `gateway/listener.ts`; `gateway.ts` | extract | ~230 | G1,G5 | G7 | low |
| G7 | Extract the DM turn | new `gateway/dm-turn.ts`; `gateway.ts` | extract | ~260 | G1,G2,G3,G5 | G4,G6 | medium |
| G8 | Extract the group/topic turn | new `gateway/group-turn.ts`; `gateway.ts` | extract | ~540 (split G8a ingest+pump+gates, G8b turn body) | G1–G7 | — | high |
| G9 | Extract start/stop/reconcile | new `gateway/lifecycle.ts` and `gateway/index.ts`; `gateway.ts` | extract | ~220 | G1–G8 | — | medium |
| C1 | Streaming and one completion call on Effect | `agents/stream.ts`, `agents/reply.ts` (`requestCompletion` `205-287`) | convert | ~320 | G7,G8 | G9 | medium |
| C2 | Tool loop, turn adapters and the three timer loops on Effect | `agents/reply.ts` (`432-1085`, `1257-1503`), `gateway/*` timer sites | convert | ~600 (split C2a tool loop, C2b turn adapters+loops) | C1,G9 | — | high |
| C3 | Convert the remaining async leaves where a boundary helps | `memory/indexer.ts`, `memory/store.ts`, `memory/compactor.ts`, `delegation/service.ts`, `listener/score.ts` | convert | ~400 per module (3–4 PRs) | G3,G6 | C2 | medium |

### Task details

**G1 — contracts, helpers, lookups.** Move `gateway.ts:101-369` and
`371-527` verbatim. `gateway.ts` re-exports `AgentGatewayDeps`,
`AgentGatewayConfig`, `AgentGateway`, `GatewayLogger` and the constants so
`index.ts:16` and the tests keep importing the same path (`gateway.test.ts`
imports the factory and constants). No Effect. Tests: all of
`gateway.test.ts` (2,841-line module; zero assertions change). Risk low: a
mistyped re-export is a typecheck failure, not a behaviour failure.

**G2 — budget.** Move `637-645`, `655-749`, `1139-1166`. Functions keep the
same signatures. Tests that pin this: "runs a normal turn under the limit"
(`gateway.test.ts:1302`), "fails open when the spend lookup fails" (`1309`),
"sends one notice per DM per day…" (`1324`), "sends the reply first, then one
daily warning…" (`1402`), "warns again on the next UTC day" (`1435`), "sends
both warnings once each…" (`1461`), "enforces the daily limit in rooms…"
(`3396`), "warns in the room after the reply…" (`3420`). No Effect yet.

**G3 — memory context + compaction.** Move `590-633`, `1173-1216`. Tests:
"reads pinned facts into a second system message" (`874`), "still replies when
the memory index fails, logging a redacted warning" (`908`), "summarises a
pending block after the reply…" (`2150`), "skips compaction when the daily
limit is crossed…" (`2197`). No Effect yet.

**G4 — tool executor.** Move `783-1076`; introduce a `ToolHost` interface for
the three cross-seam reads (`sessions`, `roomRounds`, `sessionIsLive`) and the
`pumpRoom` callback (`gateway.ts:876,885,940`). Tests: "updates the persona by
chat…" (`1678`), "saves a remembered fact…" (`1949`), "refuses a sixth
remember in one turn after five saved" (`2015`), "routes a tier-2
request_action through the action gateway with session-derived ids" (`2299`),
"cannot be tricked by an aiId or groupId smuggled inside args" (`2327`), "maps
every RequestOutcome…" (`2363`), "a stopped AI answers 'the AI was stopped'…"
(`2445`), delegation cases `6247-6723`. Since this crosses seams, run it after
G5 (the registry) and before G8.

**G5 — registry + lifecycle + live wrappers.** Move `545`, `549`,
`1078-1132`, `1234-1310`, `1312-1614`, `1544-1597` (minus executor). Inject the
listener and turn-pump callbacks to avoid import cycles. Tests: lifecycle at
`gateway.test.ts:560-750` ("connects every active AI on start…", "keeps the
others when one AI fails to connect", "never keeps a login that finishes after
shutdown"), replaced at `1041-1095`, read markers `1098-1167`, kill switch
`4233-4471`, `postToChat` `4516-4645`, topics join `5036-5129`.

**G6 — listener.** Move `1695-1897` with `roomListeners`. Tests:
`gateway.test.ts:5620-5835` ("wakes the scored AI…", "records a message once
for two AIs…", "fires at everyN without waiting for quiet", "drops a scoring
result when a newer human message arrives", "clears the pending timer when the
AI is disconnected") and the wake-line cases `6777-6843`.

**G7 — DM turn.** Move `1656-1688`, `2462-2692`. Tests: "replies to the owner
DM…" (`811`), "builds user and assistant turns…" (`851`), "runs 3 messages
during one slow turn as exactly 2 calls…" (`989`), "sends one displayed marker
per turn…" (`1098`), streaming drafts `2666-2858`. No Effect yet.

**G8 — group/topic turn.** Move `1901-2007`, `2011-2458`. This is the
oversized task: split at implementation into **G8a** (ingest, pump, gate
loading, rate/round budgets — `1901-2171`) and **G8b** (history, memory,
handoff/delegation roster, `runGroupTurn`, finish — `2182-2458`). Tests:
groups `gateway.test.ts:2981-3457`, request_action in groups `3625-4175`, AI
handoff `5906-6152`, delegation tools `6247-6775`, topic naming `5332`.

**G9 — lifecycle.** Move `1616-1654`, `2694-2831`; `gateway/index.ts` becomes
the composition root and `gateway.ts` a re-export shim. Tests: everything in
`lifecycle` (`560-793`) plus reconcile tests "disconnects an AI disabled after
start on the next reconcile" (`697`), "retries a failed join on reconcile"
(`3074`), "resets the superseded set on restart" (`1079`), "a 'restart' …
leaves a stopped AI offline" (`4440`).

**C1 — streaming + one completion.** Convert `agents/stream.ts` and
`reply.requestCompletion` (`reply.ts:205-287`) together. Idioms: typed errors
(`Data.TaggedError`) at the module edge and `Effect.fnUntraced` with
`Effect.fn.Return` (T-0492 `voice-transcription/pipeline.ts:45-54,92-106`);
`Effect.tryPromise` + `Effect.timeoutOrElse` (T-0484 `web-tools/guarded-fetch.ts:204-209`,
T-0492 `pipeline.ts:96-104`); `Effect.catchCause` + `Cause.squash` for the
provider-vs-unexpected split (T-0492 `pipeline.ts:135-147`). Keep the exported
`Promise` shapes (`completeChat`, `consumeChatCompletionStream`) identical.
Tests: `stream.test.ts` (all 9), `reply.test.ts:119-193` ("posts the exact
request shape…", "redacts the virtual key when the error body echoes it back",
"maps a stream broken midway to the transient text" at `:808`), and the
"never leaks" assertions (`reply.test.ts:1140`). Risk: the exact fixed failure
texts (`reply.ts:29-33`) and the redaction of provider text must not move.

**C2 — tool loop + turn adapters + timer loops.** Convert
`reply.runToolLoop`/`runLoopRound`/`executeToolCalls` (`reply.ts:491-894`) and
`runDmTurn`/`runGroupTurn` (`432-484`, `908-1503`), plus the three gateway
timers into fibers. Split into **C2a** (the tool loop, `reply.ts:400-1085`) and
**C2b** (turn adapters `432-484`,`908-1503` + timers). Idioms: `Effect.fnUntraced`
for the loop step; `Effect.repeat`+`Schedule.spaced` for the reconcile/retry
loops (T-0486 `machines/hub.ts:123-136`; T-0488 `routines/scheduler.ts:74-88`,
`approvals/sweeper.ts:77-91`); `Effect.catchDefect` when a loop must survive a
throw (T-0486) and **not** `catchCause` (EFFECT_GUIDE:169); `Effect.runFork` +
`Fiber.interrupt` for `stop` (T-0486 `hub.ts:188-196`, T-0488 `sweeper.ts:94-104`);
`Effect.acquireRelease` for the `XmppCore` lifetime (T-0489
`sandbox/run-tool.ts:361-373`); the runtime from T-0495
(`effect/runtime.ts:30-38`). Tests: `rounds.test.ts` (all), `reply.test.ts`
tool cases `325-715` and group tool cases `1155-1379`, `gateway.test.ts`
"posts one progress message and corrects it on the next round" (`4780`),
"logs the per-turn tool counts line…" (`4856`), "a reply in flight when the
stop arrives is dropped" (`4261`), "a throwing action gateway is logged but the
turn still gets a fixed failure text" (`2556`). Risk high: the loop's exact
round/cap/wall-clock ordering (`reply.ts:786-894`) is pinned by
`rounds.test.ts:269,429,446`.

**C3 — async leaves.** `memory/indexer.ts` (transactions + advisory lock at
`209-324`), `memory/store.ts` (`addFact` transaction `373-411`, `clearMemory`
`577-598`), `memory/compactor.ts`, `delegation/service.ts` (conditional updates
`237-248`, `257-268`), `listener/score.ts` (single model call `200-233`). Use
`Effect.fnUntraced` + `Effect.promise` for DB so a DB failure still rejects
unwrapped (EFFECT_GUIDE:101-112), and typed errors only for provider calls
(`listener/score.ts:210-220`). The pure modules (`context.ts`, `tools.ts`,
`tool-guide.ts`, `memory/tree.ts`, `memory/secrets.ts`) **stay unchanged**:
they have no async boundary and `docs/EFFECT_GUIDE.md:58-59` says not to invent
services for them. Tests: `memory/*.test.ts`, `delegation/service.test.ts`,
`listener/score.test.ts`, `memory/cleanup.test.ts`. This task is 3–4 PRs, one
per module.

### Parallelism

```
G1 ─┬─> G2 ─┬─> G3 ──┐
    ├─> G5 ─┼─> G6 ──┼─> G7 ─┐
    │        └─> G4 ──┘       ├─> G8 ─> G9 ─> C2 ─┐
    │                          │                    ├─> C3
    └──────────────────────────┴─> C1 ─────────────┘
```

G2/G3/G5 can run in parallel after G1. G4 needs G5's registry lookups. G7 and
G6 can run in parallel. G8 is serial (touches every prior seam). C1 can start
in parallel with G8/G9 because `stream.ts`/`requestCompletion` do not import
the gateway. C3 can run in parallel with C2.

---

## 4. Hazards

Concurrency, ordering and intentional swallowing that the tests pin. A task
that changes any of these without changing the matching test breaks behaviour.

### 4.1 Kill switch checked immediately before every send

`sessionIsLive` (`gateway.ts:1113-1115`) is re-checked inside every `live*`
wrapper (`1128`, `1246`, `1272`, `1294`, `1306`) and in `postToChat`
(`1565`). Tests: "a reply in flight when the stop arrives is dropped, not
delivered" (`gateway.test.ts:4261`), "a persona change requested by a turn that
was running when the stop arrived is not applied" (`4294`), "queued,
not-yet-started turns are dropped when a stop arrives" (`4356`), "a stopped AI
never calls the action gateway or sends a room reply" (`4082`), "returns false
and sends nothing for a stopped AI" (`4594`). When the send paths move to a
module (G5), the liveness check must stay at the send site, not at the caller.

### 4.2 Promises intentionally not awaited

- `void pumpSession(...).catch` (`gateway.ts:1682`), `void pumpRoom(...).catch`
  (`940`, `1868`, `2001`): the pump is fire-and-forget from the event handler.
- `void (async () => { … })()` in `startCompaction` (`1181`): the compaction
  must never delay or fail the reply; `runningCompactions` (`1173`) makes it
  one per `(aiId, chatKey)`.
- Notifier callbacks: `void loadActiveAi(...).then(...).catch(...)`
  (`2718`, `2760`, `2784`) and `void disconnectAi(...).catch(...)` (`2739`).

Converting these to `Effect.runFork` is the natural move, but the fiber must be
tracked so `stop()` can interrupt it (EFFECT_GUIDE:170). Tests:
"summarises a pending block after the reply…" (`gateway.test.ts:2150`),
"skips compaction when the daily limit is crossed…" (`2197`), "connects an AI
created after start through the notifier" (`599`), "disconnects an AI deleted
after start through the notifier" (`643`).

### 4.3 Exceptions intentionally swallowed

- `unsub()` during disconnect/stop: `gateway.ts:1408-1414`, `2812-2819`.
- `leaveRoomQuietly` logs and returns (`1491-1496`).
- `handleReplaced` and `runGroupSessionTurn`/`runSessionTurn` call
  `disconnectAi(...).catch(() => undefined)` (`1613`, `2046`, `2483`).
- The final failure send and typing state: `2449-2451`, `2454-2456`,
  `2680-2681`, `2687-2689`.
- `stop()` disconnects every session inside `try/catch` so one failure stops
  nothing else (`2820-2826`).

These are deliberate; a conversion must keep them best-effort, not turn them
into typed failures.

### 4.4 Serialization per session and per room

- DM: `pumpSession` guards on `session.busy` (`2462-2475`); test "runs 3
  messages during one slow turn as exactly 2 calls, the second seeing all 3"
  (`gateway.test.ts:989`).
- Room: `pumpRoom` guards on `session.roomBusy` (`2011-2035`); coalescing test
  "coalesces a burst of mentions like DMs" (`3324`).
- A delegated trigger is always its own turn so its row is not left `working`
  (`2022-2029`); tests "delegates to an accepting AI, wakes it, and stores the
  completed reply" (`6247`), "leaves a delegated row failed when the worker is
  over its daily limit" (`6723`).
- The round budget is per human message (`1936-1948`), with the rate stamp
  refunded on a dropped turn (`2160-2161`). Tests: "drops the 7th turn in 10
  minutes with one log line" (`3267`), "caps a round at four AI turns for one
  human message" (`5778`), "opens one round when the same message reaches
  several sessions" (`5798`), "keeps one human message at four AI turns across
  two hops" (`6102`).
- The handoff hop budget is counted once per message id, across sessions
  (`1977-1987`); tests "counts one hop when several sessions see the same AI
  message" (`6032`), "stops an A to B to A to B chain after two hops" (`5978`).

### 4.5 Listener debounce and generation guard

`noteListenerMessage` dedupes by message id across sessions and resets on a
mention (`gateway.ts:1722-1755`); `fireRoomListener` captures the generation
and drops a stale result (`1779`, `1817-1819`). Tests: "records a message once
for two AIs and wakes only the scored one" (`gateway.test.ts:5660`), "fires at
everyN without waiting for quiet" (`5677`), "leaves a mention to the mention
path and never scores it" (`5691`), "drops a scoring result when a newer human
message arrives" (`5703`), "wakes nobody when the scoring call throws" (`5732`),
"clears the pending timer when the AI is disconnected" (`5764`). The
`setTimeout` at `1758` becomes `Effect.sleep` only if the generation/dedupe
semantics are preserved; a naive `Stream.debounce` would change the "everyN"
early fire.

### 4.6 Daily/warning notices are in-memory, once per UTC day

Maps at `gateway.ts:637-641`; day key from `deps.now` at `643-645`. Tests:
"sends one notice per DM per day, then stays silent but keeps marking read"
(`1324`), "sends the reply first, then one daily warning, and no second warning
the same day" (`1402`), "sends the existing notice and no warning at 100%"
(`1493`), "enforces the daily limit in rooms: one plain notice, then silence"
(`3396`). Moving these maps must keep the restart-resets-the-map comment
behaviour (`637-641`).

### 4.7 Drafts and progress ordering

`onDelta`/`beforeFinalSend` push drafts (`gateway.ts:2642-2651`); `end` runs
after the final XMPP send (`2659`), including the failure path (`2690`).
Tests: "collapses a burst of deltas to at most 2 drafts…" (`2701`), "flushes
the complete text as a draft before the final XMPP send" (`2736`), "never puts
tool-call arguments in a draft" (`2770`), "publishes end failed only after the
failure DM is sent" (`2858`). The progress message is posted at the first tool
round and retracted after the final text (`1234-1286`, `2368-2396`, `2623-2637`);
tests "posts one progress message and corrects it on the next round" (`4780`),
"a failed progress update does not fail the turn" (`rounds.test.ts:513`).

### 4.8 Reply tool-loop caps and ordering

Wall clock (`reply.ts:406`), call cap (`407`), repeat detection (`646-659`),
truncation (`609-618`), the tool-free last call (`811-816`, `987-1041`), and the
one counts line in `finally` (`881-893`). Tests: "runs three tool rounds and
finishes with text" (`rounds.test.ts:229`), "stops at maxRounds with a final
tool-free call" (`269`), "answers a repeated identical call with 'already done'
and executes once" (`291`), "stops the loop at the wall-clock cap" (`429`),
"stops the loop at 12 tool calls" (`446`), "logs one counts line with real
fields and never content" (`681`), "truncates tool results to 8 KB inside the
untrusted wrapper" (`371`).

### 4.9 Stream truncation is a failure, not a partial reply

`consumeChatCompletionStream` requires `[DONE]` (`stream.ts:170-172`) and maps
a broken socket or bad JSON to `ChatStreamInterruptedError` (`86`, `90`,
`150`). Tests: "accepts a final [DONE] without a trailing newline"
(`stream.test.ts:99`), "fails when the stream ends without [DONE]" (`152`),
"fails on a broken data line and on a dropped connection" (`157`), "maps a
stream broken midway to the transient text without leaking"
(`reply.test.ts:808`). A `Stream` conversion must keep "no `[DONE]` = failure".

### 4.10 Redaction

`gateway.toRedactedError` (`gateway.ts:361-369`) and `reply.redactError`
(`reply.ts:1142-1155`) rebuild the `Error` with `redactSecrets`; the logs must
carry ids only. Tests: "still replies when the memory index fails, logging a
redacted warning" (`gateway.test.ts:908`), "posts the spending-limit text on
429 and leaks no secret" (`1239`), "keeps the others when one AI fails to
connect" (`670`), "leaks no secret into the logs" (`reply.test.ts:1140`),
"never echoes argument values in the rejection reason…" (`tools.test.ts:160`),
"proves the leak assertion bites…" (`reply.test.ts:287`). Typed errors must
stay payload-free (`docs/EFFECT_GUIDE.md:63-69`) or these fail.

### 4.11 Ownership checks after an await

`connectAi` re-checks `started`/`session.stopped`/`sessions.get` after the
login (`gateway.ts:1385`), and `syncAiRooms` re-checks at entry (`1430`); test
"never keeps a login that finishes after shutdown" (`750`). `handleReplaced`
uses `superseded` (`1604-1614`); tests "stands down on replaced and never
reconnects that AI" (`1041`), "clears the superseded set on restart" (`1079`).
Group joins ignore replayed history (`1933`) and re-check membership per turn
(`2088`); tests "makes no turn for delayed history replayed on join" (`3239`),
"makes no turn for a mention from a non-member" (`3253`), "role revoked between
turn start and tool execution: denied, gateway not called" (`3952`).

---

## 5. What streaming needs

Today `requestCompletion` (`reply.ts:205-287`) calls `fetch` with
`AbortSignal.timeout(timeoutMs)` (`226`) and a hard 90 s per call
(`LITELLM_CHAT_TIMEOUT_MS`, `reply.ts:27`). If the response is
`text/event-stream` (`243`), it hands `response.body` to
`consumeChatCompletionStream` (`stream.ts:63-180`), which reads the
`ReadableStream` manually (`67`, `148`), reports cumulative text through
`onDelta` (`99`), and resolves to `{ content, toolCalls }`. Otherwise it parses
a plain JSON body (`266-287`).

**Recommendation: keep the SSE reader as an async Iterable/Promise and put a
single Effect boundary around the whole completion call. Do not convert the
per-chunk parser into a `Stream`.**

Reason. The parser is a pure chunk reducer with two outputs (text deltas and
tool-call accumulation) and its own completion rule ([DONE], `stream.ts:170`).
`Stream.fromReadableStream` exists in Effect 4.0.0
(`node_modules/.pnpm/effect@4.0.0/.../Stream.d.ts:1076`, with
`releaseLockOnEnd`), so a `Stream<Uint8Array>` is possible, but it would move
`stream.test.ts`'s byte-level cases ("survives chunks split mid-line and
mid-JSON", "handles multiple events per chunk and ignores comments",
"rebuilds tool calls split across chunks") onto a new API for no runtime gain:
the reader already resolves exactly once and has no concurrent consumers. The
value Effect adds here is **cancellation and a typed error channel**, not stream
backpressure. Keeping the parser behind one boundary preserves the tests
byte-for-byte and matches the guide's "Effect runs inside; `runPromise` at the
edge" rule (`docs/EFFECT_GUIDE.md:12-28`).

Concretely, C1 should:

1. Wrap `requestCompletion` in `Effect.fnUntraced` returning
   `Effect.fn.Return<ChatCompletionResult, ChatCompletionError-like>`; use
   `Effect.tryPromise` so the interruption `AbortSignal` is handed to `fetch`
   (EFFECT_GUIDE:166) and `Effect.timeoutOrElse` for the deadline so the error
   channel keeps only the typed error (EFFECT_GUIDE:164, T-0484
   `guarded-fetch.ts:204-209`).
2. Keep `consumeChatCompletionStream` a plain `async` function that takes the
   `ReadableStream` and an `onDelta`, wrapped by `Effect.tryPromise`; map
   `ChatStreamInterruptedError` to the same typed error (`reply.ts:258-260`).
3. Hold the `AbortController`/reader lock with `Effect.acquireRelease` only if
   the timeout must abort the live socket; `fetch` + `AbortSignal` already
   covers the abort if the signal is the one `Effect.tryPromise` provides
   (T-0489 `sandbox/run-tool.ts:361-373` for the scoped pattern).
4. If a `Stream` is later wanted for tokens (e.g. a UI SSE endpoint), build it
   with `Stream.fromReadableStream` at that edge, not around the parser.

The DM draft pipeline (`gateway.ts:2642-2651`) is the one place a `Stream` would
fit naturally: `onDelta` is already a push callback, and
`Stream.runForEach`/`Stream.tap` could own it later (C2). That is a follow-up,
not part of C1.

---

## Unknowns / open questions

Listed as questions because the code does not answer them:

1. **Task count vs size.** A strict ≤400-changed-lines cap needs ~19 tasks for
   the 7,295 non-test lines, not 6–12. Should G1, G8 and C2 be split at
   dispatch (making the list 15–16), or is "about 400" allowed to stretch to
   ~550 for G8/G2? This plan chooses 12 with explicit split points; the lead
   decides.
2. **How far to convert the pure leaves.** `context.ts`, `tools.ts`,
   `tool-guide.ts`, `memory/tree.ts` and `memory/secrets.ts` have no async
   boundary, so `docs/EFFECT_GUIDE.md:58-59` says leave them. Confirm that C3
   should convert only `memory/{indexer,store,compactor}.ts`,
   `delegation/service.ts` and `listener/score.ts`.
3. **Does any task need the shared `ManagedRuntime`?** `effect/runtime.ts:30-38`
   exists, but the agent modules can take their dependencies as arguments and
   run with `Effect.runPromise` per the guide. If `gateway.start()` should run
   from the process runtime, which task introduces it? (Recommend C2b, since
   that is where fibers and `stop()` land.)
4. **`catchCause` vs `catchDefect` for the three now-`setTimeout` loops.** The
   retry loop (`gateway.ts:1087`) retries forever; the reconcile interval
   (`2798`) and listener debounce (`1758`) must not log a false error at
   shutdown. `EFFECT_GUIDE.md:168-169` says `catchDefect`, but the merged
   `routines/scheduler.ts:76` uses `catchCause` on a tick that never
   normal-interrupts. Confirm the pattern per loop in C2b.
5. **Draft hub and action-gateway types.** `gateway.ts` imports `DraftHub`
   (`drafts/hub.ts`) and `ActionGateway` (`actions/gateway.ts`) but treats them
   as plain dependencies; both are outside `agents/`. Confirm their own
   conversion tasks (if any) are ordered before C2, or that the gateway keeps
   calling them as promises.
6. **`index.test.ts`/401 sweep.** The gateway has no HTTP route of its own, so
   the 401 sweep is unaffected; `memory/routes.ts` is an HTTP module and any
   conversion of it (C3) must keep its route tests and the sweep green.
   Confirmed in `memory/routes.test.ts:282` ("requires a session on every
   route"); flagging so C3 keeps it.

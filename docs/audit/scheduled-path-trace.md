# Audit: one scheduled prompt routine, end to end (2026-10-16)

Docs only, no code change. Every claim cites `file:line` read on `main` after T-1649.
No stack was started, so anything that depends on runtime timing is marked
**suspected (check: …)** with the code that decides it.

Why: scheduled AI jobs landed in eight tasks (T-1638…T-1649), each with unit tests.
Julio's first real run is a daily 08:00 `Europe/Madrid` routine ("post the BTC, gold
and S&P 500 prices"). This trace follows one **DM** routine and one **topic** routine
(`groupId` + `topicId`) from the approval card to the `routines` outcome row, then
answers the lead's questions (a)–(h) and lists every integration gap with severity and
the smallest fix.

Path as read (all in `apps/server/src`):

| Hop | Module |
| --- | --- |
| Card | `tools/routine-adapters.ts` → `routines/prompt-routines.ts` |
| Scheduler | `routines/scheduler.ts`, `routines/execute.ts`, `routines/execute-prompt.ts`, `routines/outcomes.ts` |
| Wiring | `startup/components.ts` → `leader/start.ts` → `routines/wiring.ts` |
| Gateway | `agents/gateway/routine-run.ts` → `agents/gateway.ts` → `agents/gateway/dm-turn.ts` / `group-ingest.ts` → `group-turn.ts` / `group-turn-body.ts` → `scheduled-settle.ts` |
| Format | `routines/schedule.ts` |

---

## 1. Hop-by-hop: the DM routine

### 1.1 Approval card → routine row

- **Card.** `tools/routine-adapters.ts:87` builds `routine.schedule`; the prompt form is
  the branch where `parsed.prompt !== undefined` (`:128`). `describe` shows
  `Runs this prompt on that schedule and posts my answer here: "<prompt>"` (`:105-109`),
  truncated to 500 chars for the card (`:32-38`). Tier 2 (`:92`), so a human must
  approve it in the action gateway.
- **Create.** `routine-adapters.ts:131-144` calls
  `createPromptRoutine(db, { aiId, groupId, topicId, title, schedule, prompt, userId }, now, audit)`
  with `ownerOf(db, aiId)` as the user (`:129`).
- **Validate + insert.** `routines/prompt-routines.ts:25`:
  - `groupId`/`topicId` must both be set or both null (`:31-36`);
  - title (`:37`), schedule (`:38-41`), prompt trimmed, 1…2000 chars (`:42-51`,
    `MAX_ROUTINE_PROMPT_CHARS=2000` at `routines/schemas.ts:11`);
  - `enforceRoutineLimit(db, aiId, topicId)` — the 10-per-topic check (`:52`,
    `queries.ts:79-100`, `MAX_ROUTINES_PER_TOPIC=10` at `schemas.ts:8`);
  - `nextRunAt = nextRunAfter(schedule, now)` (`:53`);
  - `INSERT INTO routines (… kind 'prompt', tool_id NULL, prompt, approved_hosts '[]',
    status 'active', next_run_at …)` (`:58-70`); audit `routine.created`,
    `detail { kind: 'prompt' }` only (`:78-89`).
- **Output:** a `routines` row with `kind='prompt'`, `tool_id=NULL`,
  `approved_hosts='[]'`, `status='active'`, `next_run_at = next 08:00 Europe/Madrid`.

### 1.2 Scheduler claim

- **Wiring (leader only).** `startup/components.ts:99-105` defines the `runPrompt`
  closure: it reads `running.gateway` (set at `:254`) and answers `'offline'` when it is
  null, else `gateway.runScheduledTurn(input)`. `components.ts:272-289` passes `post` and
  `runPrompt` into `createLeaderWork`; `leader/start.ts:214-222` calls
  `buildRoutineScheduler({ db, routinesEnabled, toolRunner?, post, runPrompt, audit, logger })`
  inside `start()`, which the advisory-lock `onAcquire` runs (`components.ts:303-306`).
  A follower never starts it. `routines/wiring.ts:44-53` returns `null` unless
  `routinesEnabled` **and** `toolRunner !== undefined`.
- **Loop.** `routines/scheduler.ts:55` builds the handle; `start()` forks the loop after
  one interval (`:172-186`, default `tickMs=30_000` at `:58`); `tick()` = `claimDue` +
  enqueue (`:149-155`); the pool `MAX_CONCURRENT_RUNS = 2` (`:18`) drains the queue
  (`pump`, `:133-147`).
- **Claim.** `claimDue` (`:222-290`) runs
  `SELECT * FROM routines WHERE status='active' AND deleted_at IS NULL AND next_run_at <= now
  ORDER BY next_run_at ASC LIMIT maxPerTick` (`:232-236`, `maxPerTick=5` at `:60`) — **no
  `kind` filter, so a `kind='prompt'` row is picked like any other**. Each row is
  claimed with a compare-and-set: `UPDATE … SET next_run_at = <advanced> … WHERE id=… AND
  status='active' AND deleted_at IS NULL AND next_run_at = <read> RETURNING *` (`:271-274`),
  `advanced = nextRunAfter(parsed, now)` (`:258`). Only the caller whose update returns a
  row runs it (`:277-287`); the loser sees zero rows and skips.
- **Output:** `ClaimedRoutine { row, dueAt }` (`:202-205, 287`) on the queue.

### 1.3 Execute

- `scheduler.ts:96-131` `runOne` re-checks lateness at dequeue (`:100-105`; >1 h →
  `markQueuedMissed`, `:295-315`) and calls `executeRoutine`.
- `routines/execute.ts:106`:
  - step 1 — AI must be `status='active'` (`:121-131`) and, for a topic routine, still in
    the topic room (`:132-135`, `preflight.ts:27-54`);
  - `if (row.kind === 'prompt') → executePromptRoutine(ports, row, options, at, startedAt)`
    (`:140-143`) — the tool/hosts steps 2–5 are skipped.
- `routines/execute-prompt.ts:64`:
  - no runner or no prompt text → `markSkipped` (`:72-76`) — the "runner not wired" case;
  - `claimPromptRun(db, aiId, at)` takes one of 24 slots for the AI's UTC day
    (`:78-82`, `:48-62`);
  - `runPrompt({ aiId, groupId, topicId, routineId, title, prompt })` (`:86-93`); a throw
    becomes `'failed'` (`:94-98`);
  - mapping (`:100-108`): `'replied' → markOk`, `'failed' → recordFailure`,
    `'stopped' | 'limited' | 'offline' | 'not_in_room' → markSkipped`.

### 1.4 Gateway (DM)

- `agents/gateway.ts:327-337` builds the runner from the gateway's own `sessions` map
  (`:67`), `sessionIsLive`, the DB loaders and the two pump kicks; `runScheduledTurn` is
  exported (`:362`) and reached only from `components.ts:104` (never from HTTP).
- `agents/gateway/routine-run.ts:50`:
  - session missing or not live → `'offline'` (`:51-53`); owner id missing → `'offline'`
    (`:55-58`);
  - `body = 'Scheduled run "<title>".\n<prompt>'` (`:60`); `fromJid = ownerJid` (`:59`);
  - **DM** (`groupId === null`): push `{ id, body, fromJid, scheduled: { routineId, onOutcome } }`
    onto `session.pending` and `kickDm(session)` (`:80-86`); a kick while busy is a no-op
    and the running pump picks the item up (`:36-37`);
  - **room**: resolve the room/topic JID (`:88-91`), `'not_in_room'` when the AI's session
    has not joined it (`:92-94`), else queue with `fromResolved: true`,
    `fromNick: ownerName`, `scheduled` and `kickRoom` (`:95-107`);
  - await the outcome under a `ROUTINE_TIMEOUT_MS = 20 min` timer (`:14, 77, 109-112`);
    the first outcome wins, whatever the exit (`:70-76`).
- `kickDm` (`gateway.ts:297-310`) forks `pumpSessionEffect`; `dm-turn.ts:86-108`: one turn
  at a time per AI (`session.busy`, `:89-92`), the batch is **all** pending items
  (`:95`), `settle = settleFor(batch)` (`:96`), `ensuring settle('failed')` (`:97-99`).
- `dm-turn.ts:136-151`: a `scheduled` item counts as the owner's (`:139`); `trigger` is the
  last owner message (`:151`).

### 1.5 Turn sees the prompt, reply lands

- History from MAM (`dm-turn.ts:215-230`), then the batch is merged in: `fresh` keeps
  items whose id MAM has not returned (`:251-263`). The synthetic body is a fresh
  `randomUUID` (`routine-run.ts:81`), so it is **in `fresh`**.
- `buildDmMessages({ history: [...history, ...fresh], trigger, … })` (`:264-274`);
  `context.ts:264-293` appends the trigger only if its id is not already the last history
  id, so the body arrives as a `user` turn via the history (`context.ts:288-292`,
  `toTurn` maps `fromJid === ownerBare` to `user`, `context.ts:185-187`).
- Scheduled turns get **no** action tools: `trigger.scheduled !== undefined → dmActionsList = []`
  (`dm-turn.ts:280-283`); `runDmTurnInput({ …, scheduled: true })` builds `tools` with an
  empty action list (`dm-turn-input.ts:82-84`). Desk tools stay on.
- Reply: `runDmTurn` sends to `ownerJid`, kind `'chat'` (`agents/dm-turn.ts:162`; the owner
  comes from `loadActiveAi`, `dm-turn.ts:121, 131`). `settle(outcome.kind)` at
  `dm-turn.ts:309`, then the 80 % warnings and compaction.

### 1.6 Outcome row

- `routines/outcomes.ts`: `markOk` sets `last_status='ok', consecutive_failures=0`
  (`:63-80`); `markSkipped` sets `last_status='skipped'` (`:44-61`);
  `recordFailure` → `pauseForFailures` sets `last_status='error'`, increments the counter,
  and on the 3rd in a row flips `status='paused', paused_reason='failures'` and posts
  `FAILURE_PAUSE_NOTICE` (`:85-127`). Every path audits `routine.run` with
  `detail { status, durationMs }` only (`routines/audit.ts`); pauses also audit
  `routine.paused`. Prompt text is never written to the audit (`prompt-routines.ts:78-89`).

## 2. Hop-by-hop: the topic routine (the differences)

- Create: same path with `groupId` **and** `topicId` non-null (`prompt-routines.ts:31`).
- Preflight: step 1 also checks topic-room membership (`execute.ts:132-135`,
  `preflight.ts:27-54`) — an archived topic skips (`preflight.ts:38-40`).
- Runner: `groupId !== null` → room JID from `loadTopicRoomJid(topicId)` (or
  `loadRoomJid(groupId)` when `topicId` is null, i.e. General) (`routine-run.ts:88-91`).
- Ingest: a `scheduled` item is admitted **before** the AI-sender, `fromResolved` and
  member checks (`group-ingest.ts:142-148`) — the owner need not be a room member.
  `pumpRoom` makes a scheduled item **its own turn** (`:338-353`).
- Body merge: `group-turn-body.ts:163-176` puts `eligible` into `fresh`;
  `buildGroupMessages` (`:179-193`) emits `${sender}: ${body}` from the trigger
  (`context.ts:206, 242-246`). Tools: no `request_action`, no `ask_people`, no delegation
  for `scheduledTrigger` (`group-turn-body.ts:203-220`); desk tools stay on.
- Reply: `senderName` = `displayNameOf({ fromJid: ownerJid, fromNick: ownerName })`
  (`group-turn.ts:269`), and `runGroupTurn` prefixes `@<name>` and sets a mention for
  `trigger.fromJid` (`agents/group-turn.ts:71, 85-93`), sending to `roomJid` as
  `groupchat` (`:177`). So the reply is `@<owner> …` in the topic room.
- `settle(turnOutcome.kind)` at `group-turn-body.ts:352`.

`scheduled-settle.ts:13-26` is the shared once-only settle for both queues.

---

## 3. Answers to the lead's questions

### (a) Claiming — does `claimDue` pick a `kind='prompt'` row and advance `next_run_at` for daily 08:00 Europe/Madrid?

**Yes, both.** The due query has no `kind` predicate (`scheduler.ts:232-236`), and the
`kind` dispatch happens later in `executeRoutine` (`execute.ts:140-143`). The claim
advances `next_run_at` to `nextRunAfter(parsed, now)` **before** the run
(`scheduler.ts:258, 271-274`); for `{ kind:'daily', time:'08:00', timezone:'Europe/Madrid' }`
that is the next 08:00 wall-clock instant in the zone, DST-correct
(`schedule.ts:157-178`, `:281-311`). Two properties to note:

- The claim is a compare-and-set, so two leaders/two overlapping ticks never run the same
  row twice; and a routine many periods overdue runs **once**, from `now`
  (`scheduler.ts:210-217`).
- Lateness: a row more than `MISSED_AFTER_LATE_MS = 1 h` past due is claimed **skipped**
  (`last_status='skipped'`, `last_run_at` set, no post) and rescheduled (`scheduler.ts:20-23,
  260-286`). So an 08:00 run only fires if the server is up (or restarts) within the hour;
  after that it is silently skipped for the day.

### (b) Timeouts — can the per-run handling time out, or block other routines, while a 15-minute computer turn runs?

- **In-flight cap:** `MAX_CONCURRENT_RUNS = 2` (`scheduler.ts:18`); runs above it wait in
  `queue` (`:67, 133-147`).
- **Claim cap:** `maxPerTick = 5` (`:60`); ticks never block on runs — `tick()` returns as
  soon as rows are queued (`:149-155`), so the loop keeps claiming every 30 s.
- **Run timeout:** there is **no scheduler-side timeout**. `runOne` awaits
  `executeRoutine` unbounded (`:96-131`); the only bound is the gateway's
  `ROUTINE_TIMEOUT_MS = 20 min` (`routine-run.ts:14, 77`), which always settles, so
  `executeRoutine` cannot hang forever.
- **Blocking:** one 15-minute turn holds one pool slot for up to 20 min. Two long prompt
  runs fill both slots and a third due routine queues; if it waits past 1 h it is recorded
  `skipped` at dequeue (`scheduler.ts:100-105, 295-315`). Prompt runs share the pool with
  tool routines, so two slow prompt runs also delay a due tool routine.
- `whenIdle` and the manual `tick` are test seams (`:49-53, 82-89, 194`); production only
  uses `start`/`stop`.
- **Gap:** the 20-minute timer starts when the item is **enqueued**, not when the turn
  starts, so a run queued behind an in-flight turn can be reported `failed` while it later
  runs and posts (see G2).

### (c) Leader vs gateway — does the leader's gateway own the AI's live session, and what happens during a rolling deploy?

- The `sessions` map is per gateway instance (`gateway.ts:67`); the gateway is **started
  only on the leader** (`leader/start.ts:177-187, 209`). `runPrompt` closes over the
  process's own `running.gateway` (`components.ts:99-105`), and the scheduler is started in
  the same leader work (`leader/start.ts:214-222`). So yes: the leader's gateway owns the
  live AI sessions the scheduler talks to. (Every instance *builds* the gateway,
  `components.ts:224-254`, but only the leader starts it.)
- Rolling deploy: the old leader steps down → `onStepDown → leaderWork.stop()`
  (`components.ts:307-310`), which awaits `gateway.stop()` (`start.ts:236`) **then**
  `routineScheduler.stop()` (`:243`). `gateway.stop` drains up to `AI_DRAIN_MS = 8 s`
  (`lifecycle.ts:271-297`, `contracts.ts:108`), then marks still-running sessions
  `stopped`, sends `AI_RESTART_REPLY` to the DM owner and each busy room
  (`lifecycle.ts:281-296`, text `contracts.ts:114`), and disconnects. The new leader
  reconnects. Ordering note: the run is not awaited by either `stop()` (see G4).

### (d) Turn sees the prompt — does the synthetic body reach the model?

**Yes, in both queues.** Body = `Scheduled run "<title>".\n<prompt>` (`routine-run.ts:60`).

- **DM:** it is pushed on `session.pending` (`routine-run.ts:80-85`), survives the
  MAM-merge because its id is fresh (`dm-turn.ts:251-263`), and reaches the model either as
  a merged `user` turn (`context.ts:185-187, 288-292`) or as the explicit trigger push.
- **Room:** `group-turn-body.ts:163-176` merges `eligible` into `fresh` and
  `buildGroupMessages` renders it as `${sender}: ${body}` (`context.ts:242-246`); the
  trigger dedup uses the id, so the body is present exactly once.

### (e) The reply lands in the right place

- **DM:** to `ownerJid`, kind `'chat'` (`agents/dm-turn.ts:162`), owner from the DB
  (`dm-turn.ts:121, 131`). Correct DM.
- **Topic room:** `runGroupTurn` sends to `roomJid` as `groupchat` with
  `@${name}` prefix and a mention for `trigger.fromJid`, where `name` is the trigger's
  display name (`agents/group-turn.ts:71, 85-93, 177`). For a scheduled trigger,
  `fromJid = ownerJid` and `fromNick = ownerName` (`routine-run.ts:100-104`), so the room
  reply is `@<owner name>`. Correct room + `@owner`. (If `loadOwnerName` returns an empty
  string, the fallback is the bare owner JID, `agents/group-turn.ts:71` — cosmetic.)

### (f) Every exit settles exactly once

- The gateway reports **one** outcome per turn, first-wins and once-only
  (`routine-run.ts:70-76`, `scheduled-settle.ts:13-26`, `dm-turn.ts:96-99`,
  `group-turn.ts:356-359`), and `executePromptRoutine` maps it once (`execute-prompt.ts:100-108`):
  - `replied → markOk` → `last_status='ok'`, `consecutive_failures=0` (`outcomes.ts:63-80`);
  - `failed → recordFailure` → `last_status='error'`, counter + 1; the 3rd in a row pauses
    (`status='paused'`, `paused_reason='failures'`) and posts the fixed notice
    (`outcomes.ts:85-127`);
  - `stopped | limited | offline | not_in_room → markSkipped` → `last_status='skipped'`,
    no failure count (`outcomes.ts:44-61`).
- **Gaps:** a timer-fired `failed` that later posts records `error` on a working run (G2);
  a run whose process dies records nothing (G4).

### (g) No overlap — the 24/day cap, the 10-per-topic limit, and one run at a time

- **24/day:** `claimPromptRun` is a single upsert with
  `ON CONFLICT (ai_id, day) DO UPDATE … WHERE count < 24 RETURNING count`
  (`execute-prompt.ts:48-62`), backed by the primary key `("ai_id","day")`
  (`drizzle/0067_routine_kind.sql:8-13`). Atomic across schedulers. Correct.
- **10-per-topic:** checked at **creation** (`queries.ts:79-100` via
  `prompt-routines.ts:52`), not enforced at run time. The check is check-then-insert
  (the insert is `:54-70`), so two concurrent approvals can exceed it (G6).
- **One run at a time:** the same routine cannot overlap itself — the claim advances
  `next_run_at` before the run (`scheduler.ts:271-274`). At the gateway, one turn per AI
  (`session.busy`, `dm-turn.ts:89-92`) and one per `(AI, room)` (`roomBusy`,
  `group-ingest.ts:316-319`); two prompt routines for the same AI queue behind each other.
- **Gaps:** the per-AI daily cap is consumed before the outcome, so a misconfigured routine
  can starve the AI's other prompt routines (G7); a DM scheduled trigger coalesces with
  owner messages and can re-enable `request_action` (G5).

### (h) A deploy mid-run — desk agent restarted, jail removed (T-1626)

Two processes restart; the failure modes differ.

- **`zilar-server` rolling deploy.** The drain waits only 8 s (`lifecycle.ts:271-297`); a
  15-minute computer turn never finishes, so the session is marked `stopped`, the owner
  (and each busy room) hears `AI_RESTART_REPLY` ("I was restarted in the middle of my
  reply. Please ask again.", `contracts.ts:114`), and every later send is dropped by
  `sessionIsLive` (`live.ts:39-58`). What the **run** records:
  - if the model call already returned, `runDmTurn` returns `'replied'` (the dropped send
    resolves `{ id: '' }`, `live.ts:54-56`) and `settle('replied')` records
    `last_status='ok'` even though nothing was posted;
  - if the process is terminated first, the promise never settles, so the row keeps its
    old `last_status` while `next_run_at` has already advanced — the slot is silently
    lost.
  - The user is told only the generic restart sentence, never "the routine did not run".
- **`desk-agent` restart (T-1626).** The agent removes its jails on SIGTERM and start
  (`work/T-1626-jails-across-restarts.md:18-25, 40`). A desk call in flight fails with
  `jail_unavailable` → the fixed tool text "your computer is unavailable right now"
  (`desk-exec.ts:71`) becomes a tool result; the model carries on and usually replies, so
  the routine records `'ok'` with a degraded answer. A later desk call re-provisions
  (`desk-exec.ts:88-109`; T-1620/T-1626 recreate the jail), so the run may also recover
  mid-turn. The workspace files survive; only the container goes.

---

## 4. Gaps, severity and smallest fix

Severity: **blocks** = the 08:00 run does not happen; **wrong outcome** = it runs but the
record/notice is wrong; **cosmetic** = small.

| # | Severity | Gap (evidence) | Smallest fix |
| --- | --- | --- | --- |
| G1 | blocks (config-dependent) | The scheduler needs a `toolRunner` even for prompt routines: `wiring.ts:47-53` returns `null` when `config.TOOLS_ENABLED` is off (the runner is built from it at `components.ts:130-133`). With `ROUTINES_ENABLED=true` and `TOOLS_ENABLED=false` the 08:00 run never fires. | Decide and document that prompt routines require `TOOLS_ENABLED=true`, or start the scheduler when `runPrompt` is present and make `runTool` optional (`routines/wiring.ts:47-53`, `routines/execute.ts:65-81`, `scheduler.ts:106-119`). |
| G2 | wrong outcome | `ROUTINE_TIMEOUT_MS` (20 min) starts at **enqueue** (`routine-run.ts:77`), covering time queued behind an in-flight turn (`dm-turn.ts:89-92`, `group-ingest.ts:316-319`). A run queued behind a 15-min turn is settled `'failed'` at 20 min and increments `consecutive_failures`, while the turn later posts and its real `'replied'` is dropped by the once-only settle (`scheduled-settle.ts:13-26`). On the 3rd such day a healthy routine pauses (`outcomes.ts:96-127`). | Start the timer when the turn actually starts, not at enqueue: signal the pump's turn start back to `routine-run.ts` and arm there, or size the timeout as queue + 2× the 15-min desk cap (`routine-run.ts:77`; `dm-turn.ts` / `group-ingest.ts` pump start). |
| G3 | wrong outcome | A deploy mid-run can record `'ok'` with nothing posted: `liveSendMessage` returns a fake success when the session is stopped (`live.ts:39-58`), so `runDmTurn` returns `'replied'` and `settle('replied')` runs at `dm-turn.ts:309` / `group-turn-body.ts:352`. | Before settling success, use the liveness the code already computes (`sessionIsLive` at `dm-turn.ts:308`) to settle `'stopped'` instead; same in `group-turn-body.ts:352`. |
| G4 | wrong outcome | A process death (or the old leader being killed right after hand-off) between claim and outcome leaves `next_run_at` advanced and `last_status` unchanged — no record, no failure, no notice (`scheduler.ts:210-217`; stop order `leader/start.ts:236-244`; `routineScheduler.stop()` does not await in-flight runs, `scheduler.ts:187-193`). | Have `createRoutineScheduler.stop()` await in-flight runs up to a bounded timeout (reuse a small `runOne` registry at `scheduler.ts:96-147`); accept that SIGKILL still loses the slot, and say so on the routine card. |
| G5 | cosmetic (one part minor-security) | In the DM the whole pending batch runs as one turn (`dm-turn.ts:94-95`), unlike the room, which gives a scheduled item its own turn (`group-ingest.ts:338-353`). If the owner is chatting when the routine fires, the run can be answered inside a turn whose trigger is the owner's later message, and because `trigger.scheduled === undefined` the action tools come back on (`dm-turn.ts:280-283`), so an unattended run could park an approval card. | Mirror the room rule in the DM pump: if any batch item is `scheduled`, run the scheduled item as its own turn; derive `dmActionsList` from "the batch contains no scheduled item" (`dm-turn.ts:94-95, 280-283`). |
| G6 | cosmetic | The 10-per-topic rule is check-then-insert (`queries.ts:79-100`; insert `prompt-routines.ts:54-70`), so concurrent approvals can exceed it by a few. (The 24/day cap is atomic and fine.) | Add a transaction with an advisory lock around the count+insert, or a unique partial index on `(ai_id, coalesce(topic_id,''))` plus a count check inside the insert (`routines/queries.ts`, `routines/prompt-routines.ts`, a new `drizzle/` migration). |
| G7 | wrong outcome (minor) | The daily slot is taken **before** the outcome (`execute-prompt.ts:78-82`), so a routine whose AI is `offline` or whose room is gone (`'not_in_room'`) burns one of the AI's shared 24/day slots every tick and can starve the AI's other prompt routines. | Refund the slot on `'offline'`/`'not_in_room'` (decrement `routine_prompt_runs` in the same statement) and keep it for `'limited'`/`'stopped'` (`execute-prompt.ts:78-108`). |
| G8 | blocks (config-dependent) / silent | With `AGENT_GATEWAY_ENABLED=false` (or a missing key cipher) the gateway never starts, no session exists, so every prompt run resolves `'offline'` and is recorded `skipped` with **no notice** (`components.ts:99-105`, `routine-run.ts:51-53`, `lifecycle.ts:129-140`). The owner is never told the routine is not running. | On `'offline'`/`'not_in_room'`, log a warn with the routine id (as the no-runner and daily-cap paths already do, `execute-prompt.ts:73, 79`) and, after N in a row, pause with a fixed notice instead of silently skipping. |
| G9 | cosmetic | `nextRunAfter` can throw (`schedule.ts:177`) and `claimDue` calls it unguarded (`scheduler.ts:258`); a throw fails the whole tick, so no rows are claimed that tick (logged and retried, `:165-168`). Practically unreachable (weekdays always has ≥ 1 value). | Wrap the `nextRunAfter` call in `try/catch` and park the row like the invalid-schedule branch (`scheduler.ts:241-257`). |

## 5. What is solid

- Claim is atomic and duplicate-safe (CAS on `next_run_at`, `scheduler.ts:261-274`).
- The per-AI daily cap is atomic across schedulers (PK + conditional upsert,
  `execute-prompt.ts:48-62`).
- The once-only settle is shared and correct (`scheduled-settle.ts:13-26`), so a routine
  cannot be recorded twice.
- A scheduled turn carries no interactive tools — no unattended approval cards, no
  `ask_people`, no delegation — in the room (`group-turn-body.ts:203-220`) and, unless it
  coalesces in a DM, in the DM (`dm-turn.ts:280-283`, `dm-turn-input.ts:82-84`).
- Prompt text and model/tool output never reach the audit: `routine.created` carries only
  `{ kind: 'prompt' }` (`prompt-routines.ts:78-89`) and `routine.run` only
  `{ status, durationMs }` (`routines/audit.ts`); failures reach the chat only as the fixed
  notices (`outcomes.ts:16-20`).

## 6. Suspected (not verified on a running stack)

- The exact 08:00 claim jitter (tick 30 s + drain) needs a live clock; the arithmetic is
  `nextRunAfter` + `MISSED_AFTER_LATE_MS` (`schedule.ts:157-178`, `scheduler.ts:20-23`).
- Whether a given deploy kills the in-flight promise before it settles depends on the
  Coolify stop timing vs `AI_DRAIN_MS = 8 s` (`lifecycle.ts:271-297`) — check on the next
  real deploy.

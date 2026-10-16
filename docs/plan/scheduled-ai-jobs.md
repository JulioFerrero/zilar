# Scheduled AI jobs (plan)

Julio (2026-10-16) wants AIs to do jobs on a schedule: "every morning get me the
gold, S&P 500 and BTC prices", and more generally any job the AI does on its
computer. Today a **routine** runs a saved *tool* — model-written code in the
server sandbox — on a schedule and posts its output (`docs/AI_TOOLS.md:3-33`). It
never runs an AI turn, so it cannot think or use the AI's computer.

**Julio's decision:** keep tool routines (live since 2026-10-16) and add
**scheduled AI jobs**: a second routine **kind** where each run hands the AI a
fixed prompt and runs a normal turn in its DM or its topic. The AI uses its
computer when that is on, and its answer is posted where the routine lives.

This document is the plan only (T-1614). No source file changed. Every claim
about today's code cites `file:line`; the few things I could not verify are
marked **unverified**.

## 0. Summary

- The `routines` table grows a `kind` (`tool` | `prompt`) and a `prompt` column;
  `tool_id` becomes nullable. Hand-written SQL in §2.1.
- A prompt run reuses the existing DM and group **turn bodies** unchanged. The
  scheduler hands the run to the gateway, which pushes a synthetic trigger onto
  the AI's own per-chat queue, so a scheduled run can never overlap a live chat
  turn (`dm-turn.ts:98-106`, `group-ingest.ts:280-283`) and **never coalesces**
  with one — it always forces its own turn (§2.2).
- Everything else is already there and gets reused: the claim/CAS scheduler, the
  3-failure pause rule, the budget gate per round, Stop mid-turn, and the
  tier-2 approval card.
- AI-17 (no user time zone) was **fixed after the audit was written**: `T-1440`
  added `user_profiles.time_zone` and `promptNow` (§2.7). Only a one-line prompt
  guide tweak remains.

---

## 1. Today's routines, in one page

### 1.1 Data model

One table, `routines` (`apps/server/drizzle/0023_classy_lester.sql:1-22`):

- ids and scope: `id`, `ai_id`, `group_id`, `topic_id`, `tool_id` **NOT NULL**;
- what to run: `tool_id`, `input` (jsonb), `approved_hosts` (jsonb);
- the schedule: `schedule` (jsonb), `next_run_at` (timestamptz);
- state: `status` (default `active`), `paused_reason`, `last_run_at`,
  `last_status`, `consecutive_failures`;
- `created_by`, `created_at`, `updated_at`, `deleted_at` (soft delete);
- `CHECK ((group_id IS NULL) = (topic_id IS NULL))` (`:21`), a btree index on
  `(status, next_run_at)` (`:29`), and FKs to `ais`, `groups`, `topics`,
  `ai_tools`, `user` (`:24-28`).

The hand-written row type is `RoutineRow` in
`apps/server/src/db/rows-agents.ts:153-173`, re-exported by
`apps/server/src/db/rows.ts:379`. `tool_id` is typed non-null there (`:158`).

The schedule shape is a union of two kinds, validated by
`parseRoutineSchedule` (`apps/server/src/routines/schedule.ts:131-152`):

- `{ kind: 'daily', time: 'HH:MM', timezone: <IANA>, weekdays? }`
  (`schedule.ts:50-68`); DST-safe, wall-clock in the zone (`schedule.ts:281-311`);
- `{ kind: 'interval', everyMinutes }` with `60 <= everyMinutes <= 10080`
  (`schedule.ts:16-17,34-48`) — nothing runs more often than hourly.

`nextRunAfter(schedule, from)` computes the next occurrence strictly after
`from` (`schedule.ts:157-178`).

### 1.2 The scheduler loop

`createRoutineScheduler` (`apps/server/src/routines/scheduler.ts:53-187`) is a
timer that ticks every 30 s (`scheduler.ts:56`):

- **Claiming.** `claimDue` (`scheduler.ts:212-280`) selects up to `maxPerTick`
  (default 5, `scheduler.ts:58`) rows with `status = 'active' AND deleted_at IS
  NULL AND next_run_at <= now`, oldest first (`:218-228`), and claims each with a
  conditional `UPDATE ... WHERE next_run_at = <the value just read>` that
  advances `next_run_at` **before** the run (`:251-266`). Exactly one racer wins;
  the loser sees zero rows (`:267-269`).
- **Leader.** The scheduler is **leader-only work**: `leader/start.ts:210-217`
  builds it inside the work that a Postgres advisory lock gates
  (`leader/lock.ts:1-16`, `leader/start.ts:1-7`), so only one instance runs it.
  The CAS claim is the second line of defence if two instances ever overlap.
- **Concurrency.** Claimed runs go into a queue drained by a pool of
  `MAX_CONCURRENT_RUNS = 2` (`scheduler.ts:18,123-145`); ticks keep claiming
  while runs are slow.
- **Missed runs.** A row more than `MISSED_AFTER_LATE_MS = 3_600_000` (1 h) past
  its due time is recorded `last_status = 'skipped'` with no post, and the next
  occurrence is scheduled (`scheduler.ts:20-23,250-276`). Lateness is re-checked
  when the pool dequeues a run (`scheduler.ts:94-103,285-305`). A row whose
  `schedule` no longer validates is parked one hour out as a dead-letter
  (`scheduler.ts:231-247`).

Options and ports: `db`, `runTool`, `post`, `audit`, `logger`, `tickMs`, `now`,
`maxPerTick` (`scheduler.ts:30-42`). Production wiring:
`buildRoutineScheduler` (`routines/wiring.ts:37-59`) starts only when
`ROUTINES_ENABLED=true` **and** a tool runner exists; with the flag on and no
runner it logs one warning and stays off (`wiring.ts:40-49`). The flag is
`ROUTINES_ENABLED` (`config/server-schema.ts:144`).

### 1.3 One run, step by step

`executeRoutine` (`apps/server/src/routines/execute.ts:97-198`); its header
lists the order (`execute.ts:1-23`). It stops at the first failing step:

1. **AI active, room membership.** The `ais` row must be `status = 'active'`
   (`execute.ts:112-122`); a topic routine additionally needs the AI still in the
   topic's room (`execute.ts:123-126`, `preflight.ts:27-54`). Failure →
   `markSkipped`, no post, no failure count.
2. **Tool exists.** The `ai_tools` row must not be deleted
   (`execute.ts:128-139`); missing/deleted → `pauseForFailures(..., deleted:
   true)`, i.e. immediate pause with the fixed notice (`outcomes.ts:96-127`).
3. **Host pinning.** The tool's current version `hosts` must be a subset of the
   routine's `approved_hosts` (`execute.ts:141-151`, `preflight.ts:56-76`).
   Otherwise → `needs_approval` / `hosts_changed` with the fixed hosts notice,
   audited `routine.paused` (`outcomes.ts:129-149`).
4. **Run the tool.** `runToolVersion(..., { trigger: 'routine' })`
   (`execute.ts:153-165`); a `false` result or a throw → `recordFailure`
   (`execute.ts:161-182`), except `ai_not_active` → `markSkipped`
   (`execute.ts:171-174`) and `not_found` → pause (`execute.ts:175-178`).
5. **Post.** `"<title>\n<output.text>"`, output trimmed to
   `MAX_POST_TEXT_CHARS = 4000` (`outcomes.ts:13,22-42`), posted as the AI
   through the `post` port. A `false` (AI stopped or not in the room) is retried
   once after `POST_RETRY_DELAY_MS = 30_000` (`execute.ts:89-95,184-196`) and
   then `markSkipped`.
6. **Count.** Success `markOk` (resets `consecutive_failures`,
   `outcomes.ts:63-80`); failure `recordFailure`/`pauseForFailures`
   (`outcomes.ts:85-127`).

Every run audits `routine.run` with `detail { status, durationMs }` only — never
output, source or an error message (`audit.ts:8-28`). Pauses audit
`routine.paused` with the reason (`audit.ts:30-47`).

### 1.4 Outcomes and pausing

Statuses: routine `active | paused | needs_approval`
(`routines/schemas.ts:21`); paused reasons `user | failures | hosts_changed`
(`:22`); last status `ok | error | skipped` (`:23`).

`MAX_CONSECUTIVE_FAILURES = 3` (`outcomes.ts:14`). The 3rd consecutive failure
sets `status = 'paused'`, `paused_reason = 'failures'` and posts
`FAILURE_PAUSE_NOTICE` once (`outcomes.ts:16-17,105-126`). Resume resets the
counter and recomputes `next_run_at` (`support.ts:255-267`); `needs_approval`
refuses resume with `409 needs_approval` (`support.ts:242-247`).

Limits: `MAX_ROUTINES_PER_TOPIC = 10` (`schemas.ts:7`), enforced by
`enforceRoutineLimit` (`queries.ts:79-100`); title 80 chars
(`schemas.ts:8`), input 2 KiB (`schemas.ts:9`).

### 1.5 Who may create, edit, pause and delete

There is **no HTTP route that creates a routine** (`routines/service.ts:3-5`).
Creation is the AI's `routine.schedule` action after a human approval (§1.6).

- **Reads and writes (HTTP).** `RoutinesGroup` exposes list for an AI, list for a
  group, pause, resume, delete (`packages/api-contract/src/routines.ts:31-57`).
  Access: `routineAccess` / `routineAccessIncludingDeleted`
  (`routines/access.ts:18-28,32-47`). A **manager** is the AI's owner, or a group
  owner/admin who can see the topic (`access.ts:49-74`); a stranger or a blind
  viewer gets the same `404` (`access.ts:14-17`, `routines/api.ts:146-150`).
  List endpoints hide routines in topics the viewer cannot see
  (`api.ts:62-105`).
- **AI action.** `routine.schedule` (tier 2, needs approval),
  `routine.pause` and `routine.delete` (tier 1)
  (`apps/server/src/tools/routine-adapters.ts:76-238`). In a group, the action is
  only offered when the triggering person is a group owner/admin
  (`group-turn-body.ts:191-201`) and re-checked right before execution
  (`group-turn-body.ts:228-243`). `created_by` is the AI's owner
  (`tools/adapters.ts:11-13`, `routine-adapters.ts:125`).
- **Web.** `RoutinesSection` in the AI panel (`AiPanel.tsx:339`), the group panel
  (`GroupPanel.tsx:283`) and the topic panel (`TopicPanel.tsx:254`); the panel
  passes `canManage` (owner-only) and the section hides actions when false
  (`RoutinesSection.tsx:269-330`).
- **Mobile.** `RoutinesSection` on the AI edit screen (`apps/mobile/src/app/ais/[id].tsx:375`)
  and the group info tools page (`components/group-info/tools-page.tsx:76`).

### 1.6 The AI's action and its approval card

`routine.schedule` is built by `routineScheduleAdapter`
(`routine-adapters.ts:76-155`). It is **tier 2** (`routine-adapters.ts:81`), so
the gateway's approval path raises a card before anything runs. The card text is
`describe()`: summary `Schedule "<title>": <schedule in words>`, details `Runs
tool <name> and posts the result here. It will contact: <hosts>`
(`routine-adapters.ts:83-94`; `describeSchedule` `:31-51`). "Approve always" is
**never** offered: the adapter has no `allowAlways`, so
`buildAlwaysEligible` returns false (`actions/registry.ts:221-234`) and an
`approve_always` decision is refused with `400 always_not_allowed`
(`registry.ts:111-119`). `docs/AI_TOOLS.md:28-33` states the same rule.

On execute, the adapter finds the tool by name, fails safe if the tool's hosts
changed after the card (`routine-adapters.ts:107-115`), requires the card's hosts
to sit inside the tool's approved set (T-0132, `routine-adapters.ts:116-124`), and
calls `createRoutine` with the AI's own chat from `ActionContext`
(`routine-adapters.ts:125-142`). `createRoutine` (`support.ts:36-166`) validates
title/schedule/input, checks the tool belongs to the same (AI, topic), requires
`approved_hosts` ⊇ the tool's current hosts, enforces the 10-per-topic limit and
audits `routine.created` with ids only (`support.ts:151-164`).

### 1.7 The prompt guide and the UI today

The fixed guide (`apps/server/src/agents/tool-guide.ts:8-21`) tells the model to
schedule a routine only for recurring asks and to let the card show the hosts
(`tool-guide.ts:17`). Stage texts include `routine.schedule`
(`tool-guide.ts:51`).

The row shows title, `describeRoutineSchedule` · `runs <toolName>` · status, then
next run and last status, then the paused-reason explanation
(web `RoutinesSection.tsx:253-267`; mobile `routines-section.tsx:143-156`). The
empty hint is "Ask the AI in the chat to schedule one."
(web `:167-171`; mobile `routines-section.tsx:21-22`).

---

## 2. The prompt kind, end to end

### 2.1 Data — migration and row type

New hand-written migration `apps/server/drizzle/0067_routine_kind.sql` (next free
number; `apps/server/drizzle/` currently ends at `0066`). It is **expand-only**:
the old release inserts `tool_id` with no `kind` (the default `'tool'` covers it)
and never sets `prompt`, so old *writes* keep working during a rolling deploy
(`AGENTS.md:47-60`). The DDL is only half of it: a new *row* read by an old
*leader* is the other half (the rollout guard below). Note
`ALTER TABLE ... ADD CONSTRAINT` validates existing rows and needs a brief
`ACCESS EXCLUSIVE` lock, hence `lock_timeout`:

```sql
SET lock_timeout = '5s';
ALTER TABLE "routines" ADD COLUMN "kind" text DEFAULT 'tool' NOT NULL;--> statement-breakpoint
ALTER TABLE "routines" ALTER COLUMN "tool_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "routines" ADD COLUMN "prompt" text;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_kind_check"
  CHECK ("kind" IN ('tool', 'prompt'));--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_tool_kind_needs_tool"
  CHECK (("kind" = 'tool') = ("tool_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_prompt_kind_needs_prompt"
  CHECK (("kind" = 'prompt') = ("prompt" IS NOT NULL));
```

`db/rows.ts` changes (the type lives in `rows-agents.ts:153-173`, re-exported at
`rows.ts:379`): add `kind: 'tool' | 'prompt'`, add `prompt: string | null`,
change `toolId: string` to `toolId: string | null`.

A second, small table counts prompt runs per AI per day (§2.5):

```sql
SET lock_timeout = '5s';
CREATE TABLE "routine_prompt_runs" (
  "ai_id" text NOT NULL,
  "day" date NOT NULL,
  "count" integer DEFAULT 0 NOT NULL,
  PRIMARY KEY ("ai_id", "day"),
  CONSTRAINT "routine_prompt_runs_ai_id_ais_id_fk" FOREIGN KEY ("ai_id")
    REFERENCES "public"."ais"("id") ON DELETE cascade ON UPDATE no action
);
```

Both DDL blocks are one migration or two; either way the schema task is the only
DB task in flight (§4).

**Rollout guard (the old code cannot be changed).** The expand-only DDL keeps old
*writes* working, but it does not protect a new **prompt row** from an old
**reader**. `claimDue` has no `kind` filter (`scheduler.ts:212-280`) and only the
leader runs the scheduler, so during a rolling deploy the old-code leader can
claim a prompt routine created by the new code and run `execute.ts` step 2 with
`tool_id = NULL`. The `WHERE id = NULL` lookup finds no tool
(`execute.ts:128-139`) and takes the missing-tool branch,
`pauseForFailures(..., deleted: true)`: an immediate pause plus the failure
notice posted in chat (`outcomes.ts:96-127`, `:123-126`). Old code cannot be
taught to skip prompts, so the guard must be on the **new** side: do not create
or activate a prompt routine until every running instance understands `kind`.
Ship the migration and the reader/writer code first, then open the
`routine.schedule` prompt variant (task 6) only in a follow-up release once the
previous release is fully drained. The `claimDue` `kind` filter (task 5) then
keeps a *new* leader away from a malformed row, but it is not what protects the
rolling deploy.

### 2.2 Running a turn with no incoming message

**Where the handoff happens.** The scheduler already receives two ports,
`runTool` and `post` (`scheduler.ts:30-42`). Add a third, `runPrompt`, and a new
run path in `apps/server/src/routines/execute-prompt.ts` **(new)**. `execute.ts`
becomes a thin dispatcher: `if (row.kind === 'prompt') { await
executePromptRoutine(ports, row, options); return; }` before its step 2
(`execute.ts:128`). `execute.ts` stays well under 400 lines.

`executePromptRoutine` mirrors step 1 of `execute.ts` (AI `active` and, for a
topic routine, `isAiInTopicRoom`, `preflight.ts:27-54`), then:

- checks the per-AI daily cap (§2.5) and, when reached, `markSkipped` with a log
  line, no post;
- calls `ports.runPrompt({ aiId, groupId, topicId, routineId, title, prompt,
  at })`;
- maps the answer through the existing `outcomes.ts` helpers: `replied` →
  `markOk`; `failed` → `recordFailure` (3rd pauses with
  `FAILURE_PAUSE_NOTICE`); `stopped` (the owner pressed Stop) / `offline` /
  `not_in_room` / `limited` → `markSkipped` (no failure count);
- audits `routine.run` with `{ status, durationMs }` only (`audit.ts:8-28`).

It never touches the tool path (no host pinning, no `runToolVersion`).

**The gateway entry point.** Add `runScheduledTurn` to the `AgentGateway`
interface (`agents/gateway/contracts.ts:259-290`, next to `postToChat` and
`stopTurn`) and implement it in `gateway.ts`. Its work is a small new factory:

- `apps/server/src/agents/gateway/routine-run.ts` **(new)** —
  `createRoutineRunRunner({ sessions, pumpSessionEffect, pumpRoom })` returning
  `runScheduledTurn(input): Promise<ScheduledRunOutcome>`.

`runScheduledTurn`:

1. Looks up `sessions.get(aiId)`; missing, `stopped`, or no longer owned by this
   gateway → `'offline'` (`gateway.ts:268-270`).
2. For a DM routine, builds a `PendingMessage` and pushes it onto
   `session.pending`; for a topic routine, builds a `RoomPendingMessage` and
   pushes it onto `session.roomPending.get(roomJid)` — and returns
   `'not_in_room'` when `session.rooms.has(roomJid)` is false (`live.ts:303`).
   The synthetic trigger carries the **owner's** identity, so every downstream
   use names a real member instead of a placeholder:
   - `fromJid` is the owner's JID
     (`jidFor(localpartFor(ai.owner), deps.xmpp.domain)`, the value the DM body
     derives at `dm-turn.ts:135`) for **both** routine scopes;
   - `fromResolved = true`, so the group admission's `fromResolved` check passes
     (`group-turn.ts:151`);
   - `timestamp` is `at` (the scheduled run's time);
   - `id` is a fresh unique id per run (`randomUUID()`), because the group
     failure path replies to it (`replyTo: trigger.id`) and `@`-mentions
     `fromJid` (`group-turn.ts:301-321`);
   - `fromNick` stays unset, so `displayNameOf` falls back to the owner's bare
     JID (`context.ts:209-213`). A failed 8am topic run therefore pings the
     owner, never a placeholder like `@scheduled-…`, and the sender-derived
     `timeZoneForJid` lookup yields the owner's zone (§2.3).
3. Calls the **existing** `pumpSessionEffect(session)` (`dm-turn.ts:95`) or
   `pumpRoom(session, roomJid)` (`group-ingest.ts:318-320`) and resolves with the
   turn's outcome.

**Joining the per-session queue (never overlapping a live turn).** Both queues
already serialise turns: the DM pump returns immediately while `session.busy`
(`dm-turn.ts:98-101`) and loops over `session.pending` (`dm-turn.ts:103-106`);
the room pump returns while `session.roomBusy.has(roomJid)`
(`group-ingest.ts:280-283`) and loops over `session.roomPending`
(`group-ingest.ts:284-314`). Pushing a synthetic item onto those queues is
therefore enough for a scheduled run to wait behind a live turn, and the AI's
per-chat turn cap stays one at a time.

**A scheduled run never coalesces; it forces its own turn.** Waiting in the same
queue is not enough on its own: the DM pump splices the *whole* queue into one
batch (`dm-turn.ts:103-106`) and the turn answers only the **last** owner message
(`dm-turn.ts:154`), and the room pump coalesces consecutive items from the same
sender (`group-ingest.ts:290-310`). So a job that fires in the same tick as a
live owner message would be swallowed into that batch: its prompt becomes mere
history context, `onOutcome` still reports `replied`, and `markOk` records a run
whose prompt never executed — and `next_run_at` has already advanced, so it never
retries. A `scheduled` item must therefore be its own turn, the way a delegated
task already is (`group-ingest.ts:290-293`):

- **DM.** The pump must not splice a scheduled item into a normal batch: it takes
  the queue up to but not including the first item with `scheduled` set, runs
  those (if any) as one turn, then runs the scheduled item alone
  (`dm-turn.ts:103-106`).
- **Room.** The coalescing loop stops before any item with `scheduled` set, and a
  scheduled head item always has `take = 1` (`group-ingest.ts:297-310`), like the
  `delegationId` branch.

Both files are already in task 4.

**The outcome plumbing.** The new queue item carries a resolver:

- `PendingMessage` (`contracts.ts:141-145`) and `RoomPendingMessage`
  (`contracts.ts:147-161`) gain
  `scheduled?: { routineId: string; onOutcome?: (outcome: ScheduledRunOutcome) => void }`,
  with a **new** `ScheduledRunOutcome` union — `'replied'`, `'failed'`,
  `'stopped'`, `'offline'`, `'not_in_room'`, `'limited'`, `'skipped'` — the same
  values `runScheduledTurn` returns.
- The DM batch filter (`dm-turn.ts:139-153`) admits an item with `scheduled` set
  the way it admits an owner message, forces it into its own turn (§ above), and
  skips the XEP-0333 displayed marker for it (`dm-turn.ts:164`).
  `runSessionTurnEffect` calls `onOutcome` once its turn ends, from the
  `runDmTurn` result (`DmTurnOutcome` `agents/dm-turn.ts:121`). The group path
  does the same after `runGroupTurn` (`group-turn-body.ts:267-341`,
  `runGroupTurn` returns `DmTurnOutcome` too, `agents/group-turn.ts:146`); the
  pump in `group-ingest.ts:313` reads that result back and resolves the resolver.
- **Every early return inside the bodies must resolve too.** Firing `onOutcome`
  only from the turn bodies' result is not enough: a scheduled item can leave the
  turn before the model is ever called, and then the runner's timeout would
  record `'failed'` — counting a limited or skipped run toward the 3-failure
  pause and contradicting the §2.4 table. Resolve the resolver at each of these
  returns, in the file that owns it:
  - DM (`agents/gateway/dm-turn.ts`): the AI row is gone (`:129-134`) →
    `'offline'`; the admitted item is not in `ownerMessages` (`:149-152`) →
    `'skipped'`; the daily limit is reached (`:178-180`) → `'limited'`.
  - Group (`agents/gateway/group-turn.ts`): the AI row is gone (`:117-122`) →
    `'offline'`; the AI left the room (`:123-126`) → `'not_in_room'`; the room
    state lookup failed (`:130-133`) → `'skipped'` (it logs the ids warning, as
    today); the scheduled item did not survive the filters so `eligible` is empty
    (`:164-166`) → `'skipped'`; the daily limit is reached (`:212-215`) →
    `'limited'`; the rate window or the round budget drops the turn
    (`:222-240`) → `'skipped'`.
- **Kill-switch and replacement races resolve too.** Two paths take a queued
  scheduled item away without any body return: the pumps loop on `!session.stopped`
  (`dm-turn.ts:103`, `group-ingest.ts:285`), and `handleReplaced`
  (`sessions.ts:338-347`) clears `session.pending` and `session.roomPending` when
  another gateway takes the AI over. Every item left in a queue at that point must
  be resolved — `'stopped'` when the owner stopped the AI, `'offline'` when the
  session was replaced — or the runner's timeout records `'failed'` for a run that
  never happened.
- **The group path has a second, separate filter.** The room pump is not enough:
  `agents/gateway/group-turn.ts:134-167` rebuilds `eligible` and drops any item
  that is not from a resolved, current room member (`item.fromResolved`,
  `gate.memberJids`). A scheduled trigger carries the owner's JID with
  `fromResolved = true` (above), so it passes the first check — but do not let
  membership be the thing that decides: admit an item with `scheduled` set before
  those two checks, the way the AI-handoff branch is admitted
  (`group-turn.ts:141-149`), and resolve the resolver (`'skipped'`) if the item is
  dropped for any reason. Otherwise `eligible` stays empty, the pump returns
  silently (`group-turn.ts:164-166`) and the runner's timeout records `'failed'`
  for a run that never happened. Every other drop stays. That file is 338 lines,
  so the small edit fits (the 399-line `agents/group-turn.ts` is the body, whose
  scheduled branch stays out of it).
- **A Stop is not a failure.** Today a stopped turn and a model failure have the
  same shape: `runDmTurn`'s abort branch returns `{ kind: 'failed', text: '' }`
  (`agents/dm-turn.ts:148-153`) and `stoppedTurn` does too
  (`agents/turn-stop.ts:37-40`), so a runner cannot tell them apart. Add a third
  `DmTurnOutcome` variant `{ kind: 'stopped' }` (`agents/dm-turn.ts:121`) and
  return it from both places — and from their group counterparts in
  `agents/group-turn.ts` — so a Stop reaches the scheduler as `'stopped'` and
  never counts as a failed run.
- The runner resolves `'offline'`/`'not_in_room'` without pumping, and a timeout
  guard converts a turn that never resolves into `'failed'` — a path no early
  return should leave, now that each one resolves.

Reusing the two turn bodies is the whole point: the scheduled turn gets the same
persona/history/memory/tools/computer resolution, the same task card and the
same send path (`dm-turn.ts:190-378`, `group-turn-body.ts:111-374`).

### 2.3 What the AI receives, and where the answer is posted

**Prompt text.** The synthetic trigger's `body` is a fixed line plus the stored
prompt, for example:

```
Scheduled run "<title>".
<prompt>
```

`buildDmMessages` already injects the person's local date and time via
`promptNow` (`dm-turn.ts:227-228`, `agents/prompt-time.ts:9-28`), so the AI sees
"…, 08:00 (Europe/Madrid)". No extra plumbing is needed in the DM. The group
body derives the zone from the *trigger's sender* via `timeZoneForJid`
(`group-turn-body.ts:140-143`); because the trigger's sender is the owner (§2.2),
that lookup already returns the owner's zone and the group body needs **no**
change.

The prompt is the owner's own words, treated exactly like a message body — data
for the model, never instructions it must not follow. It is not a new egress:
the AI's computer route is open web by Julio's decision, so a prompt routine
declares no hosts.

**Where the answer is posted.** Nowhere new. A **personal** routine posts into
the owner's DM: the owner JID is derived from the AI (`dm-turn.ts:135`) and the
final send goes through `liveSendMessage` (`dm-turn.ts:348`). A **topic** routine
posts into the topic's room: `sendMessage` in the group body
(`group-turn-body.ts:319-325`). Because the reply is the turn's own reply, the
scheduler never posts for a prompt run (only the failure notice does, §2.4).

### 2.4 Outcomes

| Situation | Recorded | What the human sees |
|---|---|---|
| Turn replies | `last_status = 'ok'`, `consecutive_failures = 0` (`outcomes.ts:63-80`) | the AI's answer in the DM / topic, with a normal task card |
| Model/turn fails | `last_status = 'error'`, `consecutive_failures += 1` (`outcomes.ts:96-127`) | the body's own failure text, sent before the outcome is recorded: a DM sends `mapFailureToReply` to the owner (`agents/dm-turn.ts:154-166`), a topic sends `GROUP_FAILURE_REPLY` to the room and the reason to the owner by DM (`agents/group-turn.ts:249-260`, `group-turn-body.ts:300`). The row also shows `last error · <time>` (web `RoutinesSection.tsx:42-48`; mobile `routines-format.ts:58`) |
| Owner pressed Stop | `last_status = 'skipped'`, no failure count (`outcomes.ts:44-61`) | nothing new in the chat; the turn's task card ends `stopped` (`agents/turn-stop.ts:18-35`) |
| 3rd consecutive failure | `status = 'paused'`, `paused_reason = 'failures'` | one fixed `FAILURE_PAUSE_NOTICE` posted in the routine's chat (`outcomes.ts:16-17,123-126`), and the row says paused with its explanation line |
| AI inactive, or no live session, or not in the room | `last_status = 'skipped'`, no failure count | nothing |
| Budget limited before or during the turn | `last_status = 'skipped'` | the turn's own fixed daily-limit notice (`apps/server/src/agents/gateway/budget.ts:117-192`) |
| Group rate window or round budget drops the turn | `last_status = 'skipped'`, no failure count (`group-turn.ts:222-240`) | the rate notice (once per window, naming the owner) in the room, or nothing for a round drop |
| Daily cap reached (§2.5) | `last_status = 'skipped'` | nothing; a log line with the AI id and routine id only |
| More than 1 h late | `last_status = 'skipped'` (`scheduler.ts:250-276`) | nothing |

A failure is not quiet: the turn body has already put its failure text in the
chat (the DM owner reply, the group `GROUP_FAILURE_REPLY` plus the owner DM), so
a transient provider error pings once, the row carries `last error`, and the
pause is a second fixed notice. A Stop is the quiet one: it records `skipped`,
adds no failure, and posts nothing.

### 2.5 Safety

- **Only the owner, or a topic admin.** Unchanged: manager = the AI's owner or a
  group owner/admin who can see the topic (`access.ts:49-74`); a group turn only
  offers the action when the trigger is owner/admin
  (`group-turn-body.ts:191-201`), re-checked at execution
  (`group-turn-body.ts:228-243`). Prompt routines keep the same rule.
- **A human approval card, never "always allow".** The prompt variant stays
  **tier 2** (`routine-adapters.ts:81`). "Approve always" is refused because the
  adapter has no `allowAlways` (`registry.ts:221-234`), so the server answers
  `400 always_not_allowed`. The card shows: the title, the schedule in words
  (`describeSchedule`, `routine-adapters.ts:31-51`), and the **prompt verbatim**
  (bounded), plus a line saying the AI will run it and post its answer in this
  chat. No hosts line — a prompt routine contacts nothing itself.
- **Tool surface for a scheduled run (needs Julio's sign-off).** The turn bodies
  pick the tool list from the trigger, not the caller. A group turn offers
  `request_action` whenever actions are registered and the trigger is an
  owner/admin (`group-turn-body.ts:199-201`), `ask_people` whenever
  `trigger.handoff !== true` (`group-turn-body.ts:202-205`), and the delegation
  tools when a target is present (`group-turn-body.ts:206-212`); a DM turn
  offers `request_action` the same way (`dm-turn.ts:269-275`). A scheduled run
  reuses those bodies, so an 8am topic run could ping every room member with
  `ask_people`, start an unattended delegation, or park a tier-2
  `request_action` card with nobody watching. Recommendation: the AI's
  computer/desk tools **stay on** — that is the point of the feature — while
  `request_action`, `ask_people` and delegation are **off** for a scheduled
  trigger; the bodies read the `scheduled` flag already on the trigger and build
  the list without them. Julio's call (an open decision beyond §5's five).
- **Budget gate on every round.** Untouched: `checkRoundGate: () =>
  budgetGate.checkDmRoundGate(session)` runs before every model call in both
  bodies (`dm-turn.ts:318`, `group-turn-body.ts:299`; `budget.ts:255-288`).
- **Stop works mid-turn.** Untouched: `registerTurnAbort` per chat
  (`dm-turn.ts:299`, `group-turn-body.ts:266`) and the gateway's `stopTurn`
  (`agents/gateway/stop.ts:35-52`).
- **Runs per AI per day.** New cap, **24 prompt runs per AI per UTC day** — the
  hourly ceiling the schedule already implies (`MIN_INTERVAL_MINUTES = 60`,
  `schedule.ts:16`), so one always-on hourly prompt routine fits, while ten
  routines across several topics cannot drain a budget. Only prompt runs count
  (tool runs are sandbox-cheap). It is enforced **atomically** in one statement,
  so two schedulers cannot both slip past the last slot:

  ```sql
  INSERT INTO routine_prompt_runs (ai_id, day, count) VALUES ($1, $2, 1)
  ON CONFLICT (ai_id, day) DO UPDATE SET count = routine_prompt_runs.count + 1
  WHERE routine_prompt_runs.count < 24
  RETURNING count
  ```

  Zero rows means the cap is reached. The day is the UTC day, matching the
  budget gate's `utcDay` (`budget.ts:90-92`). Rows accumulate one per AI per
  day; prune rows older than 30 days in the existing leader retention sweep
  (`agents/log/retention.ts`) or lazily. **If 24 feels high, 12 is the tighter
  alternative** (Julio's call, §5).
- **No money actions.** The prompt kind adds no adapter and no cost path. No
  production adapter reports `estimateCost` today (only the registry rule and
  tests reference it, `actions/registry.ts:190-195`), and a prompt run offers the
  same tools a normal chat turn offers — so it can never gain a money action the
  chat itself does not have. `AGENTS.md:99` (a cap per write) is satisfied by the
  daily cap above plus the existing 10-per-topic limit.
- **Audit hygiene.** `routine.run` and `routine.paused` carry ids and a fixed
  detail only — never the prompt, the answer or an error message
  (`audit.ts:8-47`), per `AGENTS.md:102`.

### 2.6 Creation from chat — the `routine.schedule` card

The action name stays `routine.schedule`. Its args schema
(`tools/tool-arg-schemas.ts:83-89`) becomes a **union**:

- today's `{ tool, title, schedule, hosts, input? }` (tool routine), and
- a new `{ title, schedule, prompt }` (prompt routine), with `prompt` a bounded
  string (propose `MAX_ROUTINE_PROMPT_CHARS = 2000`, mirroring the 2 KiB input
  limit, `routines/schemas.ts:9`).

`routineScheduleAdapter` gains a branch: when `prompt` is present it skips the
tool lookup and host checks (`routine-adapters.ts:107-124`) and calls a new
`createPromptRoutine` (§4 task 6) with the AI's own chat from `ActionContext`.
The card (`describe`) for the prompt variant:

- summary: `Schedule "<title>": <describeSchedule(schedule)>`;
- details: `Runs this prompt in this chat and posts my answer here: "<prompt>"`.

`routine.pause` / `routine.delete` are unchanged and work for both kinds.
`routineTitleArgsSchema` stays as is (`tool-arg-schemas.ts:91-93`).

### 2.7 Time zones

**AI-17 is fixed; the audit entry is stale.** The audit said no user zone is
stored (`docs/audit/ai-features-audit.md:171-179`, pointing at `context.ts:69`
and `gateway/dm-turn.ts:206-207`). Since then:

- `apps/server/drizzle/0061_user_time_zone.sql:1-2` adds
  `user_profiles.time_zone`;
- `auth/profile-time-zone.ts` reads and writes it (`:10-20,23-39,45-55`), with a
  JID lookup for the group sender (`:62-73`);
- `promptNow` renders "Thursday, 15 October 2026, 04:12 (Europe/Madrid)" and
  falls back to UTC (`agents/prompt-time.ts:9-28`);
- the DM body passes the owner's zone (`dm-turn.ts:228`), the group body the
  sender's zone (`group-turn-body.ts:140-143`).

So "every morning at 8" is stored exactly as today: `schedule.kind = 'daily'`,
`time = '08:00'`, `timezone = <IANA>` (`schedule.ts:50-68`), and the scheduler
fires at that wall clock in that zone (`schedule.ts:157-178`). The zone is
**the routine's own**, chosen at scheduling time: for a DM routine it is the
owner's (the person the AI is talking to), for a topic routine the asking
admin's. A schedule created by the AI without the human naming a zone should use
the zone the AI already sees in its prompt.

**Smallest remaining fix (a one-line task):** the guide already tells the model
to describe the schedule in plain words (`tool-guide.ts:17`) but never tells it
which zone to use. Add one line to `TOOL_GUIDE_LINES` (`tool-guide.ts:8-19`):
use the zone shown next to the current time in the prompt for `schedule.timezone`
today, so a daily routine fires at the human's own 8 o'clock. No schema, table or
client change — AI-17's storage half is done.

---

## 3. UI changes

Nothing new is needed for the answer itself: it is a normal AI message in the DM
or the topic, so it renders like any other turn (task card, drafts, typing).

### Web

- `apps/web/src/lib/tools.ts` `Routine` type (`:1-20`) and `lib/routines.ts`
  helpers: add `kind` and `prompt`.
- `components/tools/RoutinesSection.tsx`:
  - the row's second line (`:258-261`) becomes
    `describeRoutineSchedule · runs a prompt · <status>` for a prompt routine
    (instead of `runs <toolName>`);
  - add one line under it with the prompt's first line, truncated (`truncate`
    already used on the row), so the owner recognises the job without opening
    anything;
  - the status/next-run/last-status lines and Pause/Resume/Delete are unchanged
    (`:262-330`), as is the paused-reason explanation (`:265-267`).
- No new screen, no detail view (the list is the detail today).

### Mobile

- `apps/mobile/src/lib/tools-api.ts` `Routine` interface (`:94-112`) gains `kind`
  and `prompt` (it has neither today). This is the mobile `Routine` the row
  components import (`components/ais/routines-section.tsx:16`); without it the
  new helper below does not typecheck.
- `apps/mobile/src/lib/routines-format.ts` (`routineStatusText` `:37`,
  `routineLastText` `:58`) gains a `routineKindText(routine)` helper returning
  `runs a prompt` or `runs <toolName>`.
- `components/ais/routines-section.tsx` row (`:143-156`) uses it and adds the
  prompt's first line; the action row (`:157-208`) and the empty/loading/error
  states are unchanged (`:217-262`).
- `components/group-info/tools-page.tsx:76` needs no change (it reuses the same
  row component).

Icons stay lucide on both apps; the empty hint text is unchanged.

---

## 4. Task split

Ordered. Each task lists its exact files, a one-line goal and an estimate. A
**DB** task changes schema; **only one DB task runs at a time** (`AGENTS.md:47-60`).

1. **[server, DB]** New migration `apps/server/drizzle/0067_routine_kind.sql` and
   `apps/server/src/db/rows-agents.ts` (`RoutineRow`). Goal: the table and the
   row type can hold a prompt routine. (30 min)
2. **[server, DB]** New migration `apps/server/drizzle/0068_routine_prompt_runs.sql`.
   Goal: the per-AI-per-day counter table. (15 min; could ride in task 1's file.)
3. **[server]** `apps/server/src/routines/schemas.ts`, `queries.ts`, `wire.ts`,
   plus a new `apps/server/src/routines/prompt-routines.ts` holding
   `createPromptRoutine` (so `support.ts`, at 391 lines, does not overflow).
   Goal: create/list/pause/resume a prompt routine and map it to the wire.
   (60 min)
4. **[server]** New `apps/server/src/agents/gateway/routine-run.ts`,
   `agents/gateway/contracts.ts` (new fields + `AgentGateway.runScheduledTurn`),
   `agents/gateway.ts`, `agents/gateway/dm-turn.ts`,
   `agents/gateway/group-turn.ts` (admit a `scheduled` trigger in its batch
   filter), `agents/gateway/group-ingest.ts`, `agents/gateway/group-turn-body.ts`,
   `agents/group-turn.ts`.
   Goal: a scheduled run joins the AI's own per-chat queue and reuses the DM /
   group turn bodies, returning an outcome, with the `scheduled` flag
   suppressing `request_action` / `ask_people` / delegation (§2.5). (120 min)
5. **[server]** New `apps/server/src/routines/execute-prompt.ts`, plus
   `routines/execute.ts` (dispatch), `routines/outcomes.ts`, `routines/scheduler.ts`
   (`runPrompt` port + cap call), `routines/wiring.ts`, `leader/start.ts`,
   `agents/log/retention.ts` (prune `routine_prompt_runs`, §2.5),
   `startup/components.ts`. Goal: the scheduler runs a prompt routine through the
   gateway and records ok/error/skipped with the 3-failure pause. (90 min)
6. **[server]** `apps/server/src/tools/routine-adapters.ts`,
   `apps/server/src/tools/tool-arg-schemas.ts`. Goal: the
   `routine.schedule` prompt variant and its tier-2 card (no hosts, never
   "always allow"). Ship **after** the prompt reader/writer release has fully
   drained — this is the release that starts creating prompt rows, so it is the
   rollout guard of §2.1. (60 min)
7. **[server]** `apps/server/src/agents/tool-guide.ts`. Goal: tell the model to
   reuse the zone shown in its prompt for `schedule.timezone`. (10 min)
8. **[api-contract, web, mobile]** `packages/api-contract/src/routines.ts`,
   `apps/server/src/routines/wire.ts`, `apps/web/src/lib/tools.ts`,
   `apps/web/src/lib/routines.ts`,
   `apps/web/src/components/tools/RoutinesSection.tsx`,
   `apps/mobile/src/lib/tools-api.ts`,
   `apps/mobile/src/lib/routines-format.ts`,
   `apps/mobile/src/components/ais/routines-section.tsx`. Goal: both lists show a
   prompt routine as "runs a prompt" with its first line. (75 min)

Dependencies: 1 → 2, 3; 3 → 5, 6; 4 → 5; 6 → 8; 5 → 8.

**Files that must be split before their task starts (400-line rule,
`AGENTS.md:41`):**

- `apps/server/src/routines/support.ts` — 391 lines today; any prompt-create
  addition overflows → task 3 splits `createPromptRoutine` into a new file.
- `apps/server/src/agents/group-turn.ts` — 399 lines; the scheduled branch must
  live in `group-turn-body.ts` / the new `routine-run.ts`, never here.
- `apps/server/src/agents/gateway/dm-turn.ts` — 396 lines. The scheduled *turn
  body* stays out (it lives in `routine-run.ts` / `group-turn-body.ts`), but
  task 4 still needs ~5 lines here: the batch-filter admit (`:139-153`), the
  displayed-marker skip (`:164`) and the `onOutcome` call at the turn's end
  (§2.2). Four lines of headroom cannot hold them, so task 4 must first move the
  DM batch admission and the `onOutcome` plumbing into `routine-run.ts` (or a
  small helper) and bring the file back under the cap.
- `apps/mobile/src/components/ais/routines-section.tsx` — 357 lines; task 8 must
  extract the row into `components/ais/routine-row.tsx` (new) if it grows.
- `apps/server/src/agents/gateway/contracts.ts` — 355 lines; task 4 adds fields,
  which is safe, but if it approaches 400 the scheduled/unseen fields move to a
  new `agents/gateway/pending.ts`.
- Also near the cap: `apps/web/src/components/tools/RoutinesSection.tsx` (334),
  `apps/server/src/routines/scheduler.ts` (305).

---

## 5. Open questions for Julio (each with a recommendation)

1. **Where does a prompt routine post — the routine's chat only, or should it
   also be able to run silently and post only when something changed?**
   Recommend: post the answer in the chat where the routine lives, always
   (simple, and it is what "every morning tell me the prices" means).
2. **Daily cap number.** Recommend **24 prompt runs per AI per day** (the hourly
   ceiling); 12 if you want it tighter.
3. **A card even when the human literally typed the prompt and the time in one
   message?** Recommend: yes, always a card, and never "always allow" — the
   prompt and the schedule must be seen before they run every time.
4. **Topic routines now, or DM first?** Recommend: both from the start; the
   permission rules (owner / topic admin) already exist and cost nothing to reuse.
5. **Keep the failure ping, or stay silent on a failed run?** Today it already
   pings: the turn body sends its own failure text (DM owner reply; group
   `GROUP_FAILURE_REPLY` plus the owner DM, §2.4), and the 3-failure pause adds a
   second notice. Recommend: keep both. Silencing a transient provider blip would
   mean suppressing the turn body's own failure text for scheduled runs — a
   deviation from chat behaviour.

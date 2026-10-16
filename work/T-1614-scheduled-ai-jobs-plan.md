---
id: T-1614
title: "Audit + plan (docs only): scheduled AI jobs — 'every morning, run this prompt' as a normal AI turn (with its computer when on), next to today's tool routines; map the routines code, design the prompt kind end to end, split into tasks"
status: merged
milestone: M5
branch: task/T-1614-scheduled-ai-jobs-plan
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1614: Plan for scheduled AI jobs

## Spec (written by Claude, do not edit)

### Why
Julio (2026-10-16) wants AIs to do jobs on a schedule, for example "every morning get me the gold, S&P 500 and BTC prices", and more generally any job the AI does on its computer.

**What exists today:** routines (T-0104 to T-0107, `docs/AI_TOOLS.md`). A routine runs a **saved tool** (model-written code in the server sandbox) on a schedule and posts its output. It never runs an AI turn, so it can't use the AI's computer or think.

**Julio's choice:** keep tool routines (they are on in live since 2026-10-16), and plan **scheduled AI jobs** next. At each run, the AI gets a fixed prompt and runs a normal turn in its DM or topic. It uses its computer when that is on, and posts its answer there.

**This task writes the plan only. No code.** The lead turns it into a D24 design canvas for Julio (web and phone), then into specs.

### Facts (the lead read them on 2026-10-16, main after T-1612)
- **The `routines` table** (`apps/server/drizzle/0023_classy_lester.sql:1-22`):
  - `id`, `ai_id`, `group_id`, `topic_id`, `tool_id` (NOT NULL), `title`, `schedule` jsonb, `input` jsonb, `approved_hosts` jsonb;
  - `status` (default `active`), `paused_reason`, `next_run_at`, `last_run_at`, `last_status`, `consecutive_failures`, `created_by`, the timestamps and `deleted_at`;
  - a check that `group_id` and `topic_id` are null together.
- **The server code:** `apps/server/src/routines/`, mainly:
  - `scheduler.ts` (305 lines) and `execute.ts` (198; its header `:1-20` lists the run steps);
  - `schedule.ts` (311), `api.ts` (166), `service.ts` and `wiring.ts`.
  - `apps/server/src/tools/routine-adapters.ts` holds the AI's `routine.schedule` action and its approval card.
- **The UI:** web `apps/web/src/components/tools/RoutinesSection.tsx` (334 lines); mobile `apps/mobile/src/components/ais/routines-section.tsx` (357).
- **How an AI turn runs today:** an incoming message reaches the per-AI pump (`apps/server/src/agents/gateway.ts:260-293`, `pumpSessionEffect`).
  - The DM turn is `apps/server/src/agents/gateway/dm-turn.ts` and the group turn `apps/server/src/agents/gateway/group-turn-body.ts`.
  - The computer is resolved per turn by `resolveTurnDesk`. Turns with the computer get 40 rounds, 80 calls and 15 minutes (T-1611, `apps/server/src/agents/tool-loop.ts`).
  - A budget gate runs before every round (`checkRoundGate`), and Stop works mid-turn (T-1422).
- **Time zones:** `docs/audit/ai-features-audit.md:170-178` (AI-17) says no user time zone is stored. Check what `apps/server/src/auth/profile-time-zone.ts` does now.
- **The size rule:** at most 400 lines per source file. `apps/server/src/agents/group-turn.ts` is at 399 and `apps/server/src/agents/gateway/dm-turn.ts` at 396.

### What the plan must answer (`docs/plan/scheduled-ai-jobs.md`)
1. **Today's routines, in one page:**
   - the data model, the scheduler loop (claiming, leader, missed runs), the run steps and outcomes, pausing after failures;
   - who may create, edit, pause and delete, and how (API, the AI action and its approval card, web and mobile UI);
   - cite `file:line` throughout.
2. **The prompt kind, end to end:**
   - **Data:** a new `kind` (`tool` | `prompt`), a nullable `tool_id`, a `prompt` text column, and anything else needed. Write the hand-written SQL migration as text in the plan, and the `apps/server/src/db/rows.ts` changes.
   - **Running a turn with no incoming message:** where the scheduler hands a prompt run to the gateway, and how the run joins the AI's per-session queue so it never overlaps a live chat turn. Name the function to add and the files it touches. It must reuse the existing DM and group turn bodies, not copy them.
   - **The run's prompt:** what the AI receives (the stored prompt, a short "scheduled run" line, the time in the owner's zone) and where the answer is posted (the owner's DM, or the topic).
   - **Outcomes:** success, failure (the model fails, the budget is limited, the AI is offline or stopped), the failure count and pause rule, and what the human sees on a failed run.
   - **Safety:**
     - only the owner (DM) or a topic admin creates one;
     - an AI-created schedule needs a human approval card (state what it shows) and never "always allow";
     - the budget gate applies to every round;
     - limit the runs per AI per day, and propose the number;
     - no money actions.
   - **Creation from chat:** a new `routine.schedule` variant for prompt routines (no hosts, since the computer's egress is open web by Julio's decision). Show the card content.
   - **Time zones:** what a schedule like "every morning at 8" is stored as, and whose zone it uses. If AI-17 is still open, include the smallest fix as a task.
3. **The UI changes** for web and mobile: which screens and components change, and what each list row and detail shows. Describe them; the lead draws the canvas.
4. **The task split:** ordered tasks, each with its exact files, a one-line goal and an estimate in minutes.
   - Respect the 400-line rule: list any file that must be split first.
   - Mark the database-schema task: only one runs at a time.
   - Mark which tasks are web, mobile and server.
5. **Open questions for Julio**, at most 5, each with a recommended answer.

### Allowed files
- `docs/plan/scheduled-ai-jobs.md`
- `work/T-1614-scheduled-ai-jobs-plan.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Every claim about today's code cites `file:line`.**
- **The plan names real functions and files only;** every new one is marked "new".
- **No source files change.**

---

## Report (written by the worker when done)

### What I did

Wrote the plan only: `docs/plan/scheduled-ai-jobs.md` (new). No source file
changed. The task file's front matter is the only other edit (status plus the
lead's uncommitted `agents/tools/` → `tools/` path fix for
`routine-adapters.ts`, kept as instructed).

The plan answers all five parts of the spec:

1. **Today's routines.** Data model (`0023_classy_lester.sql:1-22`,
   `db/rows-agents.ts:153-173`), the scheduler (claim/CAS `scheduler.ts:212-280`,
   leader-only via `leader/start.ts:210-217` + `leader/lock.ts`, missed runs
   `scheduler.ts:20-23,250-276`, pool `scheduler.ts:18`), the seven run steps
   (`execute.ts:1-23,97-198`), outcomes/pausing (`outcomes.ts`), and who may
   create/edit/pause/delete (no create route — `service.ts:3-5`; `access.ts:49-74`;
   tier-2 card `routine-adapters.ts:76-155`; `registry.ts:221-234`), plus web and
   mobile today. Every claim cites `file:line`.
2. **The prompt kind.** Hand-written SQL for the `kind`/`tool_id`/`prompt`
   migration and the daily-counter table, the `rows.ts` (= `rows-agents.ts`)
   changes, the dispatch in `execute.ts` → new `routines/execute-prompt.ts`, the
   gateway handoff (new `agents/gateway/routine-run.ts` +
   `AgentGateway.runScheduledTurn`) that pushes a synthetic trigger onto the
   existing `session.pending` / `session.roomPending` queues so it never overlaps
   a live turn, the prompt text and where the answer is posted, the outcome
   table, safety (owner/topic-admin only, tier-2 card and no "always allow",
   budget gate per round, Stop, 24 runs/AI/day enforced in one atomic statement,
   no money actions), the `routine.schedule` prompt variant and its card, and
   time zones.
3. **UI changes** for web and mobile, per component and per row line.
4. **Task split:** 8 ordered tasks with exact files, goals and minute estimates;
   DB tasks marked and "one at a time"; web/mobile/server tagged; the files that
   must be split first under the 400-line rule are named.
5. **Five open questions**, each with a recommendation.

**Correction to the spec's facts (checked against the tree):**

- The routine action file is `apps/server/src/tools/routine-adapters.ts` (the
  lead already fixed this in the task file).
- AI-17 (no user time zone) is **already fixed** by T-1440, which postdates the
  audit: `drizzle/0061_user_time_zone.sql:1-2`, `auth/profile-time-zone.ts:10-73`,
  `agents/prompt-time.ts:9-28`, wired at `gateway/dm-turn.ts:228` and
  `gateway/group-turn-body.ts:140-143`. The audit entry
  (`docs/audit/ai-features-audit.md:171-179`) is stale. The plan includes only the
  smallest remainder: a one-line prompt-guide tweak (task 7). The "small fix as a
  task" the spec asks for is therefore tiny and is included.
- The `routines` row type lives in `apps/server/src/db/rows-agents.ts`, re-exported
  by `db/rows.ts:379` — the spec's "`rows.ts` changes" are made there.

Nothing in the plan is **unverified** except where explicitly marked; I read each
cited file (in the ranges cited) rather than assuming.

### Checks run

`pnpm gate` (from the repo root), real output:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.4s)
PASS  lint  (1.0s)
PASS  typecheck  (1.3s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single tests were run: no source file changed, and `pnpm gate` skipped the
effect/test step for the same reason.

### Notes for the lead

- Only two files changed, both under Allowed files: `docs/plan/scheduled-ai-jobs.md`
  (new) and this task file.
- The two open recommendations most worth Julio's eye: the daily cap number
  (recommend 24) and whether a card is always required (recommend yes).
- The plan keeps the answer inside the turn, so no new send path, no new egress
  and no new audit content (ids only) are introduced.

### Round (fix round 1, 2026-10-16)

Fixed every finding in `PREREVIEW.md` (1 must-fix, 4 should-fix) in
`docs/plan/scheduled-ai-jobs.md`. One commit per finding. No source file changed,
so no test was added (the findings name none; this is a docs-only task). One nit
riding a changed line was fixed; the rest are untouched.

- **Finding 1 (must-fix) — Stop is not a failure.** Added the third scheduled-run
  outcome `'stopped'`: the resolver type, the `execute-prompt.ts` mapping bullet,
  the §2.4 table (a real failure sends the turn body's own failure text; a Stop
  records `skipped` and is quiet), the summary paragraph, and Q5's false premise.
  Verified against `agents/dm-turn.ts:148-166`, `agents/turn-stop.ts:37-40`,
  `agents/group-turn.ts:249-260`, `group-turn-body.ts:300`.
- **Finding 2 (should-fix) — group batch filter.** §2.2 now names the second
  filter (`agents/gateway/group-turn.ts:134-167`) and the admission change; task 4
  gains that file.
- **Finding 3 (should-fix) — rollout guard.** §2.1 gained the new-row-under-old-
  reader guard (`execute.ts:128-139` → immediate pause plus chat notice), and the
  task split marks task 6 as the release that must follow the reader rollout.
- **Finding 4 (should-fix) — tool surface.** §2.5 now states which tools a
  scheduled run offers (desk on; `request_action` / `ask_people` / delegation off
  via the `scheduled` flag), flagged as Julio's decision; task 4's goal updated.
- **Finding 5 (should-fix) — `gateway/dm-turn.ts` split.** §4 now requires task 4
  to pre-split the ~5 lines of batch admission / `onOutcome` (the file is
  396/400).
- **Nit 6**, first occurrence: the `budget.ts:117-192` citation, on a line finding
  1 changed, now reads `apps/server/src/agents/gateway/budget.ts:117-192`.

### Disagreements

- Finding 2's parenthetical says the group batch-filter file is "at 399/400
  lines". The filter lives in `agents/gateway/group-turn.ts`, which is 338 lines
  (62 of headroom); the 399-line file is `agents/group-turn.ts`, the turn body,
  which that edit does not touch. I implemented the finding (described the filter,
  added the file to task 4) but wrote the accurate size, so no pre-split is needed
  there.
- Nit 6 has a second `budget.ts` citation in §2.5 (the `utcDay` / round-gate refs)
  on a line no finding changed; per the round rules I left it.

### Checks run (this round)

`pnpm gate` from the repo root, real output:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.8s)
PASS  format  (0.8s)
PASS  lint  (1.7s)
PASS  typecheck  (2.0s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single tests were run: no source file changed and no finding names a test.

### Round (fix round 2, 2026-10-16)

Fixed all **5 should-fix** findings in the fresh `PREREVIEW.md` (no must-fix) in
`docs/plan/scheduled-ai-jobs.md`; one commit per finding. No source file changed,
so no test was added: the findings name none and this is a docs-only task (the
brief's "add a test" applies to behaviour fixes in source, and there is no source
behaviour here).

- **Finding 1 — a scheduled run never coalesces.** §0 and §2.2 now state that a
  `scheduled` item forces its own turn: the DM pump takes the queue up to but not
  including the first `scheduled` item and runs it alone (`dm-turn.ts:103-106`,
  `:154`), and the room coalescing loop stops before it with `take = 1`, like the
  `delegationId` branch (`group-ingest.ts:290-310`). Both files are already in
  task 4.
- **Finding 2 — early-return outcomes.** §2.2 names every body early return and
  the outcome it must resolve: DM AI-row-gone `'offline'` (`dm-turn.ts:129-134`),
  not-an-owner-message `'skipped'` (`:149-152`), daily limit `'limited'`
  (`:178-180`); group AI-row-gone `'offline'` (`group-turn.ts:117-122`), left the
  room `'not_in_room'` (`:123-126`), gate lookup failed `'skipped'` (`:130-133`),
  empty `eligible` `'skipped'` (`:164-166`), daily limit `'limited'` (`:212-215`),
  rate/round drop `'skipped'` (`:222-240`). The resolver union is named
  (`ScheduledRunOutcome`), `runScheduledTurn`'s `{ kind: … }` returns are
  normalised to it, and §2.4 gains the rate/round-drop row.
- **Finding 3 — mobile `Routine`.** `apps/mobile/src/lib/tools-api.ts` (`:94-112`)
  added to task 8 and to §3; the interface gains `kind`/`prompt`.
- **Finding 4 — retention file.** `apps/server/src/agents/log/retention.ts` added
  to task 5, where §2.5 already says the prune happens (`leader/start.ts:206`
  starts the sweep, so the file was missing from the task, not the design).
- **Finding 5 — trigger identity.** §2.2 step 2 now states `fromJid` = the
  owner's JID, `fromResolved = true`, `timestamp = at`, `id` = a fresh
  `randomUUID()`, `fromNick` unset. The group second-filter bullet drops the false
  "no human sender JID" premise, and §2.3 now notes the sender-derived
  `timeZoneForJid` lookup already yields the owner's zone, so the group body needs
  **no** change (it previously asked for a `timeZoneFor` fallback).
- **Nit 10** (on lines findings 2 and 5 changed): §2.2 now also resolves queued
  scheduled items when the pumps see `session.stopped` or `handleReplaced` clears
  the queues (`sessions.ts:338-347`). The other nits are on untouched lines and
  were left, per the round rules.
- **Finding 2 refinement** (in this report commit): the group gate-lookup failure
  resolves `'skipped'` rather than a new `'failed'`, to stay inside the finding's
  listed resolutions (`limited`/`offline`/`skipped`) and avoid a silent failure
  count.

**Tests added:** none (docs-only; no finding names a test and no source changed).

`pnpm gate` from the repo root, real output:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (1.1s)
PASS  lint  (1.0s)
PASS  typecheck  (0.8s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Disagreements (fix round 2)

None: every one of the 5 should-fix findings verified against the tree and was
implemented as written.



## Review (written by Claude)

Approved and merged (docs only), after two auto fix rounds; pre-review clean with 6 discretionary nits, not taken. The plan `docs/plan/scheduled-ai-jobs.md` was the base for T-1638 to T-1658, which were all merged on 2026-10-16 while this review ran (the paid Muse pre-review hit long API timeouts). Where the built code differs from the plan, the code and the task Reviews win: scheduled runs keep `request_action` marked unattended (T-1655), the 20-minute timer starts when the turn starts (T-1657), and an offline run refunds its daily slot (T-1658). The lead's answers to §5 Q1-Q5 are in `work/NOW.md`.

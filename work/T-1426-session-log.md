---
id: T-1426
title: "UX task F: the AI session log behind 'View steps': agent_task_events table (migration 0060), a task id per turn on the card, best-effort writers (status, model call, tool call/result, answer, error), 30-day sweeper, owner-only GET /api/agents/tasks/:taskId/events"
status: merged
milestone: M5
branch: task/T-1426-session-log
model: auto
effort: default
depends_on: [T-1414]
estimate: 1 day
---

# T-1426: Session log and View steps route

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: AIs work in the background, and the owner can open **"View steps"** on a task card to see what the AI did: commands, results, timings (`docs/design/agent-system.md` §4.5). The design is `docs/audit/agent-ux-plan.md` §2.5 and Task F.

**The lead's decisions (T-1398 Review):**
- store **redacted, 2 KiB-truncated** tool output;
- **owner only**;
- **30-day** retention.

The UI is the next task (Task G).

### Facts (the lead checked them on main, 2026-10-15)
- **The schema:** §2.5 of the plan gives the table (`id`, `task_id`, `ai_id`, `chat_jid`, `seq`, `kind`, `at`, `duration_ms`, `data jsonb`, a unique `(task_id, seq)`, and an index). Add an `owner_id` column for the owner-only check.
- **Migrations:** the latest is `apps/server/drizzle/0059_drop_litellm_tables.sql`. New ones are hand-written; follow 0058/0059, start with `SET lock_timeout = '5s';`, and update `apps/server/src/db/rows.ts`.
- **There's no task id per turn yet:** the card payload has an optional `task_id` (`packages/protocol/src/progress.ts`), and the reporter takes an optional `taskId` (`apps/server/src/agents/gateway/live.ts:85`). The DM and room turn bodies (`gateway/dm-turn.ts`, `gateway/group-turn-body.ts`) don't set one. **Generate one per turn** (a uuid) and put it on the card, so the client can open View steps.
- **Where to write events** (the same places that emit the card):
  - the tool loop round (`apps/server/src/agents/tool-exec.ts`, `runLoopRound`) for `tool_call`/`tool_result`;
  - the model call wrapper (`apps/server/src/agents/tool-loop.ts`) for `model_call` (tokens, duration, failure class);
  - the reporter (`gateway/live.ts`) for `status`;
  - the answer send for `answer`;
  - the failure path for `error`, using the fixed class from `apps/server/src/agents/failure-class.ts`.
- **Redaction helpers:** `redactSecrets` is in `apps/server/src/ai/http.ts` (moved there by T-1413). `toRedactedError` is in `agents/redact-error.ts`.
- **The sweeper model:** `apps/server/src/approvals/sweeper.ts`, a leader-only 60 s tick. It's registered in `apps/server/src/leader/start.ts` (see `:13` and the timers near `:211`).
- **Deletes:** the group delete cascades through foreign keys (`apps/server/src/groups/delete-group.ts:57-59`). Add `ON DELETE CASCADE` references to `ais(id)` so deleting an AI removes its events.
- **T-1422** (Stop, running in parallel) edits the same agent files; expect a small rebase.

### What to build
1. **Migration `0060_agent_task_events.sql`:** the table and index from §2.5, plus `owner_id text NOT NULL`, and `ai_id` referencing `ais(id) ON DELETE CASCADE`. Update `rows.ts`.
2. **A task id per turn:** generate it at the start of each DM and room turn, and put it on the card (`task_id`) and on every event.
3. **`apps/server/src/agents/log/`** (new, at most 400 lines per file):
   - `append.ts`: `appendEvent({ taskId, aiId, ownerId, chatJid, kind, durationMs?, data })`. It assigns `seq` per task in memory per turn and is **best effort**: a failure logs ids only and never fails the turn.
   - **`data` for a tool row:** the tool name, the args with secrets redacted (`redactSecrets`) **truncated to 2 KiB**, the output redacted and **truncated to 2 KiB**, byte counts, the exit code and the duration.
   - **A model row:** tokens in and out, the duration and the cost estimate if known.
   - **An error row:** the fixed failure class only.
   - **No message text** from humans in any row.
   - `read.ts`: page through a task's events by `seq` (`?after=&limit=`, max 100).
   - `retention.ts`: delete rows older than 30 days, from a leader-only sweeper registered next to the approvals sweeper.
4. **The route:** `GET /api/agents/tasks/:taskId/events?after=&limit=` in a new contract group `packages/api-contract/src/agent-tasks.ts` (prefix `/api`, Session middleware).
   - **Owner only:** an unknown task and someone else's task both answer the same 404.
   - The response is `{ events: [...], next: seq | null }`.
   - Register it where the other groups are (follow how an existing group is added in `apps/server/src/app.ts`).
5. **Mock backend:** the route, returning a short scripted list for the mock card's task id. Set a `task_id` on the mock "Writing release notes" card, so Task G has data.

### Tests (permissions and message pipeline: required)
`apps/server/src/agents/log/`:
- append and read return events in order;
- **another user gets 404** and so does an unknown task;
- the tool output is truncated at 2 KiB and a fake key (`sk-...`) is redacted;
- retention deletes only rows older than 30 days;
- a failing append doesn't fail the turn (one case through the existing gateway test harness, if it's cheap).

### Read first
`AGENTS.md` (migrations, security checklist, audit rules), `docs/audit/agent-ux-plan.md` §2.5 and Task F, and the files above.

### Allowed files
`apps/server/drizzle/0060_agent_task_events.sql`, `apps/server/drizzle/meta/**`, `apps/server/src/db/rows.ts`, `apps/server/src/agents/**`, `apps/server/src/leader/start.ts`, `apps/server/src/app.ts`, `apps/server/src/main.ts`, `packages/api-contract/src/agent-tasks.ts`, `packages/api-contract/src/index.ts`, `packages/api-contract/src/api.ts`, `packages/protocol/src/progress.ts`, `packages/mock-backend/src/**`, `work/T-1426-session-log.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/log --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes; every file is at most 400 lines.
- The migration continues from 0059, and live behaviour is unchanged except for new rows and the task id on cards.

---

## Report (written by the worker when done)

### What I did
- **Migration + row type.** `apps/server/drizzle/0060_agent_task_events.sql` (continues from 0059): `agent_task_events` (`id`, `task_id`, `ai_id` FK → `ais(id)` ON DELETE CASCADE, `owner_id`, `chat_jid`, `seq`, `kind`, `at`, `duration_ms`, `data jsonb`), `UNIQUE(task_id, seq)`, a `(task_id, seq)` index and an `at` index for the sweeper. Row type `AgentTaskEventRow` added to `apps/server/src/db/rows.ts`.
- **A task id per turn.** A fresh uuid per DM turn (`agents/gateway/dm-turn.ts`) and per room turn (`agents/gateway/group-turn.ts`), created by `openTurnLog` (`agents/log/append.ts`); it rides the card as `task_id` (via the reporter) and keys every event.
- **`apps/server/src/agents/log/`.** `append.ts` (`TASK_EVENT_KINDS`, `TurnLog`, `createTurnLog`/`openTurnLog`, `insertEvent`, `redactAndTruncate` capped at 2 KiB, recursive `data` sanitizer), `read.ts` (`listTaskEvents` paged by `seq`, max 100, `loadTaskOwnerId`), `retention.ts` (30-day delete + leader-only 60 s sweeper like the approvals one), `api.ts` (the route).
- **Route.** Contract `packages/api-contract/src/agent-tasks.ts` (`GET /agents/tasks/:taskId/events?after=&limit=`, `Session`, `/api` prefix), added to `api.ts`/`index.ts`; server `agents/log/api.ts` mounted in `app.ts`. Owner-only: an unknown task and a foreign task both answer 404. Retention sweeper registered in `leader/start.ts` next to the approvals sweeper.
- **Writers (all best effort).** `model_call` in `tool-loop.ts` `requestCompletion` (tokens in/out, duration, cost when the catalog knows the model); `tool_call`/`tool_result` in `tool-exec.ts` `runLoopRound` (tool name, args and output redacted + truncated to 2 KiB, byte counts, duration, `exit_code` when the tool reports one); `status` in `gateway/live.ts`; `answer` in `dm-tool-turn.ts` `sendReply` and `group-turn.ts` `sendGroupReply` (byte size only, never text); `error` in the DM/group failure paths using the fixed class (`failureLogFields`).
- **Mock.** New `packages/mock-backend/src/domains/agent-tasks/` serving the route with a scripted list; the "Writing release notes" card now carries `task_id: 'task-release-notes'`.

### Files changed
`apps/server/drizzle/0060_agent_task_events.sql` (new); `apps/server/src/db/rows.ts`; `apps/server/src/agents/log/{append,read,retention,api}.ts` (new), `apps/server/src/agents/log/{log,api}.test.ts` (new); `apps/server/src/agents/{tool-loop,tool-calls,tool-exec,dm-turn,dm-tool-turn,group-turn}.ts`; `apps/server/src/agents/gateway/{live,dm-turn,group-turn,group-turn-body,desk-exec}.ts`; `apps/server/src/{app.ts,leader/start.ts}`; `packages/api-contract/src/{agent-tasks.ts (new),api.ts,index.ts}`; `packages/mock-backend/src/domains/agent-tasks/{events,routes,index}.ts` (new), `packages/mock-backend/src/domains/index.ts`, `packages/mock-backend/src/domains/messages/threads/dev-team.ts`.

### Commands and real results
- `pnpm install` — Done (16.5 s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/log` — 2 files, **8 passed** (append/read order, 2 KiB truncation + `sk-` redaction, `seq` paging, retention window, failing append never throws, owner/stranger/unknown 404 + 401).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/log src/agents/gateway-group.test.ts src/agents/gateway-drain.test.ts src/agents/gateway-desk.test.ts src/agents/reply.test.ts src/agents/task-card.test.ts src/agents/dm-turn.fake-provider.test.ts` — 8 files, **40 passed**.
- `pnpm gate` (from the repo root) summary lines:
  ```
  gate: 30 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.3s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.2s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/api-contract (no nearby test files)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/server  (9.6s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  GATE PASS
  ```

### Deviations and notes
- The row type landed in `apps/server/src/db/rows.ts` (named in Allowed files), not `rows-agents.ts`; `rows.ts` re-exports `rows-agents`, so all readers are unchanged.
- `tool-loop.ts` got a `// effect-plain:` marker so the Effect ratchet stays green: it is the Promise edge over `ai/model-client` (`chat` is the Effect), was plain on base, and my `async`/`try` added ratchet signals.
- `liveProgressReporter` now takes the turn's log and derives the card's `task_id` from it (one parameter instead of two). Both call sites pass a log, so behaviour is the same.
- `exit_code` is stored only when the tool produces one (today the desk tools); other tools omit it.
- The "failing append doesn't fail the turn" case is a unit test of `createTurnLog` against an unregistered database (cheaper than the gateway harness); the model-failure paths are already covered by the existing agent tests.
- The mock route is not unit-tested (the package's gate step is skipped as it has no nearby tests); I verified it by hand with `tsx`: `task-release-notes` → 200 with the list, unknown id → 404, `?after=3&limit=1` → one event and `next: 4`.

### Security checklist
- Owner only; an unknown task and another user's task answer the same 404 (tested). The new GET is session-required and the gate's 401 authz sweep ran green.
- Nothing runs before the permission check, and every append is best effort: a write failure logs ids only and never fails the turn (tested).
- Secrets are redacted on every write (named secrets plus the `sk-` backstop) and every string in `data` is truncated to 2 KiB. Tool args/output are allowed, but no human message text is stored: `answer` holds a byte count only, `status` holds fixed stage labels, `error` holds the fixed failure class.
- Retention is 30 days via a leader-only sweeper, and deleting an AI cascades its events away (`ON DELETE CASCADE`).

### Blocked / needs a decision
None.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 5.
- Migration 0060: lock_timeout; ai_id FK with ON DELETE CASCADE; task and time indexes.
- The log tests pass locally (2 files, 8).
- Sizes: group-turn 400 and dm-turn 400 (at the limit). app.ts +5 to register the route, accepted: it was already 574 on main, and T-1427 enforces no growth from now on.
- After deploy: expect 'migrations applied: 61'.

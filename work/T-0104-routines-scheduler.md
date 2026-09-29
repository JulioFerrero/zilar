---
id: T-0104
title: Routines: scheduled tool runs that post into the chat as the AI (scheduler, service, routes)
status: planned
milestone: M4
branch: task/T-0104-routines-scheduler
model: meta/muse-spark-1.3-contributor
depends_on: [T-0102, T-0103]
estimate: 2 days
---

# T-0104: Routines and the scheduler

## Spec (written by Claude, do not edit)

### Why
"Every morning post the price of gold, the S&P 500 and BTC." A **routine** is a stored tool (T-0103) plus a schedule, in one chat, that posts the tool's output as the AI. This task builds the engine: the table, a scheduler that fires due routines exactly once, the run-and-post path, safety rules, and the routes to list/pause/resume/delete. **Creating** a routine from a chat request (the approval card) is T-0105; here `createRoutine` is a service function that the T-0105 adapter will call **after** a human approved.

### Julio's rules that apply
- A routine belongs to **one AI and one chat** (`group_id` null = the personal chat). It only ever posts into that chat.
- Stopping the AI stops its routines at once (kill switch). Removing the AI from the group deletes that group's routines.
- Groups: routines are created by group admins only (enforced in T-0105 by the same rule as `request_action`); everyone in the room sees the posts.
- No usage or cost tracking.

### Data model (`apps/server/src/db/schema.ts`; migration only via `pnpm --filter @galena/server db:generate`, never `npx`)
`routines`: `id`, `ai_id` (fk cascade), `group_id` (nullable fk cascade), `tool_id` (fk `ai_tools`, cascade), `title` (1–80 chars), `schedule` (jsonb, see below), `input` (jsonb, ≤ 2 KiB serialised, default null), `approved_hosts` (jsonb string array: the exact host set a human approved), `status` (`active` | `paused` | `needs_approval`), `paused_reason` (nullable: `user` | `failures` | `hosts_changed`), `next_run_at` (timestamp), `last_run_at` (nullable), `last_status` (nullable `ok` | `error` | `skipped`), `consecutive_failures` (int), `created_by`, `created_at`, `updated_at`, `deleted_at` (nullable soft delete). Index on `(status, next_run_at)` for the scheduler query. Limit: 10 non-deleted routines per (AI, chat).

### Schedules (`apps/server/src/routines/schedule.ts`, pure, no dependency: use `Intl.DateTimeFormat` for time zones)
Validated with `zod`:
- `{ kind: 'daily', time: 'HH:MM', timezone: <IANA name accepted by Intl>, weekdays?: number[] }` (1 = Monday … 7 = Sunday, default all days, at least one).
- `{ kind: 'interval', everyMinutes: number }` with **60 ≤ everyMinutes ≤ 10 080** (nothing more frequent than hourly; this is a hard rule, not a default).
`nextRunAfter(schedule, from: Date): Date` returns the next occurrence strictly after `from`. Daily schedules are **wall-clock in the given time zone** and correct across daylight-saving changes: a 02:30 time on the spring-forward day (that wall time does not exist) runs at the first valid moment after it that day (03:00), and on the fall-back day (the hour occurs twice) it runs once (the first occurrence). Tests cover `Europe/Madrid` and `America/New_York` around both 2026 transitions, weekdays filtering, a month/year rollover, and an invalid time zone / `25:00` / empty weekdays being rejected.

### Scheduler (`apps/server/src/routines/scheduler.ts`)
`createRoutineScheduler({ db, runTool, post, now, tickMs, logger, audit, maxPerTick })` with `start()` / `stop()` (a timer, `unref`'d, default tick 30 s) and a `tick()` that tests call directly.
- **Claim exactly once (at most once, never twice):** select due rows (`status = 'active'`, `deleted_at is null`, `next_run_at <= now`, oldest first, `maxPerTick` default 5). For each, first **advance** `next_run_at` to `nextRunAfter(schedule, now)` with a conditional update (`where id = ? and status = 'active' and next_run_at = <the value read>`); only the caller whose update changed a row runs it. If the process dies mid-run the run is skipped, never duplicated (write this trade-off in the code comment). A routine that is many periods overdue (server was off) runs **once**, not once per missed slot.
- **Run** (`executeRoutine`), in this order, stopping at the first failing step:
  1. AI must be `active` and (for a group routine) still a member: otherwise record `last_status = 'skipped'`, post nothing, keep the routine active (it resumes with the AI).
  2. The tool must exist (not deleted): otherwise set `status = 'paused'`, `paused_reason = 'failures'` and post the fixed 3-failure notice below once.
  3. **Host pinning:** the current version's `hosts` must be a **subset** of `approved_hosts`. If not, set `status = 'needs_approval'`, `paused_reason = 'hosts_changed'`, post the fixed notice "The routine "<title>" is paused: its tool now contacts new sites. Ask me to schedule it again to approve them." once, audit `routine.paused`. (A change of code that keeps the same or fewer hosts keeps running: that is the "improve it" path.)
  4. Call the injected `runTool` (T-0103's `runToolVersion` with `trigger: 'routine'`, current version, the routine's `input`).
  5. Success → post `"<title>\n<output.text>"` (text trimmed to 4 000 characters, a trailing `…` when cut) through the injected `post({ aiId, groupId, text })` (T-0092's `postToChat`); `post` answering `false` means the AI is stopped/not in the room: record `skipped`, no failure count. `consecutive_failures = 0`, `last_status = 'ok'`.
  6. Failure (runner `ok:false`, or a thrown error) → `consecutive_failures += 1`, `last_status = 'error'`; on the **3rd** in a row set `status = 'paused'`, `paused_reason = 'failures'`, post once the fixed notice "The routine "<title>" was paused after 3 failed runs. Ask me to fix it." Failures never post the tool's error text or logs into the chat (they stay in `ai_tool_runs`).
- **Concurrency:** at most 2 routines run at the same time inside a tick; a tick never overlaps the previous one (skip if still running).
- Every run writes an audit entry `routine.run` (`detail`: `{ status, durationMs }` only: **no output text, no source, no error message**); pauses write `routine.paused` with the reason.
- The fixed notices and the posted output are plain text; the existing chat renderer handles Markdown safely. The post is authored by the AI's session exactly like the approval-card notices in T-0092.

### Service and routes (`apps/server/src/routines/service.ts`, `routes.ts`, mounted under `/api` in `app.ts`)
- `createRoutine(db, { aiId, groupId, toolId, title, schedule, input, approvedHosts, userId }, now)`: validates everything, checks that the tool belongs to the same `(aiId, groupId)`, sets `approved_hosts` = the given set (must be a superset of the tool's current version hosts; otherwise `hosts_not_approved`), computes `next_run_at`, enforces the limit of 10, audits `routine.created`. **No HTTP route creates a routine** in this task.
- `GET /api/ais/:id/routines` (AI owner; all chats, with `scope`), `GET /api/groups/:id/routines` (any group member). Each row: id, title, toolName, schedule, status, pausedReason, nextRunAt, lastRunAt, lastStatus, approvedHosts. **No tool source.**
- `POST /api/routines/:id/pause` (manager), `POST /api/routines/:id/resume` (manager; `409 needs_approval` when `status = 'needs_approval'`; a routine paused for `failures` resumes with `consecutive_failures = 0` and `next_run_at` recomputed from now), `DELETE /api/routines/:id` (manager, 204, idempotent). Manager = AI owner, or the group's owner/admin for a group routine. Reader = AI owner or any group member. Anyone else: the same 404 as a missing id.
- Audit: `routine.created`, `routine.paused`, `routine.resumed`, `routine.deleted`, `routine.run`.
- `deleteRoutinesForAiInGroup` soft-deletes a group's routines for that AI; call it from `groups/service.ts` `removeGroupAi` next to the tools/rules cleanup. Deleting a tool (T-0103 `deleteTool`) also soft-deletes its routines.
- **Wiring:** new env `ROUTINES_ENABLED` (zod boolean, default `false`) in `config.ts`; when true, `index.ts` builds the scheduler with the real `runToolVersion` (with whatever `toolRunner` `index.ts` has; if none is configured the scheduler is **not** started and one warning is logged), the gateway's `postToChat` (via the same `gatewayRef` closure the announcer uses), the audit recorder, and starts it after the server is listening; it stops on shutdown like the other timers. Document the variable in `docs/SERVER_CONFIG.md`.

### Read first
- `AGENTS.md` (mandatory)
- `work/T-0103-ai-tools-store.md` (Spec; its code if merged: `tools/service.ts`, `tools/types.ts`) and `T-0102-tool-sandbox.md`
- `apps/server/src/actions/gateway.ts` (`recoverStuck` timer, exactly-once claim by conditional update), `actions/announce.ts`, `approvals/sweeper.ts` (a timer with `start`/`stop` and a tickable function), `index.ts` (how timers, `gatewayRef` and shutdown are wired), `config.ts`
- `apps/server/src/approvals/rules.ts` and its routes (scope model, 404 shape), `groups/service.ts` `removeGroupAi`
- `docs/PROJECT_PLAN.md` §9.4 (who speaks and limits) and E4 in the questions table

### Allowed files
- `apps/server/src/routines/**` (new)
- `apps/server/src/db/schema.ts` + the generated migration
- `apps/server/src/app.ts`, `index.ts`, `config.ts`, `config.test.ts`
- `apps/server/src/groups/service.ts` (+ test), `apps/server/src/tools/service.ts` (only: `deleteTool` also soft-deletes the tool's routines; keep the change minimal)
- `apps/server/src/audit/**` only for new action names
- `apps/server/src/authz-sweep.test.ts`
- `docs/SERVER_CONFIG.md`
- `work/T-0104-routines-scheduler.md`

**Not allowed:** the sandbox, the AI loop / agents / actions gateway, web, mobile, other dependencies.

### Tests (Vitest, PGlite, fake clock, fake `runTool` and `post`; no network)
- Schedule: as listed above, including DST in two zones, weekdays, invalid input, the 60-minute minimum.
- Scheduler: a due routine runs once and posts the formatted text; two concurrent `tick()`s (or two schedulers on the same DB) run it once; an overdue-by-days routine runs once and `next_run_at` lands in the future; not-due and paused/needs_approval/deleted routines do not run; stopped AI → `skipped`, nothing posted, still active, and it resumes when the AI is active again; `post` returning `false` → `skipped` without a failure; long output is cut at 4 000 characters; tool error → count 1, 2, then paused on the 3rd with exactly one notice and no tool error text in any post; a success resets the counter; a version that adds a host → `needs_approval` with one notice and no run; a version that removes a host or only changes code keeps running; deleted tool → paused; max 2 concurrent runs; `tick` does not overlap.
- Service/routes: 401 without session; owner and group members read (no source in the payload); manager-only pause/resume/delete; member gets 404 on pause; stranger 404 everywhere with an identical body; resume from `needs_approval` → 409; resume after failures resets the counter; limits (10 routines, title length, input size, interval below 60 min rejected, hosts not approved rejected, tool from another chat rejected); removing the AI from a group and deleting a tool soft-delete the routines; audit entries exist and contain **no output, source or error text**.
- Config: `ROUTINES_ENABLED` parses and defaults to false; with it on and no runner the scheduler is not started (unit test of the small builder function, not of `index.ts`).

### Acceptance criteria
- [ ] A routine never runs twice for the same slot, and a stopped AI's routines never post.
- [ ] Nothing can raise the frequency above hourly, and a tool that starts contacting a new host cannot keep running until a human re-approves.
- [ ] No source, tool output or error text in audit entries or logs; failure notices are fixed text.
- [ ] The scheduler is off unless `ROUTINES_ENABLED=true`.
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint re-run after your last edit.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/server test
pnpm build
```

### Out of scope
- Creating routines from chat and the approval card (T-0105), any web UI (T-0106), cron expressions, sub-hourly schedules, catch-up of every missed slot, retries within a run, usage or cost tracking.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-

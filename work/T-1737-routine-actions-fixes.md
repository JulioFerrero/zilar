---
id: T-1737
title: "Routines: the saved-tool form schedules without hosts (taken from the tool), tool.list shows routine ids and pending requests, pause/delete take an id, a second identical approval request reuses the open card, and an approval never creates a duplicate routine"
status: merged
milestone: M5
branch: task/T-1737-routine-actions-fixes
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1737: Routine actions that work

## Spec (written by Claude, do not edit)

### Why
Julio tested a routine on 2026-10-16 in "ai test › General" (screenshots and live data read by the lead):
- Deepseek made **two** identical "Market prices" routines;
- it ran a **prompt** every 5 minutes instead of the saved `market-prices` tool;
- it **couldn't delete** one of them.

The approved behaviour is in `docs/design/mockups/routines/README.md`: one approval card, then one routine that runs the saved tool and edits one message.

### Facts (the lead read them on 2026-10-16, live `agent_task_events` and the code)
1. **Two turns, two requests.**
   - Julio's two messages started two turns, at 16:53:25 and 16:54:15 UTC.
   - Both first called `routine.schedule` with `{"title":"Market prices","schedule":{"kind":"interval","everyMinutes":5},"tool":"market-prices"}`. Both got `denied: invalid arguments; use the Args shown for this action`.
   - Both then retried with the prompt form, so two approval cards were posted (`03e1b497…` and `f2065e01…`).
   - Julio approved both cards, so two `prompt` routines were made.
2. **Why the tool form failed:**
   - `apps/server/src/tools/tool-arg-schemas.ts:99-105` requires `hosts` in the tool form. The AI left it out; the saved tool already has its hosts.
   - The only `argsExample` (`apps/server/src/tools/routine-adapters.ts:93-94`) shows the prompt form.
   - The tool form's `describe` and `execute` read `parsed.hosts` (`routine-adapters.ts:96-117`, `:155-200`), and the fail-safe at `:160-166` compares them with the tool's current hosts.
3. **Why the second turn didn't see the first request:** `tool.list` (`apps/server/src/tools/tool-adapters.ts:35-63`) said "0 routines". A routine still waiting for approval isn't listed. Each routine line is `- ${title}: runs ${toolName}, …`, so a prompt routine reads "runs ," and has no id.
4. **Why delete failed:**
   - `routine.pause` and `routine.delete` take only `{title}` (`apps/server/src/tools/tool-arg-schemas.ts:122-124`; `routine-adapters.ts:210-292`);
   - `findRoutineByTitle` (`apps/server/src/tools/adapter-support.ts:151-169`) answers `ambiguous` when two routines share a title;
   - so the AI got `done: ambiguous routine title` twice (17:12:47, 17:13:39).
5. **Approval cards** are created in `apps/server/src/actions/approval-path.ts:84-120`, inside one transaction with `createApprovalEffect` and the `pending_actions` row. The `summary` comes from `adapter.describe`. Both duplicates had the summary "Market prices · every 5 minutes".

### Steps
1. **The tool form works without `hosts`.**
   - Make `hosts` optional in `routineToolScheduleArgsSchema` (`tool-arg-schemas.ts:99-105`).
   - When it's missing, use the saved tool's current hosts. Read them before the card is built, so the card's details still list them and the fail-safe at `routine-adapters.ts:160-166` still compares equal sets. If `describe` can't read the database, add the hosts in the adapter step that runs before `approval-path.ts` builds the card, and say where in the Report.
   - Add a second example for the tool form to the adapter's description: `{"title":"Prices","schedule":{"kind":"interval","everyMinutes":5},"tool":"market-prices"}`.
   - Add one sentence: "Prefer the saved-tool form when a saved tool does the job."
2. **`tool.list` shows what exists.**
   - Each routine line becomes `- <title> [id <first 8 chars of id>]: runs tool <name>` (or `runs a prompt`), then the schedule and `[status]`.
   - Add one line per pending `routine.schedule` approval of this AI in this topic: `- <summary>: waiting for approval`.
3. **Pause and delete take an id.**
   - `routine.pause` and `routine.delete` accept `{id}` (the full id or the 8-char prefix from `tool.list`) or `{title}`.
   - When a title matches several routines, answer `several routines are called "<title>": ids <a>, <b>; use id`.
   - Update both `argsExample`s.
4. **One card per request.**
   - In `approval-path.ts`, before creating an approval, look for a `pending`, unexpired approval with the same `ai_id`, the same topic (or group), the same `action` and the same `summary`.
   - If there is one, return `{ status: 'pending_approval', approvalId: <that id> }` and post no new card.
5. **No duplicate on approval.** When an approved `routine.schedule` runs and an active, non-deleted routine with the same title already exists for this AI in this topic, create nothing. Answer `a routine called "<title>" already exists here`.
6. **Tests** (permissions area, at most three): the duplicate request reuses the open approval; the tool form without `hosts` schedules with the tool's hosts; delete by id removes only that routine. Put them next to the existing tests of these files.
7. Keep every file under 400 lines. `tool-adapters.ts` has 326 now, so move code out if needed.

### Allowed files
- `apps/server/src/tools/tool-arg-schemas.ts`
- `apps/server/src/tools/routine-adapters.ts`
- `apps/server/src/tools/tool-adapters.ts`
- `apps/server/src/tools/adapter-support.ts`
- `apps/server/src/tools/routine-list-lines.ts`
- `apps/server/src/actions/approval-path.ts`
- `apps/server/src/tools/*.test.ts`
- `apps/server/src/actions/*.test.ts`
- `work/T-1737-routine-actions-fixes.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/tools src/actions --reporter=dot
pnpm gate
```

### Acceptance
- **Scheduling with a saved tool** and no `hosts` posts one card listing the tool's hosts, and on Allow it makes a tool routine.
- **A second identical request** returns the same pending approval, with no second card.
- **`tool.list`** shows routine ids and pending requests. Pause and delete work by id.
- **No duplicate routine** after a second approval.
- **The gate passes.**

---

## Report (written by the worker when done)

### What I did

Every step of the Spec, all inside the Allowed files.

1. **Tool form works without `hosts`.** `hosts` is now `Schema.optional(toolHostsSchema)`
   in `routineToolScheduleArgsSchema` (`tool-arg-schemas.ts`). The adapter gained a
   `prepareArgs` hook (`routine-adapters.ts`) that, when the tool form leaves `hosts`
   out, reads the saved tool's CURRENT hosts (`getTool`) and returns
   `{ ...args, hosts }`. `prepareArgs` is exactly the "adapter step that runs before
   `approval-path.ts` builds the card": `runApprovalPath` calls it before the args hash
   and before `adapter.describe`, so the card still lists the hosts and `execute`'s
   fail-safe compares equal sets. A missing tool throws there (gateway `failed`),
   like `tool.approve_hosts` does. Description rewritten to hold the second (tool-form)
   example and the sentence "Prefer the saved-tool form when a saved tool does the job".
2. **`tool.list` shows what exists.** The line builder now emits
   `- <title> [id <first 8>]: runs tool <name>, <schedule> [<status>]` (or `runs a prompt`)
   and one `- <summary>: waiting for approval` line per pending, unexpired
   `routine.schedule` approval of this AI in this topic. The line builders and the
   pending query moved into the new `apps/server/src/tools/routine-list-lines.ts`;
   `tool-adapters.ts` stays at 326 lines.
3. **Pause and delete take an id.** New `routineTargetArgsSchema` accepts `{id}` (full id
   or 8-char prefix) or `{title}`; the shared resolver `findRoutineTarget`
   (`adapter-support.ts`) picks exact id, then a unique id prefix, then title. Several
   titles match -> `several routines are called "<title>": ids <a>, <b>; use id`. Both
   `argsExample`s are now `{"id":"1a2b3c4d"}`.
4. **One card per request.** `approval-path.ts` now, inside the same transaction before
   inserting, selects a `pending`, unexpired approval with the same `ai_id`, `action`,
   topic/group (`IS NOT DISTINCT FROM`), and (truncated) `summary`. If found it returns
   `{ status: 'pending_approval', approvalId }`, writes no row, audits nothing and
   announces nothing.
5. **No duplicate on approval.** `routine.schedule.execute` first checks
   `activeRoutineWithTitleExists`; when a live, active routine with the same title is in
   scope it creates nothing and returns `a routine called "<title>" already exists here`.
6. **Tests** (three, details under Checks).
7. Every changed file is under 400 lines (largest: `tool-adapters.ts` 326,
   `routine-adapters.ts` 323, `approval-path.ts` 200).

Files changed: `apps/server/src/tools/tool-arg-schemas.ts`,
`apps/server/src/tools/routine-adapters.ts`, `apps/server/src/tools/tool-adapters.ts`,
`apps/server/src/tools/adapter-support.ts`, `apps/server/src/tools/routine-list-lines.ts`
(new), `apps/server/src/actions/approval-path.ts`,
`apps/server/src/tools/routine-schedule-prompt.test.ts` (2 new tests),
`apps/server/src/actions/approval-reuse.test.ts` (new, 1 test), and this task file.

### Checks run

- `pnpm install` (repo root): "Done in 15.1s" (one pre-existing peer-dependency warning
  in `apps/mobile` for `@types/react-dom`).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/tools/routine-schedule-prompt.test.ts`:
  Test Files 1 passed, Tests 7 passed (5 existing + 2 new).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/actions/approval-reuse.test.ts src/actions/args-example.test.ts`:
  Test Files 2 passed, Tests 19 passed.
- `pnpm --filter @zilar/server exec vitest run src/tools src/actions --maxWorkers=2 --reporter=dot`
  (the Spec's Checks command, worker cap added): Test Files 4 passed, Tests 29 passed.
- `pnpm gate` (repo root):
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (1.7s)
  PASS  lint  (1.6s)
  PASS  typecheck  (7.3s)
  PASS  effect  (1.7s)
  PASS  tests @zilar/server  (11.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

The three new tests:
1. `actions/approval-reuse.test.ts`: two identical tier-2 requests through the real
   gateway return the same `approvalId`, leave one `approvals` row and announce one
   `approvalRequested`.
2. `tools/routine-schedule-prompt.test.ts`: the tool form without `hosts` binds
   `["api.example.com"]` in `prepareArgs` and `execute` schedules a routine whose
   `tool_id` and `approved_hosts` are the saved tool's.
3. `tools/routine-schedule-prompt.test.ts`: `routine.delete` by 8-char id prefix
   soft-deletes only that routine; the other live routine keeps `deleted_at NULL`.

### Notes for the lead

- **Where the hosts are bound:** in `routine.schedule`'s `prepareArgs`, run by
  `runApprovalPath` before the hash and `describe` (not in `describe`, which has no DB).
- **Description trade-off:** the 200-char `description` ceiling meant the second example
  plus "Prefer the saved-tool form when a saved tool does the job" only fit by dropping
  the old "Use the exact schedule asked for: daily HH:MM ..." sentence. The prompt form
  is still the adapter's `argsExample`. If you want the schedule-format hint back, one
  of the two must go — say which and I will adjust.
- **Dedupe race:** the lookup reads inside the transaction (as the security checklist
  asks), but there is no unique index or advisory lock, so two truly concurrent
  identical requests could still both insert. The observed case was ~50 s apart, which
  this fixes. Making it fully atomic needs a partial unique index, i.e. a migration,
  which is outside this task's Allowed files.
- **Scope granularity:** `routinesInScope` filters by `topicId` only (pre-existing), so
  the new pause/delete/duplicate checks inherit that scope; I did not change it.
- **Test granularity:** the tool-form test exercises `prepareArgs` + `execute` directly
  rather than the full gateway card, to stay within the three-test budget. The gateway
  wiring (`describe` on prepared args) is unchanged and covered by the existing
  `args-example.test.ts` + the new `approval-reuse.test.ts`.

## Review (written by Claude)

- **Accepted at `1bd81fc80`.** The pre-review is clean (2 nits, 1 follow-up) and the packet is current. The lead ran `routine-schedule-prompt.test.ts` and `approval-reuse.test.ts`: 8 passed.
- **It matches the live failure of 2026-10-16:**
  - `routine.schedule` with only `tool` gets its hosts from the saved tool (`prepareArgs`), so the AI no longer falls back to a prompt routine;
  - a second identical request reuses the pending card;
  - `tool.list` shows ids, "runs a prompt" and pending requests;
  - pause and delete take an id.
- **The dropped description sentence** ("every 1-10080 min…") is accepted: the new tool-form example shows `everyMinutes: 5`, and `tool-guide.ts:25` keeps the time zone rule.
- **Left for later:**
  - the dedupe is check-then-insert, so two truly simultaneous requests can still both insert (a partial unique index would need a migration). The live duplicate came from turns 50 s apart, which this catches;
  - two cosmetic nits: a deleted tool shows "runs tool ,", and an ambiguous id prefix says "no such routine".


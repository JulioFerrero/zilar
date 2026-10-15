---
id: T-1522
title: "Audit (no code): how to build the approved View steps panel — can an AI turn's tool calls be grouped under the task card's steps, with durations, errors and approvals? Write docs/audit/view-steps-plan.md with facts (file:line), the smallest design and a task list"
status: merged
milestone: M5
branch: task/T-1522-view-steps-audit
model: auto
effort: default
depends_on: []
estimate: 40 min
---

# T-1522: View steps audit

## Spec (written by Claude, do not edit)

### Why
On 2026-10-15 Julio approved the "View steps" design. The boards are in `docs/design/mockups/view-steps/` (README, `Main.dc.html` for web, `Phone.dc.html` for the phone); the lead commits them on this branch.
- **In the chat:** a finished task card gets a "View steps" row.
- **The Steps panel** (web side panel, phone bottom sheet):
  - a header with the AI's picture, the task title, the total time and Close;
  - one row per **card step** (status icon, name, `m:ss` duration);
  - an open step lists its **actions**: a mono command, ✓ or ✕, and a duration;
  - a failed action shows its error output;
  - a step the person approved carries a shield-check.
- **Never shown:** model calls, tokens, money, or an "Answered" row.

Before any spec, the lead needs to know what the server records today and what is missing. **This task writes a plan only. No code, no tests.**

### Where to start (the lead checked these exist)
- **The card:** `apps/server/src/agents/task-card.ts`, the pure card state; steps are `step-<index>` (`:33-34`) and appended at `:50-60`.
- **The live card sends:** `apps/server/src/agents/gateway/live.ts`. `finishProgressEffect` logs `card_<state>` (`:165`).
- **The session log:**
  - `apps/server/src/agents/log/` (`append.ts`, `log.test.ts`, `api.ts`);
  - the table is `agent_task_events` (`apps/server/drizzle/0060_agent_task_events.sql`, index in `0063`);
  - tool calls are logged in `apps/server/src/agents/tool-exec.ts:175`.
- **Existing readers:** web `apps/web/src/components/ais/AiActivity.tsx` (`ActivitySection`) and its server route; check for a mobile reader.
- **Approvals:** `apps/server/src/approvals/service.ts`, and how an approval links to a tool call or a turn.

### Questions to answer, each with `file:line`
1. **Step boundaries:** what is logged when a card step starts or changes (label, index, time)? Can every `tool_call`/`tool_result` row be placed under the step that was current when it ran (by order, by time, or by an id)? If not, what is the smallest addition (for example a `step` field on the tool rows)?
2. **One card's events:** how does a client find the events of one task card? The card payload has `taskId` when present (`live.ts`). Is there a task id or turn id on the log rows, and an index that serves "events of one turn"?
3. **Durations:** are start and end times there for each step and each action, so the panel can show `m:ss`?
4. **Failures:** is a failed tool's error output stored? Where, how big, and is it redacted (secrets)? What is safe to show to whom (the AI's owner, or group members)?
5. **Approvals:** can a step or action be tied to the approval that allowed it?
6. **Who may read:** what are today's read permissions on the session log, and who should see a group AI's steps?
7. **What must not show:** which rows are model calls, tokens or cost, so the panel can leave them out.
8. **The client surfaces:** where the web and phone task card render (files and lines), and where a "View steps" row and the panel or sheet would mount. Flag every file at or near 400 lines.

### Output
**`docs/audit/view-steps-plan.md`:**
- **§1 facts:** the answers above, each with `file:line`;
- **§2 the smallest design:** the data shape for one panel, `{ title, totalMs, steps: [{ id, label, state, durationMs, approved, actions: [{ command, ok, durationMs, error? }] }] }`, which route serves it, and the permissions;
- **§3 a task list:** server, then web, then phone. Each task gets its exact files, whether it needs a migration, and its surface;
- **§4 open questions for the lead.**

Keep it short and factual. Never paste secrets or real log content.

### Allowed files
- `docs/audit/view-steps-plan.md` (new)
- `work/T-1522-view-steps-audit.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The plan answers all eight questions with `file:line` references.
- It proposes the smallest design and an ordered task list.
- No code changes.

---

## Report (written by the worker when done)

### What I did

Docs-only audit. Read the task, `AGENTS.md`, the approved boards
(`docs/design/mockups/view-steps/`), the card/log/tool/approval code and the web and
mobile card + panel surfaces. Wrote **`docs/audit/view-steps-plan.md`**:

- **§1 facts**, all eight questions answered with `file:line`: step boundaries and the
  `seq`-order grouping (no step id on tool rows today); how a client finds one card's
  events via the card payload's `task_id` and the existing owner-only
  `GET /api/agents/tasks/:taskId/events`; where durations come from (tool rows carry
  `duration_ms`; step/total come from timestamps + the payload); that failed tool output
  is stored redacted/truncated to 2 KiB per string with 30-day retention; that the
  `approval` kind exists but nothing writes it and no task link exists; that reads are
  owner-only today; which kinds must not show (`model_call`, `answer`, `error`, `card_*`);
  and every web/mobile surface plus files at or near the 400-line cap.
- **§2 smallest design**: the exact `ViewSteps` shape, a sibling
  `GET /api/agents/tasks/:taskId/steps` on the existing `agentTasks` group with the same
  owner-only 404, two no-migration server additions (an `approval` event row from the
  request-action runner, a step marker on tool rows), and `m:ss` on the client.
- **§3 task list**: server, then web, then phone, each with exact files, whether it needs
  a migration (none do), and its surface.
- **§4 open questions**: group visibility, error-body visibility, cap vs log, retention,
  and the command formatter.

**No code changes.**

### Checks run

- `pnpm gate` (from the repo root) → **GATE PASS**:
  - `install (frozen)` PASS, `format` PASS, `lint` PASS, `typecheck` PASS, `effect` SKIP
    (no source files changed);
  - `migration`, `images`, `size` checks ok;
  - `gate: 5 changed file(s) against main` and `scope: 3 file(s) outside the Allowed
    files: docs/design/mockups/view-steps/{Main.dc.html,Phone.dc.html,README.md}`.
    Those three are the lead's approved boards, committed on this branch in
    `0d52106ec "T-1522: approved View steps boards"` (not on `main`); I did not touch
    them. My own changes are only the two Allowed files.
- No single test file was run: the task is docs-only and touches no test, so `pnpm gate`
  was the only test run.

### Notes for the lead

- The route and the reader for a turn's events already exist (T-1426) and are mounted, but
  no client calls them yet (no web/mobile agent-tasks client).
- The two gaps that need a server tweak before the panel is exact: an `approval` event row
  (the `approval` kind is declared but never written) and an explicit step marker on the
  tool rows (order-based grouping works only up to the card's 20-step cap). Neither needs
  a migration — `data` is jsonb and the kind already exists.
- §4 lists the decisions I could not make from the code (group read visibility, error-body
  visibility, cap vs full log, retention gap, command text).

### Round (fix round 1)

Fixed all 4 should-fix findings from `PREREVIEW.md`; 0 must-fix, nits left untouched.

- **Finding 1** (`view-steps-plan.md:99-100`) — corrected the §1.7 fact: `error` rows carry
  `failureLogFields`' `{ kind, status? }` only, never the provider's message
  (`failure-class.ts:61-65`). Commit `f150b6b`.
- **Finding 2** (`view-steps-plan.md:51-53,102`) — §1.3 and §2 now account for the extra
  non-`card_` `{ stage: 'stopped' }` row on the stop path (`turn-stop.ts:25-26`) beside
  `card_stopped`; `stopped` is a close marker, not a step. Commit `799038`.
- **Finding 3** (`view-steps-plan.md:160-161`) — corrected the format fact: the existing
  `formatElapsed` helpers emit `12s` / `2m 14s` / `1h 05m`, not `m:ss`; the panel needs a
  new `m:ss` formatter. Commit `bea29b6`.
- **Finding 4** (`view-steps-plan.md:24-29`) — §1.1 now covers turns with tool rows but no
  status rows (`live.ts:101-103`, `:159-161`) and states the reader rule for orphan rows.
  Commit `a4aabfd`.
- **Nits 5 and 6** — left as-is: neither lies in a line this round changed (per instructions,
  nits are only fixed when in an already-changed line).

Tests: none added or run — this is still a docs-only task (no test file exists for the
audit). Gate: `pnpm gate` → **GATE PASS** (install/lint/typecheck PASS; `effect` SKIP, no
source changed; scope note lists only the lead's 3 mockup files outside Allowed files).

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean after 1 automatic round (4 should-fix items fixed), with 3 nits, for head `1616b9b1d`.
- **The plan answers all eight questions** with `file:line` and proposes a sibling route, `GET /api/agents/tasks/:taskId/steps`, fed by two log additions that need no migration (an `approval` row, and a step marker on tool rows), then web and phone.
- **Lead decisions on §4, for the first version:**
  1. **Visibility:** owner only, as the session log is today, so nothing new is exposed. The "View steps" row shows only on cards from an AI the viewer owns. Group members are a later decision for Julio.
  2. **Error output:** owner only, the same as the step list.
  3. **Steps:** follow the card's 20-step cap; the panel lists the card's steps.
  4. **Retention:** after the 30 days the log rows are gone, so the panel shows the card's steps without actions and with no error.
  5. **Commands:** a short `tool + args` text from the stored, redacted arguments is fine.
- **Carried:** the approved View steps boards in `docs/design/mockups/view-steps/`.

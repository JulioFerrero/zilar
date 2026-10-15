# View steps — audit & plan (T-1522)

Approved design: `docs/design/mockups/view-steps/` (README, `Main.dc.html`, `Phone.dc.html`).
This document records what the server stores today, the smallest design that serves the
panel, and an ordered task list. **No code changes.** Every claim below is a `file:line`.

Model raw events live in `agent_task_events` (one row per turn step).

## §1 Facts

### 1. Step boundaries — what is logged when a step starts or changes

- The card is pure state: a step id is `step-<index>` (`apps/server/src/agents/task-card.ts:33-34`), the
  list is appended at `addTaskCardStep` (`:53-65`), the in-progress step is marked `done` as the next one
  opens (`:61-63`), and the 20-step cap renames the newest step instead of adding a 21st (`:27`, `:57-59`).
- The reporter logs one `status` row per reported stage, label only, no index:
  `log?.append('status', { stage })` (`apps/server/src/agents/gateway/live.ts:109`), immediately before
  the card step is added (`live.ts:110-114`).
- Tool calls are logged as a `tool_call` row then a `tool_result` row per executed call
  (`apps/server/src/agents/tool-exec.ts:168-192`; `tool_call` `:175-179`, `tool_result` `:180-190`).
- One `TurnLog` per turn, one in-memory `seq` counter, one `task_id`
  (`apps/server/src/agents/log/append.ts:125-134`, `:137-142`; opened in
  `apps/server/src/agents/gateway/dm-turn.ts:188` and `apps/server/src/agents/gateway/group-turn.ts:267`).
- **Grouping:** every `status`, `tool_call`, `tool_result`, `model_call` row of one turn shares that
  counter, so a `tool_call`/`tool_result` can be placed under the step whose `status` row precedes it
  **by `seq` order** — the same instance is handed to the reporter and to the tool pipeline
  (`dm-turn.ts:285`, `:361`). There is **no step id on the tool rows**, and the card caps at 20 steps
  while the log does not, so order-based mapping is exact only up to the cap. Smallest addition if
  exactness is needed: put a step index on the tool rows (jsonb `data`, **no migration**).
- **Turn with tool rows but no status rows:** grouping by the preceding `status` leaves tool rows
  orphaned when the reporter logs nothing. `reportProgress` returns before appending when the session
  is not live (`live.ts:101-103`), and `finishProgress` logs no terminal row unless a card was sent
  (`live.ts:159-161`). A reader must handle tool rows with no current step and no closing marker: the
  smallest rule is to drop them (no card, no panel) or gather them under a synthetic leading step — the
  plan must state which, so §2 does not silently invent a step for them.

### 2. One card's events

- The card payload carries `task_id` (`apps/server/src/agents/task-card.ts:147`), taken from the turn log
  (`apps/server/src/agents/gateway/live.ts:90`, `:122`, `:174`).
- A turn is one task id: rows carry `task_id, ai_id, owner_id, chat_jid, seq`
  (`apps/server/src/agents/log/append.ts:35-46`, insert `:102-106`), unique on `(task_id, seq)`
  (`apps/server/drizzle/0060_agent_task_events.sql:13`) with an index on `(task_id, seq)`
  (`:16`; a status-only index in `0063_task_events_status_idx.sql:2`).
- A reader already exists: `GET /api/agents/tasks/:taskId/events`
  (`packages/api-contract/src/agent-tasks.ts:47-59`), mounted in
  `apps/server/src/app/routes-messaging.ts:93`, handler in `apps/server/src/agents/log/api.ts:47-69`,
  query in `apps/server/src/agents/log/read.ts:64-85` (paged by `seq`, oldest first, max 100).
- **A client finds one card's events by the `task_id` of the card message it is already showing.** No
  separate turn id is needed. No client calls the route today (web `apps/web/src/lib/api/` has no
  agent-tasks client; mobile has none).

### 3. Durations

- Every row has `at` (`append.ts:151`); `tool_result` additionally stores `duration_ms`
  (`tool-exec.ts:189`; column `0060:11`; exposed as `durationMs` in `read.ts:18`).
- Step durations are **not stored**; they are derived from consecutive `status` `at` values, with the
  last step closed by the terminal `card_done|card_failed|card_stopped` status row
  (`live.ts:165`). The stop path logs **two** rows: first a non-`card_` `{ stage: 'stopped' }`
  (`turn-stop.ts:25-26`), then the `card_stopped` marker, so a reader must treat `stopped` as a close
  marker too and not render it as a step. The whole-turn `elapsed_ms` and `started_at` are on the card payload only
  (`live.ts:166-177`, `task-card.ts:18-19`, `:155-157`), never in the log.
- So the panel's `durationMs` per action comes straight from `tool_result.duration_ms`; per step and the
  total come from the timestamps plus the payload's `elapsed_ms`.

### 4. Failures

- A failed tool's output **is** stored: `tool_result.data` holds `output` (redacted + truncated),
  `output_bytes`, `ok` and, when a process ran, `exit_code` (`tool-exec.ts:180-190`).
- Redaction: `redactAndTruncate` runs every string through `redactSecrets(secrets)` then truncates to
  `TASK_EVENT_TEXT_MAX_BYTES = 2048` bytes (`append.ts:70-77`, `:33`), and the whole `data` object is
  recursively sanitised (`:79-94`, `:153`). Only secrets the server knows for that AI are redacted
  (`secretsFor()`, e.g. `dm-turn.ts:188`), so unknown secrets are not guaranteed out. Rows are deleted
  after 30 days (`apps/server/src/agents/log/retention.ts:11`).
- **Read permissions today:** owner only, and an unknown task answers the same 404 as one the caller may
  not see (`api.ts:54-57`; `read.ts:40-50`).
- Safe to show: the step list, durations and the ✓/✕ status. The error **body** can contain file paths,
  hostnames and code, so by default show it to the AI's owner only (see §4).

### 5. Approvals

- The `approval` event kind exists (`append.ts:25`, mirrored in `agent-tasks.ts:16`) but **nothing appends
  it** (`grep` finds no `append('approval'`).
- A pending request does carry the id: `RequestOutcome.pending_approval` has `approvalId`
  (`apps/server/src/actions/gateway.ts:23`). But the request-action runner never receives the `TurnLog`
  (`apps/server/src/agents/gateway/tool-exec.ts:60-63`; `request-action.ts:27-30`), so the id cannot be
  written to the session log.
- `pending_actions` links `approval_id` to the action (unique, `apps/server/drizzle/0014_thick_runaways.sql:15`;
  read at `apps/server/src/actions/queries.ts:193-196`) but has **no task/turn column**, and `approvals`
  has none either (`apps/server/drizzle/0011_silky_groot.sql:1-18`).
- **Today a step or action cannot be tied to its approval.** Smallest addition: pass the `TurnLog` into
  the request-action runner and append one `approval` row `{ approval_id, action }` when it is
  `pending_approval`; the later decision is then joined from `approvals` by id (**no migration**).

### 6. Who may read

- The session-log route is owner-only and 404s uniformly (`api.ts:54-57`).
- The nearest read UX is the AI/group Activity panel: mounted for an AI the viewer owns, and for group
  owners/admins only (`apps/web/src/components/ais/AiActivity.tsx:46-51`).
- **Today only the AI's owner can read a turn's steps.** For a group AI the card is posted into the room,
  so whether members should read is a decision, not a fact (§4).

### 7. What must not show

- `model_call` rows carry provider, model, tokens and `cost_usd` (`apps/server/src/agents/tool-loop.ts:130-147`).
- `answer` rows mark the reply (`apps/server/src/agents/turn-send.ts:29`, `:53`) — the "Answered" row.
- `error` rows carry only the failure class and, when the provider answered with one, the HTTP status
  — never the provider's message (`failureLogFields` returns `{ kind, status? }`,
  `apps/server/src/agents/failure-class.ts:61-65`, used at `dm-turn.ts:151` etc.).
- `status` rows whose stage is `card_<state>` are internal close markers (`live.ts:165`).
- The panel reads only `status` rows whose stage is neither `card_*` nor `stopped`, plus `tool_call`,
  `tool_result` and `approval` rows, and never shows `model_call`, `answer` or `error`. The `stopped`
  stage is the stop path's other close marker (`turn-stop.ts:26`), not a step: a stopped turn with no
  card would otherwise assemble a one-step panel from it.

### 8. Client surfaces

- **Web card:** `apps/web/src/components/message/AttachmentBody.tsx:245-255` (progress at `:247`);
  component `apps/web/src/components/ProgressCard.tsx:111-234` (234 lines).
- **Web panel host:** `apps/web/src/routes/ChatView.tsx:29` (`OpenPanel`), `:61-67` (state), `:304-348`
  (each panel mounts here). A "View steps" row would open a new `'steps'` entry through the same store
  pattern used for pins (`storeApi.getState().setPinsPanel`, `:346`). Shell: `apps/web/src/routes/ChatShell.tsx:20-79`.
- **Mobile card:** `apps/mobile/src/components/chat/message-bubble-content.tsx:184` →
  `apps/mobile/src/components/chat/payload-card.tsx:23-28` → `progress-card.tsx:92-213`.
- **Mobile sheet:** reusable `apps/mobile/src/components/ui/bottom-sheet.tsx` (170); a `steps-sheet` would
  mount beside the thread (`apps/mobile/src/app/chat/[id].tsx` 262, `chat-thread.tsx` 186).
- **At or near the 400-line cap — do not grow:** `ChatView.tsx` 355, `ChatHeader.tsx` 373,
  `GroupPanel.tsx` 359, `ContactPanel.tsx` 305; mobile `media-bubble.tsx` 380,
  `invite-links-sheet.tsx` 378, `message-list.tsx` 367, `voice-recorder.tsx` 362, `sticker-panel.tsx` 361,
  `message-bubble.tsx` 355, `topic-info-sheet.tsx` 349.

## §2 The smallest design

One assembled payload per card; the panel renders it directly.

```
ViewSteps = {
  title: string,            // card.title (fixed stage text)      task-card.ts:13
  totalMs: number,          // card.elapsed_ms                    task-card.ts:157
  steps: [{
    id: string,             // card step id `step-<n>`            task-card.ts:33-34
    label: string,          // card step label                    task-card.ts:16
    state: 'planned'|'doing'|'done'|'failed',   //             packages/protocol/src/progress.ts:9
    durationMs: number,     // next status `at` − this `at`
    approved: boolean,      // an approved `approval` row for this step
    actions: [{
      command: string,      // tool + short args                  tool-exec.ts:176
      ok: boolean,          // tool_result.data.ok                tool-exec.ts:186
      durationMs: number,   // tool_result.duration_ms            tool-exec.ts:189
      error?: string,       // tool_result.data.output when !ok   tool-exec.ts:184
    }],
  }],
}
```

- **Route:** add a sibling `GET /api/agents/tasks/:taskId/steps` on the existing `agentTasks` group
  (`packages/api-contract/src/agent-tasks.ts:47-59`), same `Session` middleware and the same owner-only
  404 as the `events` route (`log/api.ts:52-57`). It reads the events (reuse `read.ts:64-85`), walks them
  in `seq` order to group actions under the step whose `status` row precedes them, joins `approval` rows
  to `approvals` for `approved`, and drops `model_call`/`answer`/`error`/`card_*`. The existing raw
  `events` route stays unchanged for other readers.
  - Smallest alternative, if no new route is wanted: reuse `events` and assemble on the client from the
    card message plus the log. It works up to the 20-step cap and cannot resolve `approved` without an
    `approval` reader, so the sibling route is preferred.
- **Two small server additions feed it (no migration):**
  1. an `approval` event row with `{ approval_id, action }` from the request-action runner
     (`request-action.ts:27-30`, `gateway/tool-exec.ts:60-63`); and
  2. a step marker on the tool rows (index/id in `data`) so grouping is exact beyond 20 steps.
- **Permissions:** unchanged owner-only. The card's title/steps/elapsed/`ai`/`task_id` already travel on
  the message (`task-card.ts:136-159`), and the AI's picture is client-side by `ai` JID.
- **Time format:** `m:ss` (`2:14`) is what the mockups require, but it is **not** what the existing
  helpers emit: `formatElapsed` returns `12s` / `2m 14s` / `1h 05m`
  (`apps/web/src/components/ProgressCard.tsx:13-24`, `apps/mobile/src/components/chat/progress-card.tsx:16-27`).
  The panel needs a new `m:ss` formatter (or an explicit change to these helpers); reusing them as-is
  gives the wrong format.

## §3 Task list

**Server (no migration for any of these; `data` is jsonb and `approval` already exists)**
1. Append `approval` rows: thread the `TurnLog` into `createRequestActionRunner` and append
   `{ approval_id, action }` on `pending_approval`.
   Files: `apps/server/src/agents/gateway/tool-exec.ts:60-63`, `apps/server/src/agents/gateway/request-action.ts`.
2. Add a step marker to `status` and `tool_call`/`tool_result` rows so grouping survives the 20-step cap.
   Files: `apps/server/src/agents/gateway/live.ts:109-114`, `apps/server/src/agents/tool-exec.ts:168-192`.
3. New reader `GET /api/agents/tasks/:taskId/steps` assembling §2 and joining `approvals`.
   Files: `packages/api-contract/src/agent-tasks.ts`, `apps/server/src/agents/log/api.ts`,
   `apps/server/src/agents/log/read.ts` (or a new `steps.ts`). Cover the 401 sweep.
4. Decide and, if needed, widen read: group members vs owner only — see §4.

**Web**
5. A "View steps" row on the finished card + the panel; new `StepsPanel` component and a client for the
   new route.
   Files: `apps/web/src/components/message/AttachmentBody.tsx:245-255`,
   `apps/web/src/components/ProgressCard.tsx`, new `apps/web/src/components/StepsPanel.tsx`,
   `apps/web/src/routes/ChatView.tsx:29,61-67,304-348`, new `apps/web/src/lib/api/agent-tasks.ts`.
   The row shows only when the card has a `task_id` and a terminal `state`.
6. Side panel layout per `docs/design/mockups/view-steps/Main.dc.html` (right aside, 380 px, header with
   AI picture + title + total + Close; `IconButton` 36 px / 10 px radius).

**Phone**
7. A "View steps" row on the card and a `steps-sheet` bottom sheet.
   Files: `apps/mobile/src/components/chat/progress-card.tsx`, `payload-card.tsx:23-28`,
   new `apps/mobile/src/components/chat/steps-sheet.tsx` using
   `apps/mobile/src/components/ui/bottom-sheet.tsx`, mounted from
   `apps/mobile/src/app/chat/[id].tsx` / `chat-thread.tsx:186`; add the API call to the ais client.
   `IconButton` 40 px / 12 radius.

## §4 Open questions for the lead

1. **Group visibility.** For a group AI the card is posted to the room but the log is owner-only
   (`api.ts:54-57`). Should group members (or only group owners/admins, as the Activity panel does,
   `AiActivity.tsx:46-51`) see the steps?
2. **Error output.** The stored `output` is redacted against known secrets only (`append.ts:71-77`) and
   can hold paths, hostnames and code. Owner-only, or visible to the same people as the step list?
3. **Cap vs log.** Follow the card's 20-step cap, or show every logged status row (the log has no cap)?
4. **Retention.** Rows live 30 days (`retention.ts:11`); a card older than that would show no actions.
   Is an empty-but-present panel acceptable, or should the row hide?
5. **Command text.** The mockup's mono `command` is the tool's arguments; only the redacted/truncated
   args are stored (`tool-exec.ts:176-179`). Confirm a short `tool + args` formatter is acceptable.

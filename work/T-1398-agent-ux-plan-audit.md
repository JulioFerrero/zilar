---
id: T-1398
title: "Audit (no code): plan the quiet background agent UX (status line, one task card edited in place with a live checklist and Stop, final answer as the only notifying message, View steps from a session log) on server, web and mobile"
status: merged
milestone: M5
branch: task/T-1398-agent-ux-plan-audit
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1398: Quiet background agent UX (audit)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: the agent work "needs to happen in the background and dont spam in the chat". The target UX is in `docs/design/agent-system.md` §4 (read it, plus §2.2 "Session log"). This audit maps what exists so the coding tasks are exact. It is phase P1 of the build plan (§6).

Facts the lead checked (2026-10-14):
- **A progress payload exists:** `packages/protocol/src/progress.ts:4` (`ProgressSchema`: `ai`, `task_id?`, `stage` up to 100 chars, `detail?`, `percent?`); it is in the payload union at `packages/protocol/src/payload.ts:28`.
- **The server sends one progress message per turn and edits it:** `apps/server/src/agents/gateway/live.ts:70-140`.
  - `reportProgress` sends the first stage as a message, then `sendCorrection` for later stages.
  - `clearProgress` **retracts** it when the answer arrives.
  - It's called from `apps/server/src/agents/tool-exec.ts:240` with each tool's stage.
- **The renderers:** `apps/web/src/components/ProgressCard.tsx` (40 lines) and `apps/mobile/src/components/chat/progress-card.tsx` (28 lines), plus `apps/mobile/src/components/chat/payload-card.tsx`.
- **Approvals exist:** `packages/protocol/src/approval.ts:6` (`ApprovalRequestSchema`), and `approval.decision` in `payload.ts`.
- **Context building** already drops progress messages (`apps/server/src/agents/context-edits.ts:75`).

### What to build
One document, `docs/audit/agent-ux-plan.md`, covering:
1. **Today, end to end, with `file:line`:**
   - what a user sees today while an AI works;
   - whether the progress message and its corrections and retraction **notify**: push (`apps/server/src/push/` and ejabberd `mod_push`), unread counts, the chat-list preview and the "last message" line, on web and mobile;
   - whether XMPP chat states (typing) are sent for AIs;
   - what a retraction looks like on each client.
2. **The design for §4 of the design doc:**
   - **The status line** under the AI's name (like typing) with a short text. Decide: XEP-0085 chat state plus a custom status element, or a non-stored message. It must leave no trace in history.
   - **The task card:** one `progress`-style message per task, edited in place, with the title, a checklist (planned → doing → done), elapsed time, a **Stop** button, collapsed by default, and a final summary line. The protocol change to `ProgressSchema` must stay backward compatible.
   - **Never notify on card edits:** what to change in push, unread and preview so that only the final answer and approval requests notify.
   - **Stop:** how a Stop tap reaches the running turn (an XMPP payload or an HTTP route) and cancels it. The tool loop's cancellation points must be cited.
   - **"View steps":** a session log table (events per task: model call, tool call, tool result with redacted output, approval, status). Give the schema, the retention, the HTTP route to read it, and the screen on web and mobile.
   - **Approvals:** batching several requests of one task into one card; the timeout.
   - **Groups:** AI posts only when mentioned or assigned (cite where this is decided today).
3. **The task split:** ordered tasks of at most about 600 changed lines; files at most 400 lines.
   - Web and mobile twins go in the same batch (parity rule).
   - For each task: its files with `file:line`, what gets deleted, and how the lead checks it (web `?mock=1`, the mobile emulator mock build, and live).
   - Tests only for the message pipeline parts (no UI tests).
4. **Risks and open questions.**

Change no code.

### Read first
`AGENTS.md`, `docs/design/agent-system.md`, the files above, `apps/server/src/agents/tool-loop.ts`, `apps/server/src/agents/tool-exec.ts`, `packages/xmpp-core/src/stanza/build-outgoing.ts`.

### Allowed files
`docs/audit/agent-ux-plan.md`, `work/T-1398-agent-ux-plan-audit.md`.

### Checks
```bash
pnpm exec prettier --check docs/audit/agent-ux-plan.md
```

### Acceptance
- `docs/audit/agent-ux-plan.md` exists, cites `file:line` for every claim, and gives the task split.
- No code changes.

---

## Report (written by the worker when done)

### What I did

Wrote `docs/audit/agent-ux-plan.md` (about 430 lines): the audit of today's AI-work UX,
the design for `docs/design/agent-system.md` §4 and §2.2, the ordered task split and
the risks/questions. No code changed.

Read first, completely: `AGENTS.md`, `docs/design/agent-system.md`, and (fully or in the
ranges needed) `apps/server/src/agents/gateway/live.ts`,
`apps/server/src/agents/tool-exec.ts`, `apps/server/src/agents/tool-loop.ts`,
`packages/xmpp-core/src/stanza/build-outgoing.ts`, `packages/protocol/src/progress.ts`,
`packages/protocol/src/payload.ts`, `packages/protocol/src/approval.ts`,
`apps/server/src/agents/context-edits.ts`, `apps/server/src/agents/tool-guide.ts`,
`apps/server/src/agents/dm-turn.ts`, `apps/server/src/agents/dm-tool-turn.ts`,
`apps/server/src/agents/gateway/dm-turn.ts`,
`apps/server/src/agents/gateway/group-ingest.ts`,
`apps/server/src/push/candidates.ts`, `archive-scan.ts`, `delivery.ts`, `payload.ts`,
`group-notifier.ts`, `infra/ejabberd/ejabberd.yml`,
`apps/server/src/chats/unread.ts`, `apps/server/src/ais/status.ts`,
`apps/server/src/ais/api.ts`, `packages/api-contract/src/ais.ts`,
`packages/api-contract/src/approvals.ts`, `apps/server/src/approvals/sweeper.ts`,
`apps/server/src/approvals/schemas.ts`, `apps/server/src/actions/announce.ts`,
`apps/server/src/actions/production-announcer.ts`, `apps/server/src/drafts/api.ts`,
`packages/client-core/src/store/ledger-edits.ts`, `ledger-incoming.ts`,
`apps/web/src/components/ProgressCard.tsx`, `MessageBubble.tsx`,
`message/AttachmentBody.tsx`, `apps/mobile/src/components/chat/progress-card.tsx`,
`payload-card.tsx`, `message-bubble.tsx`, `packages/chat-core/src/types.ts`,
`packages/xmpp-core/src/namespaces.ts`, `types.ts`, `stanza/decode.ts`,
`apps/server/src/media/extract.ts`, `apps/server/src/agents/memory/indexer.ts`.

Key findings (all cited `file:line` in the doc):

1. A progress message is a **stored** message with the stage as its body
   (`gateway/live.ts:88-96`), so push resolves it as a normal message: it notifies and
   bumps unread. Corrections archive too, so a 6-round turn buzzes 6 times. The
   resolver has no progress skip (`push/candidates.ts:28-43`) and neither does
   `summarizeUnread` (`chats/unread.ts:240-288`).
2. `clearProgress` sends a retraction (`live.ts:118-134`) whose body is the stock
   fallback (`build-outgoing.ts:161-180`), so the chat-list preview becomes "This person
   attempted to retract a previous message…" (`chats/unread.ts:60-79`) and both clients
   show a "Message deleted" tombstone (`MessageBubble.tsx:174-185`,
   `message-bubble.tsx:168`).
3. The AI **already** sends silent XEP-0085 chat states
   (`dm-turn.ts:124,144`, `group-turn.ts:195,243`, `live.ts:143-153`) that leave no MAM
   trace — the cheapest carrier for the §4.1 status line.
4. The clients already have an `AiStatus = 'idle' | 'working'` hook
   (`packages/chat-core/src/types.ts:23,212`, both headers, `chat-labels.ts:27`) that
   **nothing ever writes** — dead code today.
5. No session log table or route exists, so "View steps" is all new; the approval
   subsystem does exist (routes, sweeper, ≤24 h expiry) and only needs task batching.
6. Stop is a whole-AI kill switch today (`POST /api/ais/:id/stop`,
   `ais/status.ts:17-60`, `gateway/lifecycle.ts:161-168`); the in-flight turn is not
   cancelled, only its sends are dropped (`gateway/live.ts:24-49`). The plan adds a
   per-turn route plus a per-session `AbortController`, and cites every existing
   cancellation point.
7. Groups already reply only on a mention or a reply (`group-ingest.ts:139-155`); the
   "or assigned" of §4.7 does not exist yet and is flagged.

Also listed where live cards leak outside the chat: AI memory
(`memory/indexer.ts:105-115`), media extract (`media/extract.ts:117-157`) and archive
search (no `urn:zilar:agent:0` reference under `apps/server/src/search/`).

### Files changed

- `docs/audit/agent-ux-plan.md` (new)
- `work/T-1398-agent-ux-plan-audit.md` (Report + `status`)

### Commands run (real results)

- `pnpm install` → `Done in 18.7s using pnpm v10.32.1`
- `pnpm exec prettier --check docs/audit/agent-ux-plan.md` →
  `All matched files use Prettier code style!`, `exit=0`
- `pnpm gate` (repo root, re-run after the final Report edits) → summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (0.9s)
  PASS  lint  (0.7s)
  PASS  typecheck  (0.7s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  No file outside the Allowed files; `GATE PASS`. No single test file was run: no code
  changed, so there is nothing to test (the gate skipped the test step accordingly).

### Problems / deviations

- None blocking. Deviations from the Spec's file list are only additions of files read
  to keep every claim verifiable.
- The Spec quotes `live.ts:70-140` for the progress reporter; the actual body is
  `live.ts:68-141` (cited exactly in the doc). `tool-exec.ts:240` and
  `context-edits.ts:75` and `progress.ts:4` / `payload.ts:28` / `approval.ts:6` match.
- Two claims in the doc are code readings, not runs, and are labelled as such: the
  retraction fallback sentence reaching the **chat-list preview** via `labelForRow`
  (I did not observe it live), and the MAM push being triggered per archived message
  (read from `infra/ejabberd/ejabberd.yml:212-229` plus `push/archive-scan.ts`). The
  lead's live check should confirm both.
- I did not touch `docs/BOARD.md`, `AGENTS.md` or `docs/PROJECT_PLAN.md`.

### Notes for the lead

- `docs/` is in `.prettierignore`, but the Spec's explicit-path check still runs and
  passes (recorded above).
- Six open questions are in §4 of the doc. The one that blocks the session-log task is
  #1: §4.5 wants "commands, outputs, files changed", while the `AGENTS.md` security
  checklist says audit entries carry ids only, never output. Task F as written stores
  ids, counts and metadata only; please confirm before it is implemented (my guess is
  ids/metadata only, 30-day retention).
- Task A (never notify on live AI UI) is first on purpose: it fixes today's
  spam/badge/preview problem with no dependency on the rest.

## Review (written by Claude)
Lead, 2026-10-14: approved. Pre-review CLEAN (nit 2: Task D's Stop calls the Task E route, not F). Lead answers to §4: (1) View steps stores redacted, truncated (2 KiB) tool output, owner-only, 30-day retention, which is what the design doc promises; (2) 30 days; (3) web right panel, mobile bottom sheet; (4) groups: mention only for now, no 'assigned'; (5) Stop ends the task (state stopped; the next message starts a new card); (6) yes to the 30-minute stale-card rule.

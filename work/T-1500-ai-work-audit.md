---
id: T-1500
title: "Audit and plan for 'AI work in topics' (approved canvas): map how AI turns, task cards, handoffs, approvals and topic status flow today, list every use of topic kind/status/owner/link, and write the step plan in docs/audit/ai-work-plan.md"
status: merged
milestone: M5
branch: task/T-1500-ai-work-audit
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1500: Audit and plan for AI work in topics

## Spec (written by Claude, do not edit)

### Why
Julio asked on 2026-10-15 for a full rework of topic status, "not just ui but also functionality", because several AIs can work in one chat. He then approved the design in `docs/design/mockups/ai-work/` (README plus four boards). Read that README first: it states the new model.

In short, nobody picks a status by hand any more. A topic shows, per AI, **working** (a turn is running), **waiting for you** (a pending approval or an open question), **done**, or nothing. The topic kind, the five statuses, the single owner AI and the task strip go away.

Before any code changes, the lead needs a map of today's code and a step plan. **This task writes one document and changes no code.**

### Facts (the lead read them on main, 2026-10-15)
- **Topic fields:** `packages/api-contract/src/topics.ts:31-33` defines `TOPIC_KINDS` (chat, task, bug, ui, routine) and `TOPIC_STATUSES` (open, in_progress, in_review, blocked, done); the topic also has an https `linkUrl` (`:44-53`).
- **The task card:** `apps/server/src/agents/task-card.ts` is "one progress message per turn, edited in place" (T-1414), with states working, done, failed and stopped (`:9`). The reporter that sends it is in `apps/server/src/agents/gateway/live.ts` (`createLiveSession`, `:30`).
- **The progress card schema:** `packages/protocol/src/progress.ts:6-35` has steps (planned, doing, done, failed), `elapsed_ms`, `state` and `can_stop`.
- **Handoffs:** `apps/server/src/agents/handoff.ts` finds `@<nick>` handoffs in group replies (T-0481), and `apps/server/src/agents/group-turn.ts` uses it. There is also a delegation service, `apps/server/src/agents/delegation/service.ts` (304 lines).
- **Stop:** the Stop pause is saved in `topics.follow_paused_at` (T-1493, `apps/server/src/agents/gateway/topic-follow.ts`).
- **Approvals:** `apps/server/src/approvals/` (`queries.ts`, `api.ts`).
- **The task log:** `agent_task_events` (`apps/server/drizzle/0060_agent_task_events.sql`, read in `apps/server/src/agents/log/`).
- **The topic list payload** is built in `apps/server/src/topics/views.ts`.
- **Live updates:** server-to-client notices already exist as bodiless headline stanzas (`apps/server/src/chats/delivered-notice.ts:5-17`, `:48-57`).
- **The task strip UI:**
  - web: `apps/web/src/components/topic/StatusMenu.tsx`, `apps/web/src/components/topic/OwnerMenu.tsx`;
  - mobile: `apps/mobile/src/components/chat/task-strip.tsx`, `apps/mobile/src/lib/topics.ts`.

### What to write: `docs/audit/ai-work-plan.md`
Every claim needs `file:line`. Write "not found" when something does not exist; never guess.

1. **Turns:** where a turn starts and ends per (room, AI), and where the task card changes state (working → done, failed or stopped). Is there an in-memory record of running turns per room? Name it.
2. **"Waiting for you":** how the server knows that an AI in a room has a pending approval. Does any "question to people" exist today (reply chips, elicitation)? If not, say "not found".
3. **Handoffs and delegation:** what `handoff.ts`, `group-turn.ts` and `delegation/service.ts` do, and how a handoff shows in the chat today.
4. **Live updates:** how a client learns today that something about a topic changed (status, owner, a new task card) without reloading: XMPP messages, headline notices, or polling. List the paths on web and mobile.
5. **Inventory of what goes away:** every use of topic `kind`, `status`, the owner AI (`owner_ai_id`) and `linkUrl` across the server, contract, mock, web and mobile, with `file:line`. Mark which code the owner AI's following (`topic-follow.ts`) depends on.
6. **Proposal:** the smallest design for:
   - (a) a per-topic AI activity read model (states working, waiting, done, idle per AI), computed on the server from turns and pending approvals;
   - (b) how the topic list carries it for the sidebar;
   - (c) how web and mobile get live changes (reuse the headline notices if they fit);
   - (d) how "done" is set (the AI's final task card, plus a person marking the topic done);
   - (e) what happens to the owner AI's following once the owner goes away (for example, any @mentioned AI follows the topic until it is done or stopped);
   - (f) a migration plan that drops the old columns only after the clients stop reading them.
7. **Step plan:** at most 8 tasks in order. For each: title, the exact files (full repo paths), whether it needs a migration, and whether it is server, web or mobile. Keep the 400-line limit in mind; name any file that would pass 400 lines.

### Allowed files
- `docs/audit/ai-work-plan.md`
- `work/T-1500-ai-work-audit.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The document answers items 1 to 7 with `file:line` evidence, and "not found" where something does not exist.
- No code changes.

---

## Report (written by the worker when done)

### What I did

Wrote one document, `docs/audit/ai-work-plan.md`, and changed no code. I read
`docs/design/mockups/ai-work/README.md` first, then mapped the code it names plus
every caller I found.

The document answers spec items 1 to 7:

1. Turns per (room, AI): entry `apps/server/src/agents/gateway/group-ingest.ts`
   `handleRoomIncoming` / `queueRoomTurn` / `pumpRoomEffect`, body
   `gateway/group-turn.ts` -> `gateway/group-turn-body.ts` -> `agents/group-turn.ts`,
   card open/step/close in `gateway/live.ts` + `agents/task-card.ts`, terminal
   states `done`/`failed`/`stopped` and their call sites. In-memory running-turn
   records named: `AiSession.roomBusy` (Set, per AI), `AiSession.turnAborts`
   (Map, per AI, keyed by room JID), gateway `roomRounds` (per room, budget only)
   and `sessions` (per AI). No per-room index across AIs exists.
2. "Waiting for you": a pending approval is an `approvals` row with
   `ai_id`/`group_id`/`topic_id`/`status='pending'`; reads are per user, not per
   room, so the per-topic read is **not found**. A question to people (reply
   chips / elicitation) is **not found** anywhere in code.
3. Handoffs: `agents/handoff.ts` `findHandoffIndex`, used by `agents/group-turn.ts`
   `wire()`, triggered back in `gateway/group-ingest.ts`; `delegation/service.ts`
   is the durable core. A handoff shows only as an `@nick` mention in the reply;
   the `handoff` protocol payload exists but the server never sends it and no
   client renders it (**not found** in use).
4. Live updates: task card over XMPP (`progress` + corrections); topic
   status/owner only via the 60 s `/api/chats` poll (shared `client-core`
   polling) and focus; roster/invited/removed XMPP events debounce into a refresh;
   the only XMPP headline stanza is the delivered-mark notice. All paths listed
   with `file:line` for web and mobile.
5. Full inventory of `kind`, `status`, owner AI (`owner_ai_id`/`TopicOwner`) and
   topic `linkUrl`/`linkLabel` across server, contract, mock, web and mobile with
   `file:line`, split by area. The code `topic-follow.ts` depends on is marked
   (`owner_ai_id`, `follow_paused_at`, `room_localpart`, `archived_at`, plus its
   callers). Media `linkUrl` is called out as unrelated.
6. Proposal (a)-(f): computed per-topic activity read model (waiting from
   `approvals`, working from a gateway accessor, done from `agent_task_events`
   plus a person flag), the list field on the topic view, live changes as a
   sibling of the delivered headline notice, how "done" is set, re-keying owner
   following on `(topic, ai)`, and an expand/contract migration order that drops
   the old columns only in a later release.
7. Step plan: 8 ordered tasks with title, exact files, migration yes/no and
   surface; files at/near the 400-line bar flagged (`chats/api.ts` 391,
   `topics/service.ts` 392, `gateway/group-turn-body.ts` 395, `topics/access.ts`
   382, `topics/views.ts` 346).

Files changed by me (both in Allowed files):
- `docs/audit/ai-work-plan.md` (new)
- `work/T-1500-ai-work-audit.md` (this Report + status)

Open questions are at the end of the document (done scope per AI vs per topic;
working source in-memory vs mirrored; whether the topic link is dropped).

### Checks run

- `pnpm install` — Done in 11.8s, 1137 packages added (`@types/react-dom` peer
  warning pre-existing, unrelated).
- `pnpm gate` — **GATE PASS**. Summary lines:
  - `PASS  install (frozen)  (1.0s)`
  - `PASS  format  (1.1s)`
  - `PASS  lint  (1.2s)`
  - `PASS  typecheck  (1.3s)`
  - `SKIP effect (no source files changed)`
  - `scope: 5 file(s) outside the Allowed files:` the five
    `docs/design/mockups/ai-work/*` files, `GATE PASS`.
- I ran no package tests: the change is one Markdown document, no source files.

### Notes for the lead

- The gate's 5 out-of-scope files are **not mine**. They are the approved design
  boards committed on this branch before I started:
  `git log main..HEAD` shows `610b7070e T-1500: approved AI work boards`
  (the five `docs/design/mockups/ai-work/` files) and `c6a80691c T-1500: spec`.
  My one commit (`30849136f`) touches only the Allowed files. The spec itself
  points at those boards, so I left them untouched.
- The document is evidence-only: every claim has `file:line`, and every place the
  design names something that does not exist yet is written as "not found".
- I did not run `pnpm gate` more than once, and I ran no other gate commands
  separately, per AGENTS.md.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean, with 1 nit, for head `e7471a082`. The nit is the AI work boards on the branch; the lead committed them on purpose, so they go to main with the plan.
- **What the lead checked against the code:**
  - `AiSession.roomBusy` / `turnAborts` are the only running-turn records, per AI;
  - pending approvals already carry `topic_id`;
  - no question-to-people or `handoff` card is in use;
  - topic changes reach clients only by the 60 s poll;
  - the inventory of `kind`, `status`, `owner_ai_id` and `linkUrl`, and what `topic-follow.ts` depends on.
- **Lead decisions on §8:**
  1. **"Done":** an AI's check comes from its last task card (per AI). A person marking the topic done is one topic-level `topics.done_at`, which shows every AI there as done until a new turn starts.
  2. **"Working":** the in-memory gateway accessor is fine. The server is one process.
  3. **Topic link:** kept for now; the plan's T8 does not drop `link_url`/`link_label`. Julio decides where the link lives once the strip is gone.
- **Order:** the plan's T1 → T2 → T3/T4 (one migration at a time) → T5 → T6 web → T7 mobile → T8.

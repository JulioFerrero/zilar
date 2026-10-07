---
id: T-0468
title: "Audit + plan: the listener (who answers without @mention) and delegation (boss AI hands tasks to worker AIs), on today's code"
status: merged
milestone: M5
branch: task/T-0468-listener-delegation-plan
model: auto
effort: low
depends_on: []
estimate: 0.4 day
---

# T-0468: listener and delegation plan

## Spec (written by Claude, do not edit)

### Why
Julio (2026-10-07) picked **listener + delegation** as the next feature from the project plan. Today an AI in a group replies only when a person @mentions it, and AI-to-AI turns never happen.

This task writes the plan that turns plan §9.3-9.5 into ordered tasks on today's code. **Docs only: no code, config or schema changes.**

### Verified facts (do not re-derive)
- **The plan:**
  - `docs/PROJECT_PLAN.md:656-694` is §9.3, the listener: one cheap call scores every AI in the room, waits for pauses, can only tag and suggest, with adjustable eagerness and a cost table;
  - `:687-701` is §9.4, who speaks and the limits: at most 4 AI messages and 2 AI-to-AI hops per human message, a new human message resets, stuck detection, and the gateway enforces by not waking;
  - `:699-735` is §9.5, delegation: a `delegate(ai, task)` tool, the worker runs with its own model, key and budget, progress goes to a thread, plus the handoff JSON.
  
  **There are no desks yet** (`docs/FEATURES.md:96`, plan §11), so delegation cannot start "a session on the worker's desk". The plan must adapt that.
- **The gateway (`apps/server/src/agents/gateway.ts`):**
  - room turns are gated by mention at lines 1466-1500 ("M2 rule 1", "No mention, nobody replies (M2 rule 3)");
  - no AI-to-AI turns (line 1500: any `ai-*` real JID never wakes the AI);
  - turns are coalesced (around line 1524);
  - only a current human member's mention triggers a reply (around line 1583);
  - the room reply tool loop is around lines 1766-1770;
  - no AI-to-AI loops (lines 1868-1880);
  - the per-round gate is at line 914 (T-0106).
- **Related modules:**
  - `apps/server/src/agents/reply.ts` (tool loop, notices);
  - `apps/server/src/agents/tools.ts` (tool definitions);
  - `apps/server/src/agents/context.ts` (the context window);
  - `apps/server/src/agents/memory/` (T-0440 to T-0446: compactor and summaries);
  - the costs and daily limit (`docs/FEATURES.md:69`) and the kill switch (line 80).

### What to write: `docs/audit/listener-delegation-plan.md`
Every claim about today's code carries a `file:line`. Sections:
1. **Today:**
   - how a room message becomes (or doesn't become) an AI turn;
   - where mentions, membership, coalescing, budgets, the daily limit and the kill switch are checked;
   - how a reply is posted;
   - what the memory compactor already produces (summaries) that a listener could reuse.
2. **Listener design on this code:**
   - **The trigger:** after N messages, or after X seconds of quiet per room, with no mention.
   - **One scoring call:** which model and key pay for it (the room's owner? a server setting?), its prompt input (recent window, roster with each AI's persona summary), and its strict JSON output (scores, reason, message ids).
   - **The threshold and eagerness** per room, stored where, and who can change them (group admins).
   - **Silent wake:** what the user sees, for example a "Dev is looking at this" line or a typing state.
   - **Security:** the listener has no tools and is the Rule-of-Two reader.
   - **Off by default** behind a server flag and a per-room switch.
   - **A cost estimate** per busy room.
3. **Limits (§9.4) on this code:**
   - a per-human-message budget (4 AI messages, 2 AI-to-AI hops) and where it lives (in memory per room versus in the DB);
   - a new human message resets the budget and interrupts in-flight turns;
   - AI @mentions an AI counts as a handoff (lifting today's ban, only within the budget);
   - stuck detection (simple first version);
   - everything enforced by the gateway.
4. **Delegation without desks:**
   - a `delegate(ai, task)` tool for AIs with a new "can delegate" permission, set by whom;
   - the worker turn runs with the worker's own model, key and budget, in the same room or topic (or a thread if threads exist; check and say);
   - the progress line;
   - the result returned to the boss as the tool result;
   - `task_status`;
   - how the handoff JSON maps to what is stored;
   - what changes later, once desks exist.
5. **Data and API changes:** tables and columns, routes, and web UI (room settings: listener on/off and eagerness; AI settings: can delegate; how wakes and delegations show in the chat). Mark mobile items; they wait.
6. **Task split:** ordered, one PR each, with exact files and tests. At most one schema task at a time, and server first, then web.
7. **Open questions for Julio,** each with a recommended answer. At least:
   - who pays for listener calls;
   - the default eagerness;
   - whether delegation is visible to people in the room;
   - whether an AI may delegate to an AI owned by someone else.

### Read first
`AGENTS.md`, `docs/PROJECT_PLAN.md:625-760`, `apps/server/src/agents/gateway.ts` (the room path from around line 1440 to 1900, plus line 914), `apps/server/src/agents/reply.ts` (structure), `apps/server/src/agents/tools.ts` (structure), `apps/server/src/agents/memory/compactor.ts`, `docs/FEATURES.md:55-100`.

### Allowed files
`docs/audit/listener-delegation-plan.md`, `work/T-0468-listener-delegation-plan.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- `docs/audit/listener-delegation-plan.md` has the 7 sections, cites `file:line` for every claim about today's code, gives an ordered task split (server, web, mobile marked), and lists open questions with recommendations.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Wrote `docs/audit/listener-delegation-plan.md` (docs only, no code/config/schema changes), following the 7 required sections. It:
- documents today's room path with `file:line` citations (mention gate `gateway.ts:1493-1499`, AI-to-AI ban `:1500-1504` and `:1571-1575`, coalescing `:1525-1542`, per-room rate limit `:165-166`/`:1612-1625`, daily limit `:573-619`, per-round gate `:914-946`, kill switch `:1174-1199`, reply path `reply.ts:1204-1273`, context `context.ts:206`, compactor `memory/compactor.ts:42`);
- designs the listener (hook before the mention return, debounce on `AiSession`, one zod-validated scoring call via `completeChat`, roster from `group_ais`/`topic_ais`/`ais`, per-room `listenerEnabled`/`listenerEagerness`, silent wake, Rule-of-Two reader with no tools, off by default, cost estimate);
- designs the limits (gateway-level per-room `Map<roomJid, RoundBudget>` for 4 AI messages / 2 hops, reset on a new human message, hop-aware AI-to-AI wake, simple stuck detection, gateway-enforced);
- designs delegation without desks (new `ais.canDelegate`, `delegate`/`task_status` tools, worker woken in its existing room session with its own model/key/budget, room progress, `ai_delegations` handoff mapping, `DelegationRunner` seam for when desks exist);
- gives data/API changes (one migration, routes, web UI, mobile marked later), an ordered 9-task split (S1–S6 server, W1–W2 web, M1 mobile) and 6 open questions with recommendations.

### Files changed

- `docs/audit/listener-delegation-plan.md` (new).
- `work/T-0468-listener-delegation-plan.md` (status → review, this Report).

### Commands and real results

- `pnpm install` — done in 16.7s, exit 0 (only a pre-existing peer-dependency warning for `@types/react-dom` in `apps/mobile`).
- `pnpm gate` (from repo root) — summary:
  ```
  gate: 1 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (13.5s)
  PASS  lint  (0.9s)
  PASS  typecheck  (1.2s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  That run was taken before the task-file Report edit; the only changed file then was the new doc. After this edit the changed set is the two Allowed files (doc + task file), so the gate's scope line stays green.
- No test files were run individually: this is a docs-only change with no source touched, so there is nothing package-test-related to run.

### Deviations from the spec (intentional, explained in the doc)

1. **Delegation result delivery.** The spec/§9.5 says the worker's result is returned to the boss as the tool result. With no desks and the boss's 120 s tool-loop wall clock (`reply.ts:394`) and 90 s model timeout (`reply.ts:25`), blocking the boss on a whole worker turn is unsafe. The plan returns `{task_id, status}` immediately and delivers the result via an AI-to-AI handoff or a later `task_status` call. Flagged in the doc (§4.3) and managed behind a `DelegationRunner` seam.
2. **Threads.** The spec asked to use a thread "if threads exist; check and say". They do not exist (no thread table in `schema.ts:216-1465`; `replyTo` is a quoted reply, `reply.ts:1212`), so progress is a normal room message. Stated in the doc header and §4.2.
3. **In-flight interruption** (§9.4: a new human message "interrupts in-flight work") is recommended as reset-only for v1; true cancellation needs an abort handle that does not exist today (`reply.ts:214` has only a timeout). Called out as Open Question 6.

### Problems

None. The gate is green and nothing outside the Allowed files changed.

### Open questions for Julio

The doc lists 6, each with a recommendation: (1) who pays for listener calls, (2) default eagerness, (3) whether delegation is visible in the room, (4) whether an AI may delegate to an AI owned by someone else, plus (5) wake-line wording and (6) v1 interruption. None blocked the writing.

## Review (written by Claude)

Approved (lead, 2026-10-07). docs/audit/listener-delegation-plan.md maps the room path (the mention gate, the AI-sender ban, coalescing) and designs:
- a no-tool scoring listener paid by a server key, with eagerness per group;
- a per-human-message budget of 4 messages and 2 hops;
- async delegate and task_status without desks, on the worker's own model, key and budget.
The split is S1-S6 (schema first), then W1-W2, with mobile last. The pre-review spot-checked the citations. Nits for the S3 spec: redactSecrets lives in ai/litellm-client.ts:229; the gate ran before the Report edit.

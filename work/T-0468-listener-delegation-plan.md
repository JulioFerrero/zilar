---
id: T-0468
title: "Audit + plan: the listener (who answers without @mention) and delegation (boss AI hands tasks to worker AIs), on today's code"
status: todo
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

## Review (written by Claude)

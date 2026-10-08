---
id: T-0549
title: "Agents G8b: move the group ingest side (sessionForAiJid, handleRoomIncoming, pumpRoom) out of createAgentGateway into agents/gateway/group-ingest.ts verbatim; zero behaviour change"
status: todo
milestone: M5
branch: task/T-0549-agents-g8b-extract-group-ingest
model: auto
effort: low
depends_on: [T-0546]
estimate: 0.5 day
---

# T-0549: agents G8b, extract the group ingest

## Spec (written by Claude, do not edit)

### Why
Plan `docs/audit/effect-agents-plan.md` §3, "G8". The lead split it in two: **G8a (T-0546) moved `runGroupSessionTurn`** into `agents/gateway/group-turn.ts`, and this task moves the ingest side. **The models to copy are G7 (`agents/gateway/dm-turn.ts`) and G8a (`agents/gateway/group-turn.ts`).** This is a pure extraction: no logic change and no Effect.

### Verified facts (do not re-derive; find each function by name inside `createAgentGateway` in `apps/server/src/agents/gateway.ts`, since lines move after merges)
- **The functions to move verbatim** (after G8a):
  - `sessionForAiJid(bare)` (around line 630);
  - `handleRoomIncoming(session, message)` (around 642);
  - `pumpRoom(session, roomJid)` (around 740).
- **Callers that stay:** the room-listener and `start()` wiring passes `handleRoomIncoming` or calls it. Find every caller with grep. Then destructure from the new factory so those call sites keep the same text.
- **What they close over:** `runGroupSessionTurn` (from `createGroupTurn`), the session map, `roomListener`, `budgetGate`, `logger`, `deps`, and closures such as `roomJidFor` and `nowMs`. Take closures as callbacks in `ctx`, as G7 and G8a did, using indexed-access types.
- **The order constraint:** the factory must be created after `createGroupTurn` and every value it needs. If a value `createGroupTurn` needs is defined after these functions today (function hoisting), keep `ctx` fields as arrow callbacks that read the value lazily, as G5b (`sessions.ts`, `isStarted`) did.
- **The pinning tests** (`apps/server/src/agents/gateway.test.ts`): the groups block, request_action in groups, AI handoff, delegation tools, topic naming, and the listener tests (`apps/server/src/agents/listener/*.test.ts`).

### What to build
1. **Create `apps/server/src/agents/gateway/group-ingest.ts`** exporting `createGroupIngest(ctx)`. It returns the moved functions that callers in `gateway.ts` still use.
2. **In `createAgentGateway`:**
   - create it once;
   - destructure;
   - remove the moved functions and drop the imports that only they used.
3. **Move the bodies verbatim:** no logic edits and no renames. Put a whitespace-insensitive diff of the old block against the new one in the Report; only the factory wrapper may differ.
4. **Tests:** every `apps/server/src/agents/**/*.test.ts` passes **unchanged**.

### Read first
`AGENTS.md`, `docs/audit/effect-agents-plan.md` §3 "G8", `apps/server/src/agents/gateway/group-turn.ts`, `apps/server/src/agents/gateway/dm-turn.ts`, `apps/server/src/agents/gateway/sessions.ts`, `apps/server/src/agents/gateway.ts`.

### Allowed files
`apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway/group-ingest.ts`, `work/T-0549-agents-g8b-extract-group-ingest.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents
pnpm gate
```

### Acceptance
- The group ingest lives in `agents/gateway/group-ingest.ts`, moved verbatim, with the diff in the Report.
- The agents tests are untouched and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

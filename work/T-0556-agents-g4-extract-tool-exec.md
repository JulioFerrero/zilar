---
id: T-0556
title: "Agents G4: move the tool executor (executeToolCall, runRequestAction, withToolGuide) out of createAgentGateway into agents/gateway/tool-exec.ts verbatim; cross-seam reads as ctx callbacks; zero behaviour change"
status: merged
milestone: M5
branch: task/T-0556-agents-g4-extract-tool-exec
model: auto
effort: low
depends_on: [T-0549]
estimate: 0.5 day
---

# T-0556: agents G4, extract the tool executor

## Spec (written by Claude, do not edit)

### Why
Plan `docs/audit/effect-agents-plan.md` §3, "G4". G1-G3 and G5-G8 have merged; G4 waited because it crosses seams. **The models to copy are `agents/gateway/dm-turn.ts` (G7), `agents/gateway/group-turn.ts` (G8a) and `agents/gateway/group-ingest.ts` (G8b).** This is a pure extraction: no logic change and no Effect.

**One deviation from the plan:** use one file, `gateway/tool-exec.ts`, instead of `tool-exec.ts` plus `tool-host.ts`. The plan's `ToolHost` reads (`sessions`, `roomRounds`, `sessionIsLive`, `pumpRoom`) become fields of the factory's `ctx`, as the other factories did.

### Verified facts (do not re-derive; find each function by name inside `createAgentGateway` in `apps/server/src/agents/gateway.ts`, since lines move after merges)
- **The functions to move verbatim** (after G8b):
  - `executeToolCall(` (around line 265; about 244 lines);
  - `async function runRequestAction(` (around 509);
  - `function withToolGuide(` (around 565).
- **Callers that stay:**
  - `createDmTurn({ … executeToolCall, withToolGuide … })` (around 194) and `createGroupTurn({ … executeToolCall … })` (around 236) receive them as ctx fields;
  - find any other caller with grep.
  
  **The factories are created before these function declarations today, which works through function hoisting.** After the move, `createToolExec` must be created **before** `createDmTurn` and `createGroupTurn`, or those two must take lazy arrows. Pick whichever keeps the call text unchanged, and explain it in the Report.
- **What the functions close over:** `sessions`, `roomRounds`, `sessionIsLive`, `pumpRoom` (from `createGroupIngest`), `deps`, `logger`, `aiDeps`, `secretsFor`, `nowMs` and the action gateway. **Check this list against the code.** Values from factories created later go in as lazy arrows (`(…) => pumpRoom(…)`), as G8b did.
- **The pinning tests** (`apps/server/src/agents/gateway.test.ts`, by name):
  - "updates the persona by chat…", "saves a remembered fact…" and "refuses a sixth remember in one turn after five saved";
  - "routes a tier-2 request_action through the action gateway with session-derived ids", "cannot be tricked by an aiId or groupId smuggled inside args" and "maps every RequestOutcome…";
  - "a stopped AI answers 'the AI was stopped'…";
  - the delegation tool cases.

### What to build
1. **Create `apps/server/src/agents/gateway/tool-exec.ts`** exporting `createToolExec(ctx)`. It returns `{ executeToolCall, runRequestAction, withToolGuide }`, or only what callers still use.
2. **In `createAgentGateway`:**
   - create it once, in an order that is safe as explained above;
   - destructure;
   - remove the moved functions and drop the imports that only they used.
3. **Move the bodies verbatim:** no logic edits and no renames, except replacing a direct factory member reference with the injected callback (as G8b did with `noteListenerMessage`). Put a whitespace-insensitive diff of the old block against the new one in the Report.
4. **Tests:** every `apps/server/src/agents/**/*.test.ts` and `apps/server/src/actions/*.test.ts` passes **unchanged**.

### Read first
`AGENTS.md`, `docs/audit/effect-agents-plan.md` §3 "G4", `apps/server/src/agents/gateway/group-ingest.ts`, `apps/server/src/agents/gateway/dm-turn.ts`, `apps/server/src/agents/gateway.ts`.

### Allowed files
`apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway/tool-exec.ts`, `work/T-0556-agents-g4-extract-tool-exec.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents src/actions
pnpm gate
```

### Acceptance
- The tool executor lives in `agents/gateway/tool-exec.ts`, moved verbatim, with the diff in the Report.
- The agents and actions tests are untouched and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Done. Pure extraction of the tool executor into `apps/server/src/agents/gateway/tool-exec.ts`; no logic change.

What I did:
- Created `apps/server/src/agents/gateway/tool-exec.ts` exporting `createToolExec(ctx)` returning `{ executeToolCall, runRequestAction, withToolGuide }`. The three function bodies (plus their leading comments) are the old `gateway.ts` lines 258-567 moved verbatim, now indented as factory methods. `runRequestAction` stays module-private to the factory but is returned because the spec allows "only what callers still use" — nothing outside the factory calls it directly; `executeToolCall` calls it internally.
- `createToolExec` ctx: `{ deps, logger, sessions, roomRounds, sessionIsLive, pumpRoom, secretsFor }`. Checked the closure list from the spec against the code: the block uses `deps` (db/actions/now), `logger`, `sessions`, `roomRounds`, `sessionIsLive`, `pumpRoom`, `secretsFor`. It does NOT use `aiDeps` or `nowMs` (no matches in the moved block; `nowMs`/`aiDeps` matches the spec guessed are actually in the turn factories, not here). So the factory needs no lazy arrows for `aiDeps`/`nowMs`.
- In `createAgentGateway`: `createToolExec` is created BEFORE `createDmTurn`, `createGroupTurn` and `createGroupIngest`, with `pumpRoom: (session, roomJid) => pumpRoom(session, roomJid)` as a lazy arrow (same pattern G8b used for `runGroupSessionTurn`), because `createGroupIngest` (which owns `pumpRoom`) is created later. `createDmTurn`/`createGroupTurn` call sites keep `executeToolCall, withToolGuide` unchanged. This is the "factory created before + lazy arrow for the later factory" option from the spec.
- Removed the moved functions from `gateway.ts` and dropped the imports only they used (tool-guide, memory secrets/store, reply types, tools, delegation service, RequestOutcome, denialReasonForModel/errorName/formatModelText, RequestActionContext). `ROUND_MAX_HOPS` re-export kept (used in export block). `setPersonaFromChat`/`revertPersonaFromChat` import path fixed to `../../ais/service` in tool-exec.ts (nested one level deeper).

Whitespace-insensitive diff: old block (gateway.ts @main lines 258-567) is a verbatim substring of new tool-exec.ts after stripping all whitespace (`old in new: True`); the +1787 non-whitespace chars are the file's imports, `ToolExecContext` interface, factory wrapper/destructuring and return statement. No logic edits, no renames.

Files changed: `apps/server/src/agents/gateway.ts` (-337/+21), `apps/server/src/agents/gateway/tool-exec.ts` (new), this task file.

Commands (real results):
- `pnpm install`: ok (19.8s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents src/actions`: 25 files passed, 1 skipped; 559 tests passed, 1 skipped.
- `pnpm gate`: GATE PASS — PASS install (1.2s), format (19.8s), lint, typecheck (9.6s), tests @zilar/server (64.4s); "scope: every changed file is inside the Allowed files". (First gate run failed on prettier formatting of the new file; fixed with `prettier --write` on the two touched source files, then PASS.)
- Note: `pnpm gate` lists files changed against `main` including other workers' files (app.ts, push/*, BOARD.md, other tasks); the gate's own scope check confirms every file changed by me is inside my Allowed files.

No deviations from spec; no open questions. Tests untouched.

## Review (written by Claude)

Approved (lead, 2026-10-08). G4: executeToolCall, runRequestAction and withToolGuide moved into agents/gateway/tool-exec.ts (createToolExec). Lead diff (whitespace-insensitive) of the old block against the new file: identical except the factory return. The factory is created before the turn factories, with a lazy pumpRoom arrow. The agents and actions tests are unchanged (559 passed). Pre-review clean; GATE PASS.

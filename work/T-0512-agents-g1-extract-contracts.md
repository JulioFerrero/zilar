---
id: T-0512
title: "Agents G1: move gateway.ts contracts/helpers (101-369) and DB lookups (371-527) verbatim into agents/gateway/contracts.ts and agents/gateway/db.ts; gateway.ts re-exports; zero behaviour change"
status: merged
milestone: M5
branch: task/T-0512-agents-g1-extract-contracts
model: auto
effort: low
depends_on: [T-0503]
estimate: 0.5 day
---

# T-0512: agents G1, extract the contracts and DB lookups

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase on Effect 4. `apps/server/src/agents/gateway.ts` is 2,841 lines. The plan `docs/audit/effect-agents-plan.md` (T-0503, merged) splits it into seams before any Effect conversion.

**G1 is the first step: a pure move with no logic change and no Effect.**

### Verified facts (do not re-derive)
- **`apps/server/src/agents/gateway.ts`:**
  - imports end around line 99 (the last one is `import type { ActionGateway, DeniedReason, RequestOutcome } from '../actions/gateway'`);
  - **lines 101-369:** declarations, types and pure helpers, starting with `export interface GatewayLogger` (101) and including `AgentGatewayDeps` (106), `AgentGatewayConfig` (154), `AgentGateway` (293), the constants and the redaction helpers (ending around 369 with `return new Error(redactSecrets(String(error), secrets));`);
  - **lines 371-527:** the DB lookups, starting with `async function loadActiveAi(db, aiId)` (371) and ending with `return { memberJids, memberRolesByJid };` (around 527);
  - **`export function createAgentGateway(deps, config)`** at line 534.
  
  The plan's §1.1, §1.2 and "G1" detail describe the same ranges.
- **The importers of `./agents/gateway`:** `apps/server/src/index.ts:16` (`createAgentGateway`, `type AgentGateway`) and `apps/server/src/agents/gateway.test.ts` (the factory and constants). **Both must keep importing the same path unchanged.**

### What to build
1. **Create `apps/server/src/agents/gateway/contracts.ts`** with lines 101-369, moved **verbatim** (only the imports they need change). Exported names stay exported; private helpers that `gateway.ts` or `db.ts` now need become exports of `contracts.ts`.
2. **Create `apps/server/src/agents/gateway/db.ts`** with lines 371-527, moved verbatim, exporting each lookup that `gateway.ts` uses.
3. **`gateway.ts`** imports from both new files and **re-exports every name it exported before** (types, interfaces, constants), so no importer changes. Delete the moved code from `gateway.ts`; nothing else in it changes.
4. **No logic edits, no renames, no Effect.** A diff of the moved blocks against the old lines must show only import and export changes. List any unavoidable deviation in the Report.
5. **Tests:** every `apps/server/src/agents/**/*.test.ts` and `apps/server/src/index`-related test passes **unchanged**.
6. **Import paths:** `agents/gateway.ts` and the new `agents/gateway/` folder coexist. In TypeScript and Node ESM resolution, `./gateway` still resolves to `gateway.ts`; confirm with typecheck. If a cycle warning appears, report it.

### Read first
`AGENTS.md`, `docs/audit/effect-agents-plan.md` §1.1, §1.2, §2 (seams), §3 ("G1"), `apps/server/src/agents/gateway.ts:1-540`.

### Allowed files
`apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway/contracts.ts`, `apps/server/src/agents/gateway/db.ts`, `work/T-0512-agents-g1-extract-contracts.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents
pnpm gate
```

### Acceptance
- `gateway.ts` is about 430 lines shorter.
- The two new modules hold the moved code verbatim, and every old export is still exported from `gateway.ts`.
- The agents tests are untouched and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Pure move for G1. No logic edits, no renames, no Effect.

- Created `apps/server/src/agents/gateway/contracts.ts` (281 lines) with `gateway.ts:101-369` verbatim: public contracts, exported constants, internal queue/session types, and the pure helpers `isAiSender`, `retryDelayMs`, `errorName`, `denialReasonForModel`, `formatModelText`, `toRedactedError`.
- Created `apps/server/src/agents/gateway/db.ts` (178 lines) with `gateway.ts:371-527` verbatim: `loadActiveAi`, `loadOwnerName`, `listAiRooms`, `loadRoomGateState`.
- Trimmed `apps/server/src/agents/gateway.ts` from 2,841 to 2,440 lines (-401): removed the moved blocks, imported the names those blocks need from both new modules, and re-exported every name it exported before (`GatewayLogger`, `AgentGatewayDeps`, `AgentGatewayConfig`, `AgentGateway` and the 11 exported constants). `index.ts:16` and `gateway.test.ts` still import `./gateway` unchanged. `createAgentGateway` and its comment block are byte-identical.

### Verbatim check

A `diff` of the moved ranges against the old file shows only:

- `export` added to the internal types/constants/helpers that `gateway.ts` or `db.ts` now imports: `XMPP_TOKEN_TTL_SECONDS`, `PendingMessage`, `RoomPendingMessage`, `RoomRound`, `RoomSubscription`, `RoomListenerState`, `AiSession`, the six pure helpers and the four DB lookups;
- the four long exported function signatures re-wrapped by Prettier because `export ` pushed them past 100 columns;
- the new import blocks at the top of each file.

No logic, comment or identifier changed.

### Imports

`./gateway` still resolves to `gateway.ts`; `./gateway/contracts` and `./gateway/db` resolve to the new folder. Typecheck is green; no import cycle was reported.

### Commands run (real results)

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents` -> 16 files: 15 passed, 1 skipped; 426 passed, 1 skipped (51.7s).
- `pnpm gate` (repo root) -> `PASS install (frozen) 2.8s`, `PASS format 56.7s`, `PASS lint 1.5s`, `PASS typecheck 15.0s`, `PASS tests @zilar/server 68.7s`; `scope: every changed file is inside the Allowed files`; `GATE PASS`.
- History: an early full `gateway.test.ts` run reported 119/168 failures, all `Error: timed out waiting for the condition` (`waitFor`, 5s), while the shared machine was at load ~30-42 with four other worktrees running vitest. The same cases pass in isolation and the full `src/agents` run above is green; those failures were machine load, not code.

### Deviations from the spec

- `gateway.ts` is 401 lines shorter, not ~430: the moved blocks are 426 lines, but 27 lines of new imports/re-exports are added back. No other deviation.
- Prettier re-wrapped four now-`export`ed function signatures (whitespace only).

### Notes / open questions

None. Every old export is still exported from `gateway.ts`; no importer changed.

## Review (written by Claude)

Approved (lead, 2026-10-08). G1 is a pure move: the contracts, helpers and DB lookups went verbatim into agents/gateway/contracts.ts and db.ts, and gateway.ts re-exports every old name (2,841 down to 2,440 lines). The agents tests are unchanged. Pre-review clean.

---
id: T-0512
title: "Agents G1: move gateway.ts contracts/helpers (101-369) and DB lookups (371-527) verbatim into agents/gateway/contracts.ts and agents/gateway/db.ts; gateway.ts re-exports; zero behaviour change"
status: todo
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

## Review (written by Claude)

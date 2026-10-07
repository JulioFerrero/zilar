---
id: T-0503
title: "Audit: how to move apps/server/src/agents (gateway 2.8k lines + stream, reply, memory, delegation, listener) onto Effect in small safe tasks — doc only"
status: todo
milestone: M5
branch: task/T-0503-audit-agent-gateway-effect
model: auto
effort: low
depends_on: [T-0490]
estimate: 0.5 day
---

# T-0503: audit, the agents module on Effect

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase on Effect 4. The AI agent runtime in `apps/server/src/agents/` is the largest and riskiest server area:
- `gateway.ts` is 2,841 lines, with one `createAgentGateway` factory from line 534;
- the rest of `agents/` is about 7.3k lines (`stream.ts`, `reply.ts`, `context.ts`, `tools.ts`, `delegation/`, `listener/`, `memory/`).

It must be split into small, behaviour-preserving tasks that a worker can finish in half a day each. **This task writes the plan only; it changes no code.**

### Verified facts (do not re-derive)
- **`apps/server/src/agents/gateway.ts`:**
  - exports `GatewayLogger` (line 101), `AgentGatewayDeps` (106), `AgentGatewayConfig` (154), `AgentGateway` (293) and `createAgentGateway` (534);
  - timers: a retry `setTimeout` per session (from line 1085, cleared at 1405), a per-state `setTimeout` (from line 1758) and a `setInterval` (from line 2798).
- **The other files:** `apps/server/src/agents/delegation/service.ts`, `listener/score.ts`, `memory/{compactor,indexer,routes,secrets,store,tree}.ts`, `stream.ts`, `reply.ts`, `context.ts`, `tools.ts`, `tool-guide.ts`. Every one has its `*.test.ts` next to it, plus `integration.test.ts`, `rounds.test.ts` and `gateway.test.ts`.
- **The conversion patterns already merged** (read them; they are the vocabulary):
  - T-0486 (`machines/hub.ts`) and T-0488 (`routines/scheduler.ts`, `approvals/sweeper.ts`): loops as fibers, `catchDefect`, interrupt on close;
  - T-0484 (`web-tools/guarded-fetch.ts`): `Effect.callback` with a finalizer, `timeoutOrElse`;
  - T-0489 (`sandbox/run-tool.ts`): `acquireRelease`;
  - T-0492 and the voice pipeline (`voice-transcription/pipeline.ts`): tagged errors, an edge mapping;
  - T-0495 (`effect/runtime.ts`, `effect/logger.ts`): the runtime and the pino logger layer.
  
  `docs/EFFECT_GUIDE.md` lists the Effect 4 facts.
- **The plan:** `docs/audit/effect-everywhere-plan.md` §2.4 (services and layers) and §4.4 (bulk; agents are wave 6).

### What to write
Write `docs/audit/effect-agents-plan.md` with these sections:
1. **Map of `gateway.ts`:** each internal responsibility (session lifecycle, turn queue, retries, streaming, tool calls, rounds and budget, delegation hooks, listener hooks, drafts, timers, shutdown), each with its line ranges, the state it owns and its side effects (DB, XMPP, network, timers).
2. **Seams:** where the file can be cut into modules without changing behaviour. For each cut, give the functions that move and the closures and shared state they need.
3. **Ordered task list:** 6 to 12 tasks, each **at most about 400 changed lines**, each with:
   - its files;
   - the Effect idioms it uses (cite the merged example by file);
   - the tests that must pass unchanged;
   - its risk;
   - what it depends on.
   
   Start with pure extractions (moving code into modules with no Effect yet), then conversions. Mark which tasks can run in parallel.
4. **Hazards:** concurrency and ordering guarantees the tests pin (cite test names), places where a promise is intentionally not awaited, and places where an exception is intentionally swallowed. Each one with its `file:line`.
5. **What the AI SDK or provider streaming needs:** how streaming responses would become an Effect `Stream`, or whether they should stay as async iterators behind a single edge (recommend one, with a reason).

Every claim cites `file:line`. Unknowns are listed as questions, not guesses.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-everywhere-plan.md` §2.4 and §4.4, `apps/server/src/agents/` (all non-test files; skim the tests for the pinned behaviour).

### Allowed files
`docs/audit/effect-agents-plan.md`, `work/T-0503-audit-agent-gateway-effect.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- `docs/audit/effect-agents-plan.md` exists with all 5 sections, `file:line` citations and an ordered task list of 6 to 12 small tasks.
- No code changed.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

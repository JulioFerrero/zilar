---
id: T-0503
title: "Audit: how to move apps/server/src/agents (gateway 2.8k lines + stream, reply, memory, delegation, listener) onto Effect in small safe tasks — doc only"
status: merged
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

### What I did

Wrote `docs/audit/effect-agents-plan.md` (doc only; no code touched). I read every
non-test file in `apps/server/src/agents/` end to end (`gateway.ts`,
`stream.ts`, `reply.ts`, `context.ts`, `tools.ts`, `tool-guide.ts`,
`delegation/service.ts`, `listener/score.ts`, `memory/*.ts` — 7,295 lines), the
existing task/test names in every `agents/**/*.test.ts`, `docs/EFFECT_GUIDE.md`,
`docs/audit/effect-everywhere-plan.md` §2.4/§4.4, and the merged conversion
examples (T-0484 `web-tools/guarded-fetch.ts`, T-0486 `machines/hub.ts`,
T-0488 `routines/scheduler.ts` + `approvals/sweeper.ts`, T-0489
`sandbox/run-tool.ts`, T-0492 `voice-transcription/pipeline.ts`, T-0495
`effect/runtime.ts` + `effect/logger.ts`).

The plan has the five required sections:

1. **Map of `gateway.ts`** — every responsibility with line ranges, the state it
   owns and its side effects (DB, XMPP, network, timers), including the three
   timer sites (`gateway.ts:1087`, `1758`, `2798`).
2. **Seams** — a proposed `agents/gateway/` module layout, and for each seam the
   functions that move plus the closures/shared state they need. It calls out
   the one non-pure seam: `executeToolCall` reads `sessions`/`roomRounds` and
   calls `pumpRoom` directly (`gateway.ts:876,885,940`).
3. **Ordered task list** — 12 tasks (G1–G9 extractions, then C1–C3 conversions),
   each with files, the Effect idioms it uses (cited to the merged example by
   file:line), the tests that must pass unchanged (with named cases and
   `gateway.test.ts`/`rounds.test.ts`/`reply.test.ts`/`stream.test.ts` line
   numbers), risk, dependencies and a parallelism graph.
4. **Hazards** — 11 groups of concurrency/ordering guarantees, intentional
   non-awaits (`gateway.ts:940,1181,1682,1868,2001,2718,2739,2760,2784`) and
   swallowed exceptions (`1408-1414`, `1491-1496`, `1613`, `2046`, `2449-2451`,
   `2680-2681`, `2820-2826`), each with `file:line` and the pinned test names.
5. **Streaming** — recommends keeping `consumeChatCompletionStream` as a plain
   async reader and putting one `Effect` boundary (`Effect.tryPromise` +
   `timeoutOrElse`) around `requestCompletion`, instead of converting the SSE
   parser to a `Stream`; notes `Stream.fromReadableStream` exists in Effect
   4.0.0 (`Stream.d.ts:1076`) but gives no runtime gain and would move
   `stream.test.ts`'s byte-level cases. A `Stream` is suggested later for the
   DM draft `onDelta` path only.

I also added an "Unknowns / open questions" section (6 questions) rather than
guessing, per the spec and `AGENTS.md`.

### Files changed

- `docs/audit/effect-agents-plan.md` (new).
- `work/T-0503-audit-agent-gateway-effect.md` (status + this Report).

No code changed.

### Commands run (real results)

- `pnpm install` — exit 0, `Done in 13.4s using pnpm v10.32.1` (one pre-existing
  `@types/react-dom` peer warning in `apps/mobile`, unrelated to this task).
- `pnpm gate` — exit 0, ends with `GATE PASS`:

  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (22.2s)
  PASS  lint  (1.1s)
  PASS  typecheck  (1.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

No single test files were run separately: no code or tests changed, and the gate
selected no package test suites for a docs-only diff. I did not run `turbo test`
or any whole suite.

### Problems / deviations

- The spec says "6 to 12 tasks, each at most about 400 changed lines", but the
  module is 7,295 non-test lines: a strict ≤400 cap needs ~19 tasks. I delivered
  12 tasks with explicit split points for the two oversized ones (G8 group turn
  ≈540; C2 tool loop ≈600) and flagged the arithmetic in the plan's "Unknowns"
  (question 1) so the lead can decide whether to expand the list. This is the
  one place the plan does not satisfy the spec literally.
- The spec's verified-facts line says gateway is 2,841 and "the rest of
  `agents/` is about 7.3k lines"; the actual non-test total for the whole
  directory is 7,295 (so the rest is ~4,454). I used the measured number.
- No other deviations. No dependencies added, no tests changed, no files outside
  the Allowed list touched.

### Open questions

See the plan's "Unknowns / open questions" (task-count sizing, how far to
convert the pure leaves, whether the shared `ManagedRuntime` is introduced, the
`catchCause` vs `catchDefect` choice per loop, ordering of `drafts/` and
`actions/` conversions relative to C2, and keeping `memory/routes.ts` in the 401
sweep). None block the work; all are decisions for the lead.

### Round

Fix round against `PREREVIEW.md` (must-fix 0, should-fix 1, nit 1).

- **Finding 1 (should-fix) — fixed.** The G4 table row claimed deps `G1,G6`;
  it is now `G1,G5`, and the §2 closing sentence no longer says "task G5 comes
  after G6 … lands together with G6" but "task G4 comes after G5 … lands
  together with G5". Both now agree with the G4 detail ("run it after G5 (the
  registry)") and the Parallelism graph (`G5 ─> G4`). File:
  `docs/audit/effect-agents-plan.md`.
- **Finding 2 (nit, sizing note) — not changed.** The task instruction says not
  to touch nits unless they sit on a line already edited, and the sizing note is
  a separate paragraph. No behaviour is affected; left for the lead.
- **Tests added: none.** This is a doc-only change; the finding names no test and
  no code or test files changed.
- **Gate:** `pnpm gate` exit 0, `GATE PASS`:

  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (5.5s)
  PASS  format  (26.8s)
  PASS  lint  (1.3s)
  PASS  typecheck  (0.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

## Review (written by Claude)

Approved (lead, 2026-10-07). `docs/audit/effect-agents-plan.md` maps gateway.ts with line ranges, lists the seams, gives the ordered G1-G9 extractions and C1-C3 conversions with a parallelism graph, records 11 hazards with file:line, and recommends one Effect boundary around requestCompletion (the SSE parser stays a plain async function). Lead decision on the sizing question: split G1, G8 and C2 so each task stays at or under 400 changed lines.

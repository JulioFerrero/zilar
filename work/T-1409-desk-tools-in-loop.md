---
id: T-1409
title: "P2 task C: the desk tools (bash, read, write, edit, grep, glob, git) in the AI's agent loop through the Hands client, for AIs whose new computer_mode is 'cloud'; ais.computer_mode column (expand-only) and its field in the AI API"
status: merged
milestone: M5
branch: task/T-1409-desk-tools-in-loop
model: auto
effort: default
depends_on: [T-1407]
estimate: 1 day
---

# T-1409: Desk tools in the agent loop

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: AIs run Linux commands, clone repos, search code and edit files on a computer that exists only while a task needs it (`docs/design/agent-system.md` §2.3). `packages/desk` (T-1403) has the tool daemon, and T-1407 has the sidecar plus the app-side Hands client (`apps/server/src/hands/cloud-hands.ts`, `wiring.ts`; built only when `DESK_AGENT_SOCKET` is set).

**This task is the plan's Task C** (`docs/audit/desk-runner-plan.md` §3.3 and §8 Task C). It adds the minimal `computer_mode` from Task H, server-side only; the UI toggle comes in a later task.

### Facts (the lead checked them on main, 2026-10-14)
- **Tools for a turn:** `buildTools` (`apps/server/src/agents/tools/definitions.ts:229`) and `buildGroupTools` (`:246`). `ChatToolDefinition` is at `:15`. Parsing and validation: `apps/server/src/agents/tools/parse.ts` (168 lines) and `schemas.ts` (112).
- **`ValidToolCall`** (a union) is at `apps/server/src/agents/tool-loop.ts:38-58`.
- **Execution:** `executeToolCall` in `apps/server/src/agents/gateway/tool-exec.ts:64`. That file is **397 lines**, so the new branch must live in a **new file** (e.g. `apps/server/src/agents/gateway/desk-exec.ts`) and `tool-exec.ts` only dispatches to it.
- **Tool output** is wrapped in `<untrusted-tool-output>` and truncated to `TOOL_RESULT_MAX_CHARS` (`apps/server/src/agents/tool-exec.ts`, around `:183`).
- **The status line** (T-1406) and the progress stage come from `TOOL_STAGE_BY_TOOL` (`apps/server/src/agents/tool-guide.ts:27`).
- **Migrations:** the latest is `apps/server/drizzle/0056_optional_ai_limits.sql`. Start each new file with `SET lock_timeout = '5s';--> statement-breakpoint`, and update `apps/server/src/db/rows.ts`.
- **The Hands interface** is in `packages/desk/src/hands.ts`. `apps/server/package.json` doesn't depend on `@zilar/desk` yet (T-1407 follow-up: `cloud-hands.ts` duplicates the types).

### What to build
1. **Migration `0057_ai_computer_mode.sql`:** `ALTER TABLE ais ADD COLUMN computer_mode text NOT NULL DEFAULT 'off'` with `CHECK (computer_mode IN ('off','cloud','runner','auto'))`. It's expand-only.
2. **API:**
   - `PublicAi` gains `computerMode` (`packages/api-contract/src/ais.ts`);
   - the AI patch accepts `computerMode: 'off' | 'cloud'` for now (owner only, same checks as other patches);
   - the mock backend returns `'off'`, and `'cloud'` for one AI.
3. **Depend on `@zilar/desk`** from `apps/server` (`"@zilar/desk": "workspace:*"`), and delete the duplicated types in `cloud-hands.ts`.
4. **Tool definitions** in a new `apps/server/src/agents/tools/desk-definitions.ts`:
   - one `ChatToolDefinition` each for `bash`, `read`, `write`, `edit`, `grep`, `glob` and `git`, with JSON-schema parameters matching the daemon's tool table (`packages/desk/README.md`);
   - short, clear descriptions, which matter for prompt caching and model behaviour;
   - append them in `buildTools` and `buildGroupTools` **only** when the AI's `computer_mode` is `cloud` and a Hands client exists;
   - the tool list stays the same for the whole turn (design §2.5).
5. **Parsing:** extend `ValidToolCall` and the parser for the seven tools (validate the args; bad args become the usual `invalid: …` tool result).
6. **Execution** (`gateway/desk-exec.ts`):
   - on the first desk tool of a turn, call `hands.provision` for `DeskKey { aiId, projectId: 'default' }` with the limits from the plan and the AI's owner;
   - then `hands.execute`, collecting stdout and stderr into one result (wrapped and truncated as above); write the full output to a file only if it's longer than the cap. Keep it simple: truncate and say "(truncated)".
   - map the desk errors to short tool results. `queued` returns "Your computer is busy; queued (n ahead). Try again shortly." and a reported stage of "Waiting for a computer".
   - **failed calls stay in context** as tool results;
   - the stage and status text per tool go through the existing fixed stage map: add entries such as "Running a command", "Reading files", "Editing files", "Searching code" and "Using git".
7. **Out of scope:** the runner, the egress proxy, credentials, the UI toggle and the browser.

### Tests (security and pipeline, few)
- **`apps/server/src/agents/tools/desk-definitions.test.ts`:** the tools are advertised only for `computer_mode = 'cloud'` with a Hands client; bad args are refused by the parser.
- **One gateway test with a fake Hands:** a DM turn where the model calls `bash` (reusing the fake OpenAI-compatible server pattern from `apps/server/src/agents/dm-turn.fake-provider.test.ts`). The fake Hands gets `provision` once and `execute` with the args, and the reply comes back.

### Read first
`AGENTS.md`, `docs/audit/desk-runner-plan.md` §2, §3.3 and Task C, `packages/desk/README.md`, `packages/desk/src/hands.ts`, and the files above.

### Allowed files
`apps/server/drizzle/0057_ai_computer_mode.sql`, `apps/server/src/db/rows.ts`, `apps/server/package.json`, `pnpm-lock.yaml`, `apps/server/src/hands/*.ts`, `apps/server/src/agents/*.ts`, `apps/server/src/agents/tools/*.ts`, `apps/server/src/agents/gateway/*.ts`, `apps/server/src/ais/*.ts`, `packages/api-contract/src/ais.ts`, `packages/mock-backend/src/domains/ais/*.ts`, `apps/web/src/lib/api/*.ts`, `apps/mobile/src/lib/ais-api.ts`, `work/T-1409-desk-tools-in-loop.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/tools/desk-definitions.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes; every file is at most 400 lines.
- With no `DESK_AGENT_SOCKET`, or an AI in `computer_mode = 'off'`, the tool list is unchanged (live behaviour is unchanged until the VPS install).

---

## Report (written by the worker when done)

### What I did

Task C: the desk tools (`bash`, `read`, `write`, `edit`, `grep`, `glob`, `git`)
in the agent loop, plus the minimal `computer_mode` column and its AI-API field.

**Data / API**
- `apps/server/drizzle/0057_ai_computer_mode.sql` (new): adds
  `computer_mode text NOT NULL DEFAULT 'off'` with
  `CHECK (computer_mode IN ('off','cloud','runner','auto'))`, expand-only and
  `SET lock_timeout = '5s';` first.
- `apps/server/src/db/rows.ts`: `AisRow.computerMode`.
- `apps/server/src/ais/{persona,queries,provisioning,api}.ts`: `PublicAi.computerMode`,
  the column in every AI SELECT (`listAis`, `findOwnedAi`, `findGatewayAiEffect`),
  `ActiveAiForGateway.computerMode`, `UpdateAiInput.computerMode` and the audit-free
  COALESCE update. Only `'off' | 'cloud'` are accepted through the patch.
- `packages/api-contract/src/ais.ts`: `AiComputerMode` literals, `PublicAi.computerMode`
  (optional so older payloads parse) and `UpdateAiPayload.computerMode: 'off' | 'cloud'`.
- `packages/mock-backend/src/domains/ais/{seed,routes}.ts`: all AIs return `'off'`,
  `ai-qa-1` returns `'cloud'`; create defaults `'off'`; patch accepts `off`/`cloud`.
- `apps/web/src/lib/api/ais.ts` and `apps/mobile/src/lib/ais-api.ts`: the field on the
  patch input and (mobile) on its local `PublicAi`, plus `UpdateAiInput.computerMode`.

**Tools**
- `apps/server/src/agents/tools/desk-definitions.ts` (new): the seven
  `ChatToolDefinition`s with parameters matching the daemon table.
- `apps/server/src/agents/tools/schemas.ts`: the tool names, the strict Effect arg
  schemas, the `DeskToolName` type and `isDeskToolName`.
- `apps/server/src/agents/tools/parse.ts`: the seven parser branches (bad args →
  `invalid: …`).
- `apps/server/src/agents/tool-loop.ts`: a desk variant on `ValidToolCall` and an
  optional `ToolExecution.stage`.
- `apps/server/src/agents/tools/definitions.ts`: `buildTools`/`buildGroupTools` append
  the desk set only when `opts.desk` is true; `tools.ts` re-exports the new names.
- `apps/server/src/agents/tool-exec.ts` (`toCall`) and
  `apps/server/src/agents/gateway/tool-exec.ts`: dispatch a desk call to the runner;
  a desk call is `invalid: unknown tool` when the turn did not offer the tools.

**Deps and the Hands client**
- `apps/server/package.json`: `"@zilar/desk": "workspace:*"`; `pnpm-lock.yaml` updated.
- `apps/server/src/hands/cloud-hands.ts`: the duplicated `Desk*`/`Hands` interfaces are
  deleted and re-exported from `@zilar/desk`; `HandsError`/`HandsQueued` are aliases of
  `DeskError`/`DeskQueued`, and the reply error is decoded with the package's
  `ErrorInfoSchema`.
- `apps/server/src/agents/gateway/desk-exec.ts` (new): one runner per turn, `provision`
  on the first desk call (`DeskKey { aiId, projectId: 'default' }`, the plan limits,
  the AI's owner), then `execute`; stdout+stderr are concatenated, wrapped in
  `<untrusted-tool-output>` and truncated with `(truncated)`; the fixed error codes map
  to short sentences; `DeskQueued` returns "Your computer is busy; queued (n ahead).
  Try again shortly." with the "Waiting for a computer" stage.
- `apps/server/src/agents/tool-guide.ts`: the desk stages and
  `TOOL_STAGE_WAITING_FOR_COMPUTER`.
- `apps/server/src/agents/tool-exec.ts` (`runLoopRound`): a call may report a post-run
  stage, so a queued desk updates the live progress message.
- `apps/server/src/agents/gateway/contracts.ts`: `AgentGatewayDeps.desk`
  (`{ hands, imageDigest }`); `dm-turn.ts`/`group-turn-body.ts` set
  `desk = deps.desk !== undefined && ai.computerMode === 'cloud'` and pass the same
  flag to the tool list and the executor.

### Tests

- `apps/server/src/agents/tools/desk-definitions.test.ts` (new): no desk tool when the
  desk is off, all seven when on, and the parser refuses bad/extra/wrong-type args and
  accepts good ones.
- `apps/server/src/agents/gateway-desk.test.ts` (new): a DM turn where the fake provider
  asks for `bash`; the fake `Hands` is provisioned once and `execute` gets
  `{ tool: 'bash', args: { command: 'echo hello' } }`, and the final reply comes back.
- `apps/server/src/agents/gateway.test-harness.ts`: `seedAi` can set `computer_mode` and
  the harness passes `deps.desk`; added a `toolCallResponse` SSE helper.

Commands and real results:

- `pnpm install` → done, `@zilar/desk` linked into `apps/server`.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/tools/desk-definitions.test.ts src/agents/gateway-desk.test.ts`
  → `Test Files 2 passed (2)`, `Tests 4 passed (4)`.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/hands/cloud-hands.test.ts`
  → `Test Files 1 passed (1)`, `Tests 2 passed (2)`.

`pnpm gate` (repo root, final):

```
gate: 33 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (1.2s)
PASS  lint  (0.5s)
PASS  typecheck  (2.4s)
PASS  effect  (0.8s)
SKIP  tests @zilar/api-contract (no nearby test files)
PASS  tests @zilar/mobile  (1.2s)
SKIP  tests @zilar/mock-backend (no nearby test files)
PASS  tests @zilar/server  (8.7s)
PASS  tests @zilar/web  (3.4s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Deviations / open questions (needs a decision)

1. **Production wiring of the Hands client is not in this task's Allowed files.** The
   gateway takes `deps.desk = { hands, imageDigest }`, and the fake-Hands test exercises
   the full path, but nothing in production sets it: `buildHands(config)` is called from
   `apps/server/src/main.ts`, and `DeskSpec.imageDigest` needs the pinned image
   (`DESK_IMAGE`) which no `apps/server/src/config.ts` key provides. Both files are
   outside this task's Allowed files, so I did not touch them. This matches the
   Acceptance ("with no `DESK_AGENT_SOCKET` the tool list is unchanged"); when the VPS
   install happens, a follow-up (or a widened Allowed set) must add the config key and
   the `main.ts` wiring. Question: add `DESK_IMAGE` + `buildHands` in `main.ts` as a
   small follow-up task, or widen T-1409?
2. **Progress stage.** The per-round stage comes from the fixed `TOOL_STAGE_BY_TOOL`
   map. To also show "Waiting for a computer" for a queued desk I added an optional
   post-run `ToolExecution.stage` that `runLoopRound` reports (best effort). The stage
   constant lives in `tool-guide.ts`; the other desk stages are plain map entries.
3. **Runner/browser/egress** are out of scope as the spec says.

### Round 1 (fix round)

Findings fixed:
- **Finding 1 (should-fix, `gateway/tool-exec.ts` over 400 lines):** the desk
  runner setup and the `isDeskToolCall` guard/dispatch moved into
  `gateway/desk-exec.ts` (`createTurnDeskRunner`, `runDeskCall`); `tool-exec.ts`
  now only calls them (one dispatch line). The desk dispatch moved before the
  group allowlist, so that guard reads exactly as on main. To restore the
  400-line cap the self-contained `request_action` runner moved to
  `gateway/request-action.ts` (`createRequestActionRunner`) — a pure move.
  `gateway/tool-exec.ts` 427 → 334 lines; `desk-exec.ts` 207; new file 94.
- **Finding 2 (should-fix, `agents/tool-exec.ts` over 400 lines):** the tool-call
  pipeline (`executeToolCalls`, `executeOneToolCall`, `toCall`, `isDeskParsedTool`)
  moved to `agents/tool-calls.ts`, and `redactError` to `agents/redact-error.ts`
  (so `tool-calls.ts` needs no cycle back into `tool-exec.ts`). Both are still
  re-exported from `agents/tool-exec.ts`, so every existing caller is unchanged.
  `agents/tool-exec.ts` 416 → 220 lines; new modules 190 and 22 lines.
- Nits 3 and 4 (dead jail `ref`, inconsistent `(truncated)` marker) were left as
  they are: the round rules say nits are untouched unless they sit in a line the
  fix already changes, and the `ref`/`executeFailure` and capped/status lines are
  unchanged. No disagreement with any finding.

Tests added: none. Both findings are pure refactors (file splits), not behaviour
changes, so the existing tests cover them. No finding named a test.

Commands and real results:
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/tools/desk-definitions.test.ts src/agents/gateway-desk.test.ts`
  → `Test Files 2 passed (2)`, `Tests 4 passed (4)`.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/reply.test.ts src/agents/dm-turn.fake-provider.test.ts src/agents/gateway-group.test.ts`
  → `Test Files 3 passed (3)`, `Tests 21 passed (21)`.

`pnpm gate` (repo root):

```
gate: 36 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.5s)
PASS  lint  (0.8s)
PASS  typecheck  (2.9s)
PASS  effect  (1.1s)
SKIP  tests @zilar/api-contract (no nearby test files)
PASS  tests @zilar/mobile  (1.1s)
SKIP  tests @zilar/mock-backend (no nearby test files)
PASS  tests @zilar/server  (8.6s)
PASS  tests @zilar/web  (3.0s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

## Review (written by Claude)
Lead, 2026-10-14: approved. Pre-review CLEAN after 1 auto round, nit 3, follow-up 1.
- Checks: migration 0057 is expand-only, with lock_timeout, the 'off' default and a CHECK; the server agent tests pass locally (7 files, 29 tests); all touched source files are at most 400 lines.
- Live behaviour is unchanged: production never sets deps.desk.
- Follow-up (a new task): wire buildHands from main.ts and add a DESK_IMAGE config, with T-1411.
- After deploy: live-check GET /api/ais (computerMode).

---
id: T-0093
title: `request_action` AI tool + dev-only demo adapter (M4, server) — an AI can ask for an approved action in the owner's DM, end to end
status: merged
milestone: M4
branch: task/T-0093-request-action-tool
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0090, T-0092]
estimate: 1 day
---

# T-0093: An AI asks, the owner approves, the platform acts

## Spec (written by Claude, do not edit)

### Goal

Close the loop that T-0090 and T-0092 opened. In the **owner's DM**, the model gets one more tool, `request_action`. When the owner asks for something an adapter can do, the AI calls the tool; the action gateway applies the tier policy; a tier-2 request posts an approval card in the DM (T-0092); the owner approves it in web/mobile; the platform runs the stored args and the AI's chat shows the outcome. To prove it live we add **one harmless demo adapter**, `demo.echo`, that only exists when `ACTION_DEMO_ENABLED=true` (default off). With the flag off and no adapters, the tool is **not offered at all**, so production behaviour does not change.

Groups are **out of scope** (no tools are offered in group turns today; leave that alone).

### Design (decided; follow it)
- **Tool definition** in `agents/tools.ts`: `REQUEST_ACTION_TOOL = 'request_action'`, args schema (zod, `.strict()`): `{ action: string (the registered-name pattern, max 100), args: record of unknown (a JSON object, not an array or string) }`. `PERSONA_TOOLS` stays as it is; add `buildTools(actions: ReadonlyArray<{ name: string; description: string }>): ChatToolDefinition[]` returning the persona tools plus, only when `actions` is non-empty, the `request_action` definition whose description lists each action as `name — description` and says the platform asks the owner for approval when needed and the AI must not claim an action happened until told so.
- **`ValidToolCall`** gains `{ id; tool: 'request_action'; action: string; args: Record<string, unknown> }`; `parseToolArguments` validates it (invalid → `invalid: <reason>` without argument values, like the others). `DmTurnDeps` gains `tools?: ChatToolDefinition[]` (defaults to `PERSONA_TOOLS`, so existing callers and tests are unchanged); `reply.ts` passes it wherever it used `PERSONA_TOOLS`.
- **Adapters describe themselves:** `ActionAdapter` gets a required `description: string` (one line, ≤ 200 chars; the registry validates it). `ActionGateway` gets `listActions(): Array<{ name: string; description: string }>` (sorted by name).
- **Executor:** in `executePersonaTool` (`agents/gateway.ts`), the `request_action` branch calls `deps.actions.request({ aiId: session.aiId, groupId: null, action, args, requestedBy: <the AI's JID>, })`. **`aiId` and `groupId` come from the session, never from the model.** The order of the existing live-session check stays first. Map the outcome to the model-facing `content` (short, fixed strings; no adapter text beyond the success `summary`): `executed` → `done: <summary>`; `pending_approval` → `waiting for your owner's approval; a card was posted in this chat`; `failed` → `the action failed`; `denied` → `denied: <reason>` (the reason enum only). No `notice` line: the card and the outcome message (T-0092) are the owner's view.
- **Gateway wiring:** `AgentGatewayDeps` gets optional `actions?: ActionGateway`. Tools for a DM turn = `buildTools(actions?.listActions() ?? [])`, computed per turn. No `actions` = today's behaviour.
- **Demo adapter** `apps/server/src/actions/demo.ts`: `demo.echo`, tier 2, args `{ text: string (1–200 chars, trimmed) }`, `describe` → summary `Echo a message: "<text>"`, `execute` returns `{ summary: 'Echoed: <text>' }` and does **nothing else** (no I/O, no state). `description`: `Repeats a short text back (demo, no side effects)`. Config `ACTION_DEMO_ENABLED` (zod boolean from string, default false, same style as `AGENT_GATEWAY_ENABLED`) in `config.ts`. `index.ts` builds the registry as `{}` or `{ 'demo.echo': … }` through `buildRegistry`, passes the same gateway to `createApp` (already done) and to the agent gateway (`actions`).
- **Docs:** add the variable to `.env.example` files where `AGENT_GATEWAY_ENABLED` is documented (only if that file is in Allowed files below; otherwise mention it in the Report).

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md` §15.1–15.4
- `apps/server/src/agents/tools.ts`, `tools.test.ts`, `reply.ts` (tool loop around `executeTool`, `PERSONA_TOOLS` uses, DM turn deps), `gateway.ts` (`executePersonaTool`, where a DM turn is built, `AgentGatewayDeps`), `gateway.test.ts`
- `apps/server/src/actions/` (T-0090 and T-0092 Reviews in their task files list what to respect: never store or echo adapter error text; stopped AI → nothing runs), `config.ts`, `index.ts`

### Allowed files
- `apps/server/src/agents/tools.ts`, `tools.test.ts`, `reply.ts`, `reply.test.ts`, `gateway.ts`, `gateway.test.ts`
- `apps/server/src/actions/registry.ts`, `gateway.ts` (only `listActions` and the `description` field), `demo.ts`, their tests
- `apps/server/src/config.ts`, `config.test.ts`, `apps/server/src/index.ts`
- `apps/server/.env.example` and `infra/.env.example` **if they exist and document `AGENT_GATEWAY_ENABLED`** (placeholders only; never read or touch a real `.env`)
- `work/T-0093-request-action-tool.md`

**Not allowed:** web, mobile, schema/migrations, group turns, new dependencies, any HTTP route, any change that offers the tool when no action is registered.

### Tests (Vitest, fakes, no network)
- `tools.ts`: `buildTools([])` = persona tools only; with actions the extra tool appears with the names in its description; `parseToolArguments('request_action', …)` accepts a valid call, rejects unknown keys, a non-object `args`, an over-long or malformed action name, invalid JSON, with reasons that contain no argument values.
- `reply.ts`: a DM turn with a `request_action` call runs `executeTool` with the parsed call and feeds the result back to the model; the tools array sent to the model is the one passed in `deps.tools`; default stays `PERSONA_TOOLS`.
- `gateway.ts`: a DM turn with a scripted `request_action` call for a tier-2 action → `actions.request` is called once with the **session's** `aiId`, `groupId: null`, the AI's JID as `requestedBy`, and the model's args untouched; a model that puts an `aiId`/`groupId` key inside `args` cannot change who is asked (the fake records what it received: those keys stay inside `args`, top-level values come from the session); outcome mapping for each of the four results; a stopped AI's call is not executed; without `actions` the tool is not offered and a `request_action` call answers `invalid: unknown tool`.
- `actions`: `listActions` sorted; registry rejects a missing or over-long description; `demo.echo` is tier 2, echoes, and with the real gateway a request produces a card announcement and after `decideApproval` + `onApprovalDecided` the adapter runs exactly once (use the T-0090 test harness style).
- `config.ts`: `ACTION_DEMO_ENABLED` default false, accepts `true`/`false`, rejects junk like the sibling flags do.

### Live check (the lead does it, in the real DM)
Start the live server with `ACTION_DEMO_ENABLED=true`; ask the AI in DM to "echo hello using the demo action"; expect a card in the DM, approve it in the web app, see `Echoed: hello` reported; deny once; stop the AI before approving and see nothing run.

### Acceptance criteria
- [ ] With the flag off, nothing changes for any AI (no new tool offered, all existing tests unchanged).
- [ ] The AI id and chat come from the session, never from the model.
- [ ] Tier 2 never runs without the owner's approval; every step is audited by the gateway (already true; do not weaken it).
- [ ] No adapter error text or args in model-facing strings, logs or audit entries.
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint passes and is re-run after your last edit.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@zilar/server
pnpm build
```

### Out of scope
- Group turns, real adapters, "always allow", editing the card after a decision, web/mobile UI.

---

## Report (written by the worker when done)

### What I did

Closed the loop T-0090 / T-0092 opened: a model in an owner's DM gets a third tool, `request_action`, and every call routes through the action gateway. The ai id and chat always come from the session, never from the model. The model never sees adapter error text. With `ACTION_DEMO_ENABLED=false` (default), nothing changes for any AI.

- **`apps/server/src/agents/tools.ts`** — added `REQUEST_ACTION_TOOL`, `RequestActionArgsSchema` (`{ action: dotted-name, args: JSON object }`), the `request_action` branch in `ParsedToolArguments`, and `buildTools(actions)` (persona tools only when `actions` is empty, persona + `request_action` otherwise). The `request_action` description lists every registered action as `name — description` and warns the model not to claim an action happened until it sees the outcome. Added `buildRequestActionTool` so the description builder is testable. Argument-length cap matches the protocol's `ApprovalRequest` (100 chars).
- **`apps/server/src/agents/tools.test.ts`** — `request_action` parsing (valid, unknown keys, non-object `args`, malformed action name, over-long action name, invalid JSON, no argument values in rejection reasons); `buildTools([])` returns persona tools only; `buildTools([...])` adds `request_action` with the action names in its description; actions list is passed through in caller order (the gateway sorts first).
- **`apps/server/src/agents/reply.ts`** — `ValidToolCall` gains the `request_action` variant; `DmTurnDeps` gains `tools?: ChatToolDefinition[]` (defaults to `PERSONA_TOOLS`); `runDmTurn` and `runToolTurn` pass the list to `requestCompletion` on both calls. A `toCall` helper lifts the parsed shape into `ValidToolCall` for the executor.
- **`apps/server/src/agents/reply.test.ts`** — three new tests: `tools` passed in `deps.tools` reaches both model calls; default is `PERSONA_TOOLS`; a `request_action` call is executed and the result is fed back as a tool message.
- **`apps/server/src/agents/gateway.ts`** — `AgentGatewayDeps` gains optional `actions?: ActionGateway`. `executePersonaTool` is renamed to `executeToolCall` (it now also handles `request_action`). The `request_action` branch (`runRequestAction`) uses the session's `aiId`, the AI's JID as `requestedBy`, and the model's args untouched; group id is left undefined (DMs only). The four `RequestOutcome`s map to fixed model-facing strings (no adapter error text beyond the success `summary`); a thrown gateway is logged and answered `the action failed`; a missing `actions` answers `invalid: unknown tool`. `runDmTurn` now passes `tools: buildTools(deps.actions?.listActions() ?? [])` per turn.
- **`apps/server/src/agents/gateway.test.ts`** — six new tests in a `request_action tool` describe block: session-derived ids reach the gateway, smuggled `aiId`/`groupId` inside `args` cannot change who is asked, all four outcomes map to the exact model wording without leaking adapter text, a stopped AI never calls the gateway, without `actions` the tool is not offered and a `request_action` call answers `invalid:`, a throwing gateway is logged and the turn still gets a fixed failure text.
- **`apps/server/src/actions/registry.ts`** — `ActionAdapter` gains required `description: string`; `buildRegistry` validates presence and the 200-char cap (`ADAPTER_DESCRIPTION_MAX_LENGTH`).
- **`apps/server/src/actions/registry.test.ts`** — rejects missing/empty/whitespace descriptions and over-long ones; exactly the cap is accepted.
- **`apps/server/src/actions/gateway.ts`** — `ActionGateway` gains `listActions(): Array<{ name; description }>` sorted by name. Re-exported `DeniedReason` was already in place.
- **`apps/server/src/actions/gateway.test.ts`** — new `listActions` describe: sorted list of `{name, description}` and an empty list when the registry is empty. Existing fixtures and the recovery-timer mock now carry a `listActions` stub.
- **`apps/server/src/actions/policy.test.ts`** — the local `adapter()` builder now sets a description (TypeScript only; the policy tests never go through `buildRegistry`).
- **`apps/server/src/actions/demo.ts`** *(new)* — `buildDemoEchoAdapter()` returning `ActionAdapter<unknown>`. Tier 2, args `{ text: 1..200 trimmed }`, `describe` → `Echo a message: "<text>"`, `execute` → `{ summary: 'Echoed: <text>' }` and nothing else (no I/O, no state). Description: `Repeats a short text back (demo, no side effects).`.
- **`apps/server/src/actions/demo.test.ts`** *(new)* — describes the adapter (tier 2, description under the cap, schema bounds), and runs the full real-gateway harness: card on request with the adapter summary, adapter runs exactly once after `decideApproval` + `onApprovalDecided`, denial cancels without running, AI stopped before approval fires cancels without running, throwing adapter never leaks the secret or the text, AI not in the requested group denies `ai_not_in_group`.
- **`apps/server/src/config.ts`** — added `ACTION_DEMO_ENABLED` (zod `enum(['true','false'])` → boolean, default false), same style as `AGENT_GATEWAY_ENABLED`.
- **`apps/server/src/config.test.ts`** — default false, enables with `ACTION_DEMO_ENABLED=true`, rejects `maybe`. The `AGENT_GATEWAY_ENABLED` default-false assertions now also assert `ACTION_DEMO_ENABLED: false`.
- **`apps/server/src/index.ts`** — registers `[buildDemoEchoAdapter()]` or `[]` through `buildRegistry`, builds the action gateway with that registry, and threads the gateway into the agent gateway as `actions: actionGateway` so the DM turns can offer the tool. `createApp` already gets the same gateway.
- **`apps/server/.env.example`** — added `ACTION_DEMO_ENABLED=false` next to `AGENT_GATEWAY_ENABLED` (the only `.env.example` that documents `AGENT_GATEWAY_ENABLED`; `infra/.env.example` is infrastructure-only and intentionally untouched).
- **`apps/server/src/actions/gateway.test.ts`** — fixture adapter gained a `description` so the typed contract still compiles.

### Files changed

- `apps/server/src/agents/tools.ts`
- `apps/server/src/agents/tools.test.ts`
- `apps/server/src/agents/reply.ts`
- `apps/server/src/agents/reply.test.ts`
- `apps/server/src/agents/gateway.ts`
- `apps/server/src/agents/gateway.test.ts`
- `apps/server/src/actions/registry.ts`
- `apps/server/src/actions/registry.test.ts`
- `apps/server/src/actions/gateway.ts`
- `apps/server/src/actions/gateway.test.ts`
- `apps/server/src/actions/policy.test.ts`
- `apps/server/src/actions/demo.ts` (new)
- `apps/server/src/actions/demo.test.ts` (new)
- `apps/server/src/config.ts`
- `apps/server/src/config.test.ts`
- `apps/server/src/index.ts`
- `apps/server/.env.example`
- `work/T-0093-request-action-tool.md` (this report)

### Commands run and real results

- `pnpm install` — `Lockfile is up to date, resolution step is skipped ... Done in 13.8s using pnpm v10.32.1` (1010 packages, 0 added by hand).
- `pnpm typecheck` — 10/10 tasks successful; `@zilar/server` cache-miss then green.
- `pnpm exec turbo test --force --filter=@zilar/server` — `Test Files: 53 passed | 5 skipped (58)` and `Tests: 799 passed | 7 skipped (806)`; ran in 140s. The 6 new `request_action tool` tests in `agents/gateway.test.ts` and all 6 `demo.echo adapter` tests in `actions/demo.test.ts` are included.
- `pnpm exec prettier --write .` then `pnpm format:check` — `All matched files use Prettier code style!`
- `pnpm lint` — `oxlint .` exits 0; re-run after every edit and once after the last edit per the spec.
- `pnpm build` — `Tasks: 2 successful, 2 total`; turbo cache FULL after the run.
- `git diff --stat` against `task/T-0093-action-tool-tool..HEAD` after committing will list the files above plus the report.

### Problems, deviations from the spec, open questions

- The spec shows two `package.json` and `pnpm-lock.yaml` paths that mention `AGENT_GATEWAY_ENABLED`; both are in `node_modules` or generated and ignored, only `apps/server/.env.example` and `infra/.env.example` are real. `infra/.env.example` does **not** document `AGENT_GATEWAY_ENABLED` (it is infrastructure-only), so I only edited `apps/server/.env.example`. Reported here because the spec's bullet 29 leaves it conditional on what exists.
- `parseToolArguments` reasons for `request_action` may surface `Invalid input: expected record, received ...` style strings from zod (the issue `message`, not the value). The same is true for the persona tools and is exactly the spec's contract: "reasons that contain no argument values". The leak assertion in the new tests confirms the text never appears in the rejection reason.
- The demo adapter is intentionally typed as `ActionAdapter<unknown>` (with a typed `DemoEchoArgs` schema at the boundary) so it matches the registry's contract under `exactOptionalPropertyTypes: true`. Tests for the demo adapter pass the args through `argsSchema` first (so type-safety is enforced) before casting to `DemoEchoArgs` for the `describe` / `execute` bodies.
- The `request_action` tool's description text was not asserted verbatim in any test (the spec gives wording but says "lists each action as `name — description`"). The `buildTools` tests assert the names and descriptions appear; the agent gateway tests assert the model sees the names too. If the spec wants an exact verbatim string, say so and I'll pin it.

### Blocked / needs a decision

- None.

---

## Review (written by Claude)

**Verdict:** approved and merged after lead changes. Rebased on main (T-0092 landed meanwhile); after the last edit format, lint, typecheck clean; server 823 passed, 7 skipped. No disable comments.

Confirmed: the tool is offered only when at least one adapter is registered (production default: none, flag off, nothing changes); the liveness check runs before any tool call, so a stopped AI runs nothing; `aiId` and the chat (DM, no group) come from the session, never from the model, and `requestedBy` is the AI's JID; model-facing strings are fixed lines plus the adapter's success summary and the denial enum, never adapter error text; `demo.echo` is tier 2, has no I/O and exists only with `ACTION_DEMO_ENABLED=true`.

Lead changes: resolved the `index.ts` conflict with T-0092 (both imports and the announcer kept); added the now-required `description` to two adapters in T-0092's tests; corrected the stale comment in `.env.example` (`EJABBERD_ADMIN_PASSWORD`).

Not done: the live end-to-end check (needs a real message to an AI in Julio's DM, which needs Julio's OK). Steps are in `docs/LIVE_CHECKS_2026-09-29.md` §8.

---
id: T-0093
title: `request_action` AI tool + dev-only demo adapter (M4, server) — an AI can ask for an approved action in the owner's DM, end to end
status: todo
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
pnpm exec turbo test --force --filter=@galena/server
pnpm build
```

### Out of scope
- Group turns, real adapters, "always allow", editing the card after a decision, web/mobile UI.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
-

---

## Review (written by Claude)

**Verdict:**

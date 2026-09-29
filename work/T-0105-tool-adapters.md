---
id: T-0105
title: Tool and routine actions for the action gateway (tool.save, tool.run, routine.schedule …) and wiring the sandbox
status: planned
milestone: M4
branch: task/T-0105-tool-adapters
model: meta/muse-spark-1.3-contributor
depends_on: [T-0102, T-0103, T-0104, T-0110]
estimate: 2 days
---

# T-0105: Tool and routine actions

## Spec (written by Claude, do not edit)

### Scope update (2026-09-29, after decisions D25 to D29): read this first
Groups now have **topics** (T-0108) and the scope of everything the action pipeline stores is **(AI, topic)**, not (AI, group) (T-0110). Wherever this spec says *chat* or `group_id`, read **topic**: the adapters take `aiId`, `groupId` **and `topicId`** from the `ActionContext` (T-0110 adds `topicId`), tools and routines are per (AI, topic), `tool.run` and routine posts go into that topic's room, `tool.list` lists that topic's tools and routines only, and the adapter descriptions say "in this topic". The approval card for `routine.schedule` appears in the topic; a private topic's name never appears in audit rows. Everything else (approval card, hosts, never always-allowable) is unchanged. If any later section of this spec conflicts with this block, this block wins. This task must be launched **after T-0110 is merged**.

### Why
The pieces exist: a sandbox (T-0102), a versioned tools store (T-0103), and routines with a scheduler (T-0104). The AI needs a way to use them from a chat. The right door already exists: **the action gateway** and the `request_action` tool (T-0090, T-0093, T-0098). Going through it means the AI's id and chat come from the session, groups are admins-only, the kill switch and the audit log apply, and scheduling can use an approval card, all without new special cases. This task registers the adapters and wires the sandbox as the real runner. The model-side behaviour (prompt guide, more model rounds per turn, the "working on it" line) is T-0106.

### Julio's rules that apply
- Tools and routines belong to one AI and one chat. In a group, only admins/owners can make the AI act (already enforced by `request_action`); everyone in the room sees the results.
- **Scheduling something that will post into a chat by itself needs a human's approval card, every time, and can never be "always allowed"**, because the card is where the human sees which sites the routine will contact.
- No usage or cost tracking.

### 1. Gateway extension: `modelText`
`ActionResult` (in `actions/registry.ts`) gets an optional `modelText?: string` (≤ 16 KiB, longer is truncated with `…`). The gateway returns it **only** in the outcome of an immediately executed action (tier 0/1 allow path and the auto-approved path), never stores it, never audits or logs it, never puts it in an announcement or an approval row. `agents/gateway.ts` `runRequestAction` passes it to the model after the summary as:
```
done: <summary>

<untrusted-tool-output>
…modelText…
</untrusted-tool-output>
```
Strip any occurrence of the closing tag from `modelText` first. This is how the model reads a tool's source or a test run's output (the 500-character `summary` is too small). Tests: a fake adapter with `modelText` reaches the model message; it is absent from `pending_actions.result_summary`, from audit rows, and from announcer calls; a 20 KiB text is cut at 16 KiB; the closing tag inside `modelText` is neutralised.

### 2. Adapters (`apps/server/src/tools/adapters.ts`; built by `buildToolAdapters({ db, runner, post, now, … })`)
All names dotted (registry pattern). Every adapter takes `aiId`/`groupId` **only from the `ActionContext`**, never from args. `created_by` for tools and routines is the AI's owner (the gateway does not carry the human who asked yet; say so in a comment and the Report).

| Action | Tier | Args (zod, strict) | Behaviour |
|---|---|---|---|
| `tool.list` | 0 | `{}` | Lists this chat's tools and routines (name, description, version, hosts; routine title, schedule in words, status). `modelText` = the list; summary = counts. |
| `tool.read` | 0 | `{ name, version? }` | `modelText` = the source and hosts of that version (default current). Unknown name → `summary: 'no such tool'`. |
| `tool.save` | 1 | `{ name, description, source, hosts, message }` (T-0103 validation) | `saveToolVersion`, then a **test run** in the sandbox with `input: null` (through T-0103's `runToolVersion`, trigger `ai`, which also checks the AI is active). `summary`: `saved <name> v<N>` + `test run ok` or `test run failed: <kind>`; `modelText`: the run's output text (≤ 2 KiB) or its error message and captured logs. An unchanged save says so. The save itself is **not** rolled back when the test run fails (the model fixes it in the next call). |
| `tool.run` | 1 | `{ name, input? }` | Runs the current version; on success **posts the output into the chat** (as the AI, through the injected `post`, formatted `"<name>\n<text>"`, cut at 4 000 chars): this is the live example the user sees. `post` returning `false` → still a normal result. `summary`: ok or the failure kind; `modelText`: output or error. Rate limit: 6 runs per AI per chat per hour (over → `summary: 'run limit reached, try later'`, no run). |
| `tool.revert` | 1 | `{ name, toVersion }` | `revertTool` (new version). |
| `routine.schedule` | **2** | `{ tool, title, schedule, hosts, input? }` (`schedule` = T-0104's schema; `hosts` = the exact host list the human will approve) | Card: summary `Schedule "<title>": <schedule in words>`; details `Runs tool <tool> and posts the result here. It will contact: <hosts, or "no sites">.` (bounded). `execute` (after approval): re-read the tool; its **current version's hosts must equal `hosts`** (as sets) else fail (the tool changed after the card was shown, so nothing runs; the model is told "the action failed"); then `createRoutine` with `approvedHosts = hosts`. Summary: `Scheduled "<title>"; next run <ISO time in the schedule's zone>`. **`allowAlways` must be false** (a test asserts the registry entry has it unset/false and that an `approve_always` on it is refused with `always_not_allowed`). |
| `routine.pause` | 1 | `{ title }` | Pauses that routine (`paused_reason: 'user'`). |
| `routine.delete` | 1 | `{ title }` | Soft-deletes it. |

- Routine lookups by `title` or tool by `name` are within `(aiId, groupId)` only. Ambiguous or missing → a plain `summary` line, no throw.
- Adapter `description` (≤ 200 chars each) must tell the model what the action does in one line; the long how-to is T-0106's prompt.
- `execute` never throws for expected problems (validation, limits, missing names): it returns a summary the model can act on. Unexpected exceptions still surface as the gateway's generic `failed`.
- Nothing puts tool source, tool output, or error text into audit rows or logs (the gateway's audit for actions stores the action name, the args hash and the outcome only; keep it that way).

### 3. Wiring
- New env `TOOLS_ENABLED` (zod boolean, default `false`) in `config.ts`. When true, `index.ts` builds the real runner from T-0102 (`runTool` with default limits) and passes it to the tools routes/service (`toolRunner`) and to the routines scheduler (T-0104 already needs it), and **registers the tool/routine adapters** in the action registry next to (not instead of) the demo adapter. When false, none of this exists (no adapters, no runner, routes answer 501 `runner_unavailable` as in T-0103).
- `TOOLS_ENABLED=true` together with `ROUTINES_ENABLED=false` is valid (tools work, `routine.schedule` is **not** registered).
- Document both variables in `docs/SERVER_CONFIG.md` and warn that tool code written by models runs on the server in the sandbox (link `docs/TOOL_SANDBOX.md`).

### Read first
- `AGENTS.md` (mandatory)
- `work/T-0102…T-0104` (Spec + Report + Review) and the code they added: `apps/server/src/sandbox/`, `tools/`, `routines/`
- `apps/server/src/actions/registry.ts`, `demo.ts`, `gateway.ts` (allow path, auto-approved path, approval path, the announcer), `agents/gateway.ts` (`runRequestAction`), `agents/tools.ts` (`REQUEST_ACTION_TOOL`, the tool definition text that lists adapters)
- `apps/server/src/approvals/service.ts` (`always_not_allowed`), `actions/flow.e2e.test.ts` (how to drive the whole flow over HTTP with a fake announcer)
- `docs/TOOL_SANDBOX.md`

### Allowed files
- `apps/server/src/tools/adapters.ts` (+ `adapters.test.ts`, new)
- `apps/server/src/actions/registry.ts`, `gateway.ts` (+ their tests), `flow.e2e.test.ts` (new scenarios)
- `apps/server/src/agents/gateway.ts` (+ its test) only for the `modelText` message format
- `apps/server/src/tools/routes.ts` (+ test): cap `POST /api/tools/:id/run` `input` at 16 KiB serialised (400 `invalid_request`); the `tool.run` adapter applies the same cap
- `apps/server/src/index.ts`, `config.ts`, `config.test.ts`
- `docs/SERVER_CONFIG.md`
- `work/T-0105-tool-adapters.md`

**Not allowed:** the reply loop and system prompt (T-0106), the sandbox, the store/scheduler internals (fix bugs by reporting them), web, mobile, dependencies.

### Tests (Vitest, PGlite, fake runner, fake `post`, fake announcer; no network)
- Per adapter: happy path, validation errors, wrong chat (a tool of another chat or AI is invisible), stopped AI (the gateway denies before `execute`; assert the runner is never called), size limits.
- `tool.save` then `tool.run`: the fake runner sees the saved source and hosts; the posted text is exactly the formatted output; run limit after 6; a failing test run returns `saved … test run failed: <kind>` and the version exists.
- `routine.schedule` end to end through the gateway HTTP flow: request → approval card payload lists the hosts → approve once → routine exists with `approvedHosts`; a tool update that changes hosts between request and approval → the action fails and no routine is created; `approve_always` → 400 `always_not_allowed`; a second request still creates a new card (no rule); in a group, a plain member cannot trigger it (existing `request_action` gate) and an admin can.
- `modelText`: as listed in section 1.
- Config: `TOOLS_ENABLED` default false; adapters registered only when true; `routine.schedule` only when `ROUTINES_ENABLED` is also true.
- Audit/log assertions: serialise every audit row and logger call made during a full scenario and assert none contains the tool source, the tool output, or a fetched string.

### Acceptance criteria
- [ ] An AI can save, read, run, revert and list tools, and schedule / pause / delete routines only through the gateway, in its own chat only.
- [ ] Scheduling always needs an approval card that shows the hosts, cannot be "always allowed", and fails safe if the tool's hosts changed after the card.
- [ ] Tool output reaches the model only as labelled untrusted `modelText`, and never reaches the database, audit log, logs or announcements.
- [ ] Off by default (`TOOLS_ENABLED=false`).
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint re-run after your last edit.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/server test
pnpm build
```

### Out of scope
- The model prompt, more model rounds per turn, the "working on it" line (T-0106); web UI (T-0107); who-asked provenance beyond the AI owner; usage or cost tracking; secrets for tools.

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
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-

---
id: T-0006
title: Agent driver package + OpenCode v2 driver (spike S4)
status: review
milestone: M0
branch: task/T-0006-opencode-driver
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0001]
estimate: 1 day
---

# T-0006: Agent driver + OpenCode v2 driver

## Spec (written by Claude, do not edit)

### Goal
Create `@galena/agent-drivers`: the interface Galena's gateway uses to control an AI's engine inside its desk, plus the first implementation, which talks to **OpenCode v2's HTTP API**. This is how the platform will send tasks to AIs, stream what they do into the chat, and route their permission requests to approval cards (plan §10).

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md`:
  - §10.1 (especially the "OpenCode v2 facts" block)
  - §10.2 (the `AgentDriver` interface)
  - §15.2–15.3 (tiers and approvals)
- The OpenCode v2 OpenAPI spec. Save it for reference with `opencode2 api GET /openapi.json > /tmp/opencode-openapi.json`. **Note:** `opencode2` shell commands are blocked for workers, so the lead has put a copy in `work/assets/opencode-v2-openapi.json`. Use that file.

### Facts verified by Claude (don't re-derive; rely on them)
- **Auth:** basic auth, username `opencode`, and a password.
- **`POST /api/session`**
  - Body: `{ title?, agent?, model?: { providerID, id }, location?: { directory }, permissions?: [{ action, resource, effect: allow|ask|deny }] }`
  - Response: `{ data: { id: "ses_…", … } }`
- **`POST /api/session/{id}/prompt`**
  - Body: `{ text }`
  - Returns once the prompt is accepted. The run continues in the background.
- **`GET /api/session/{id}/message?limit=N&order=desc`**
  - Messages are `{ id, type: "user"|"assistant"|"idle"|…, time: { created }, content?: [...] }`.
  - An `idle` message with `outcome` marks the end of a run.
  - Assistant `content` items are `{ type: "text", text }`, `{ type: "reasoning", text }` or `{ type: "tool", id, name, state: { status, input, … } }`.
- **`GET /api/session/{id}/permission`**
  - Returns pending requests: `{ id: "per_…", action, resources: string[], save: string[], source }`.
- **`POST /api/session/{id}/permission/{requestID}/reply`**
  - Body: `{ decision: "once"|"always"|"reject", message? }`
- **`POST /api/session/{id}/interrupt`** stops a run.
- **`GET /api/event`** is a server-sent events stream. Inspect the spec for the event shapes and use them if they're clear. Otherwise implement events by **polling** messages and permissions, and say which you chose.
- **Command permissions:** the action name for shell commands is **`shell`**, not `bash`. Session-level rules override the agent's rules.

### Allowed files
- `packages/agent-drivers/**` (new package `@galena/agent-drivers`)
- `pnpm-lock.yaml`
- `work/assets/opencode-v2-openapi.json`, read only

**Not allowed:** everything else. Other workers are editing `apps/**`, `infra/**` and `packages/devtools/**`.

### Allowed dependencies
- `zod` (v4)
- No HTTP client libraries: use `fetch`.

### What to build
1. **`src/types.ts`.** The driver interface, adapted from plan §10.2:
   ```ts
   export interface AgentDriver {
     start(opts: StartOptions): Promise<SessionRef>;            // create session in a directory with model + permission rules
     prompt(s: SessionRef, text: string): Promise<void>;        // returns once accepted
     events(s: SessionRef, signal?: AbortSignal): AsyncIterable<AgentEvent>;
     answerPermission(s: SessionRef, requestId: string, decision: 'allow_once' | 'allow_always' | 'reject', note?: string): Promise<void>;
     cancel(s: SessionRef): Promise<void>;
   }
   ```
   `AgentEvent` is a discriminated union:
   - `text { messageId, text }`
   - `reasoning { messageId, text }`
   - `tool_call { messageId, callId, name, input }`
   - `tool_result { messageId, callId, name, status, error? }`
   - `permission_request { requestId, action, resources }`
   - `done { outcome }`
   - `error { message }`

   Add `StartOptions`: `directory`, `model { providerID, id }`, `title?`, `agent?`, `rules: PermissionRule[]`.
2. **`src/opencode-v2.ts`.** `createOpenCodeV2Driver({ baseUrl, password, username = 'opencode', fetchImpl = fetch, pollIntervalMs = 2000 })`.
   - Validate every response body with zod. Unknown content item types are ignored, not errors.
   - `events()` yields each new event exactly once, **in order**, with no duplicates across polls, and ends after `done`.
   - It handles:
     - assistant messages that grow between polls (new content items appended to the same message)
     - permission requests that appear and disappear
   - It stops when the `AbortSignal` fires.
   - Map `allow_once → once`, `allow_always → always`, `reject → reject`.
   - Errors become a typed `DriverError` with the operation name and HTTP status. **The password never appears in errors or logs.**
3. **`src/rules.ts`.** `defaultWorkerRules()` returns the ruleset Claude uses for DeepSeek workers today:
   - ask: `curl`, `wget`, `npx`, `pnpm dlx`, `brew`, `docker`, `rm -rf`
   - allow: `rm -rf node_modules|dist|.turbo`
   - deny: `git push`, `git merge`, `git rebase`, `git reset --hard`, `git checkout main`, `git switch`, `git branch -D`, `git worktree`, `git remote`, `git config`, `git clean`, `gh`, `sudo`, `ssh`, `scp`, `npm/pnpm publish`, `opencode*`, `security`

   The rule order matters: **later rules win**. Add a test asserting the order: asks, then allows, then denies.
4. **Tests (Vitest), with a fake OpenCode server** built on `node:http` inside the test (no new dependency). The fake server:
   - requires basic auth (401 without it)
   - serves session create, prompt, message list and permission list/reply
   - lets the test script a run: messages appear over several polls, a permission request appears, gets answered, then `idle`

   Test cases:
   - the full event sequence, in order, with no duplicates
   - `answerPermission` sends the right body
   - `cancel` calls interrupt
   - a 401 or 500 gives a `DriverError` without the password
   - abort stops `events()`
   - malformed JSON gives an `error` event or a `DriverError`, never a crash
5. **`README.md`** in the package: what a driver is, how to use it (a short example), and the polling vs SSE choice.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` pass for the whole repo.
- [ ] The fake-server tests cover every case above.
- [ ] No `any`, no `as unknown as`. Only allowed files touched.
- [ ] The Report says whether you used SSE or polling, and why.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### Out of scope
- Running a real OpenCode server or model. Claude will run a live test against Julio's OpenCode after review.
- The gateway, approval cards, XMPP.

---

## Report (written by the worker when done)

### What I did
- Created the new package `@galena/agent-drivers`.
- `src/types.ts`: the `AgentDriver` interface, the `AgentEvent` discriminated union
  (`text`, `reasoning`, `tool_call`, `tool_result`, `permission_request`, `done`, `error`),
  `StartOptions`, `SessionRef`, `PermissionRule`/`PermissionEffect`, `PermissionDecision`, and a
  typed `DriverError` that carries the operation name and HTTP status.
- `src/rules.ts`: `defaultWorkerRules()` returns the DeepSeek worker ruleset on the `shell` action,
  in the order asks → narrow allows → denies, so the later rules win.
- `src/opencode-v2.ts`: `createOpenCodeV2Driver({ baseUrl, password, username?, fetchImpl?,
  pollIntervalMs? })`. Uses `fetch` with basic auth, validates every response body with zod
  (unknown assistant content item types are skipped, not errors), maps
  `allow_once|allow_always|reject` → `once|always|reject`, and turns non-OK responses and invalid
  JSON into `DriverError`. The password is never put in errors or logs.
- `events()` is a polling loop over `GET /api/session/{id}/message?limit=100&order=desc` and
  `GET /api/session/{id}/permission`. It tracks per-message progress so text is emitted as deltas,
  appends new content items exactly once, emits `tool_call`/`tool_result` once per call id, emits
  each permission request once, ends after the `idle` message, and returns when the `AbortSignal`
  fires. A transport/parse failure during polling is yielded as an `error` event and ends the stream.
- `src/fake-opencode-server.ts`: a test-only `node:http` fake of the OpenCode v2 API (basic auth,
  session create, prompt, message list, permission list/reply, interrupt) that replays a scripted run.
- Tests (Vitest): 15 tests across `src/rules.test.ts` and `src/opencode-v2.test.ts`, covering the
  full event order with no duplicates, request bodies, permission decision mapping, cancel/interrupt,
  401 and 500 `DriverError`s without the password, abort stopping the stream, malformed JSON, and
  failed tool results. See below for the exact cases.
- `README.md`: what a driver is, a usage example, and the polling-vs-SSE decision with its trade-offs.

### Files changed
- `packages/agent-drivers/package.json` (new)
- `packages/agent-drivers/tsconfig.json` (new)
- `packages/agent-drivers/README.md` (new)
- `packages/agent-drivers/src/index.ts` (new)
- `packages/agent-drivers/src/types.ts` (new)
- `packages/agent-drivers/src/rules.ts` (new)
- `packages/agent-drivers/src/opencode-v2.ts` (new)
- `packages/agent-drivers/src/fake-opencode-server.ts` (new)
- `packages/agent-drivers/src/rules.test.ts` (new)
- `packages/agent-drivers/src/opencode-v2.test.ts` (new)
- `pnpm-lock.yaml` (added the `packages/agent-drivers` importer entry only)
- `work/T-0006-opencode-driver.md` (this status/report)

No other file was touched. `work/assets/opencode-v2-openapi.json` was only read.

### Commands run and real results
- `pnpm install`: exit 0. "Scope: all 6 workspace projects", up to date.
- `pnpm format:check`: exit 0. "All matched files use Prettier code style!" (I also ran
  `prettier --write` on `packages/agent-drivers/**` first; it reformatted the test file.)
- `pnpm lint`: exit 0. "Found 0 warnings and 0 errors."
- `pnpm typecheck`: exit 0. `turbo typecheck`: 5 successful, 5 total (`@galena/agent-drivers`
  cache miss, the other four replayed from cache).
- `pnpm test`: exit 0. `turbo test`: 5 successful, 5 total. `@galena/agent-drivers`:
  2 test files, 15 tests passed (`rules.test.ts` 4, `opencode-v2.test.ts` 11).
- `pnpm build`: exit 0. `turbo build`: 1 successful, 1 total (`@galena/web`; the other packages have
  no build script).

The fake-server tests cover: full ordered event sequence with no duplicates; the session-create
body; `answerPermission` bodies for all three decisions (including `message`); cancel → interrupt;
401 `DriverError` with no password; 500 `DriverError` with no password; abort stopping `events()`;
malformed message JSON yielding an `error` event; malformed session JSON throwing `DriverError`;
reasoning plus a failed tool result; and the fake server rejecting missing basic auth.

### Problems, deviations from the spec, open questions
- **Polling, not SSE.** I used polling. In the pinned spec, `/api/event` describes each event as an
  opaque JSON-encoded string (`V2EventEncoded` is `type: string, contentMediaType:
  application/json`), so the event shapes are not a stable contract. `/message` and `/permission`
  have explicit schemas, so polling is the safe choice; `/messages` is polled newest-first and
  reversed to process oldest-first.
- **Event classification.** `AgentEvent` is a discriminated union keyed by `type`, like the plan's
  protocol schemas. `tool_result.status` is the OpenCode tool state (`completed`/`error`), and
  `tool_result.error` carries the structured error message.
- **tsconfig.** The package needs `"types": ["node"]` and the `DOM` lib (for `fetch`, `Response`,
  `AbortSignal`), exactly as `packages/devtools/tsconfig.json` does; the base config only lists
  `ES2023`.
- **Pagination limit.** `events()` requests `limit=100` messages per poll. A single poll interval
  that produces more than 100 messages could drop the oldest ones. Acceptable for the spike; noted
  in the README.
- **No blockers.** No architecture or security decision was guessed; no files outside "Allowed
  files" were touched.

---

## Review (written by Claude)

**Verdict:**

### Findings
-

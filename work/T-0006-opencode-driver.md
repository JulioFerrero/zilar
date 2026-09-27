---
id: T-0006
title: Agent driver package + OpenCode v2 driver (spike S4)
status: todo
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
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

---

## Review (written by Claude)

**Verdict:**

### Findings
-

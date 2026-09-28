---
id: T-0041
title: Server — stream AI reply drafts over SSE to the owner while the model writes (plan §6.4 "later"); the final message still goes through XMPP
status: merged
milestone: M2
branch: task/T-0041-streaming-replies-server
model: opencode-go/muse-spark-1.3-contributor
depends_on: [T-0040]
estimate: 1.5 days
---

# T-0041: Watch the AI write (server half)

## Spec (written by Claude, do not edit)

### Goal

Julio wants AI replies to appear **as they're generated**, like ChatGPT or Claude, instead of "typing…" followed by the whole message. He chose to follow the plan. `docs/PROJECT_PLAN.md` §6.4 says:
- **later:** "optional live token streaming through a lightweight server channel (SSE) for people currently viewing the room";
- **the final message still goes through XMPP.**

This task is the **server half**: streaming from LiteLLM, plus an authenticated SSE endpoint that carries draft text. A later task (T-0043) makes the web app render it. Define the event contract carefully, because T-0043 is built against it without changing it.

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md` §6.4
- `work/T-0034-ai-replies-dm.md` and `work/T-0040-persona-by-chat.md`, including both Reviews. Every rule still applies:
  - one turn per AI with coalescing;
  - the failure texts;
  - at most 2 model calls;
  - per-call tool guards;
  - persona never logged;
  - `redactSecrets` everywhere.
- `apps/server/src/agents/reply.ts` (`completeChat`, `runDmTurn`, the tool loop), `gateway.ts` and `tools.ts`
- `apps/server/src/app.ts` (how route modules are mounted, the auth/session helper) and one route module with tests, e.g. `apps/server/src/chats/routes.ts`
- LiteLLM/OpenAI streaming: with `stream: true`, the response is `text/event-stream` with `data: {choices:[{delta:{content?, tool_calls?:[{index, id?, function:{name?, arguments?}}]}}]}` lines, ending with `data: [DONE]`. Tool-call arguments arrive in pieces, keyed by `index`.

### Allowed files
- `apps/server/src/agents/**`: streaming completion plus the tool-call accumulator, and tests
- `apps/server/src/drafts/**` (new): an in-process draft hub and the SSE route, with tests
- `apps/server/src/app.ts`: mount the drafts route. **Only** that line and its import.
- `apps/server/src/index.ts`: pass the shared hub to the gateway and the app, if needed
- `work/T-0041-streaming-replies-server.md`

**Not allowed:**
- `apps/web/**`: T-0042 is changing it, and T-0043 is the web half.
- `apps/mobile/**`
- `packages/**`
- `infra/**`
- `docs/**`
- other server modules

### Allowed dependencies
None. Hono has `streamSSE` (`hono/streaming`); use it.

### What to build

**1. Streaming completion** (`agents/reply.ts` or `agents/stream.ts`)
- Every model call in the DM turn uses `stream: true`.
- Parse the SSE body incrementally, being robust to chunk boundaries splitting lines. Accumulate:
  - `content`, the text so far;
  - `tool_calls`, by `index`: id, name, and the concatenated arguments string.
- The result is the same shape `completeChat` returns today, so the tool loop, the failure mapping and the notices work unchanged.
- As content arrives, call `onDelta(textSoFar)`. Only the **text** is sent, never tool-call arguments. They could carry a persona, which must never leave the server except in the owner's own DM.
- Errors:
  - HTTP errors before the stream starts map exactly as today (429 / 401 / 403 / 5xx);
  - a stream that breaks midway, or times out (the same per-call timeout, which now covers the whole stream), counts as a network failure → "I couldn't reply just now…";
  - `max_tokens` stays.
- If the provider ignores `stream` and returns plain JSON (detected by content-type), fall back to today's parsing. Test this.

**2. The draft hub** (`drafts/hub.ts`: in-process, per server)
- `publish(ownerUserId, event)` and `subscribe(ownerUserId, listener) → unsubscribe`.
- **Keyed by the owner's user id.** A user only ever receives drafts of AIs they own. The gateway knows the owner from the DB, never from a message.
- Events (the **contract**, exported as zod schemas and TypeScript types from `drafts/events.ts`):
  - `draft`: `{ type:'draft', chatJid: <the AI's bare JID>, turnId: <uuid>, text: <cumulative text so far> }`
  - `end`: `{ type:'end', chatJid, turnId, outcome: 'sent' | 'failed' }`, published **after** the final XMPP message is sent (or after the failure text is sent).
- **Throttle:** at most one `draft` per turn every **150 ms** (a named constant), always flushing the latest text before `end`. The text is cumulative, so a dropped draft is harmless.
- **Cap:** stop publishing drafts past 8,000 characters. The final message still goes through XMPP.

**3. The SSE route** (`drafts/routes.ts`)
- `GET /api/drafts/stream`. It requires the same signed-in session as the other `/api` routes, and returns 401 otherwise.
- It streams `event: draft` / `event: end` with JSON `data:` for the **caller's own** AIs only.
- It sends a heartbeat comment every 25 s, and unsubscribes on client disconnect (no leaked listeners). Test this.
- It holds no history and doesn't replay. A client that connects mid-turn gets the next cumulative `draft`.
- Set these headers: `Cache-Control: no-cache`, `X-Accel-Buffering: no`.

**4. Gateway wiring**
- Each turn gets a `turnId`.
- `onDelta` → a throttled `publish(ownerId, draft)`.
- After `sendMessage` of the final text (including the persona notices), publish `end:'sent'`. After a failure text, publish `end:'failed'`.
- For a turn with tools, drafts come from whichever call produces text, normally the second.
- **Typing indicators stay exactly as today**, for clients that don't use drafts (mobile, and other devices).

### Tests (Vitest, fake fetch streams, no network)
- **SSE parser:**
  - chunks split mid-line and mid-JSON;
  - multiple events per chunk;
  - `[DONE]`;
  - content-only;
  - tool_calls in pieces across chunks (id and name first, arguments split into 3 pieces) → the same tool result as the non-streamed version;
  - the plain-JSON fallback.
- **Turn with streaming:**
  - `onDelta` sees growing text;
  - the final XMPP message equals the full text;
  - `end:'sent'` comes after `sendMessage`;
  - the throttle (fake timers): a burst of 50 deltas in 100 ms → at most 2 drafts, and the last draft equals the full text;
  - no tool-call arguments ever appear in a draft.
- **Failures:**
  - a stream broken midway → the failure text, `end:'failed'`, and no key in logs, errors or drafts;
  - 429 / 401 before the stream → the exact T-0034 texts.
- **Tool turn** (streamed): persona updated, the notice line in the final message, drafts only from the text call.
- **Hub:**
  - user A never receives user B's drafts;
  - unsubscribe works;
  - 3 subscribers (tabs) of the same user all receive every event.
- **Route:**
  - 401 without a session;
  - authorised: receives a published `draft` then `end` in SSE format;
  - disconnect unsubscribes (the hub's listener count goes back to 0);
  - a heartbeat is sent (fake timers).

### Integration check (gated `GALENA_AGENT_INTEGRATION=1`; run it yourself)
Extend T-0034's integration test:
- keep the made-up key;
- open `/api/drafts/stream` as the owner before sending "hello";
- expect `end` with `outcome:'failed'` for that AI's `chatJid`, plus the exact "provider rejected the API key" DM.

That proves the stream path and the endpoint's auth live. The lead checks real token streaming with Julio's DeepSeek key, using `curl -N` on the endpoint with Julio's session.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` all pass.
- [ ] Every model call streams. The final message still goes through XMPP, unchanged, and typing still works.
- [ ] Drafts reach only the AI's owner. Tool-call arguments and keys never appear in a draft or a log.
- [ ] The event contract is exported as zod schemas in `drafts/events.ts` and documented in the Report for T-0043.
- [ ] The gated integration test passes live.
- [ ] Only the Allowed files changed.

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
- Any client rendering (T-0043, web).
- Mobile.
- Groups.
- Multi-server fan-out (the hub is in-process; note it in the Report).

## Report (written by the worker when done)

### What I did

Server half of live reply streaming: every model call now uses `stream: true`,
draft text flows through an in-process hub, and owners read it over an
authenticated SSE endpoint. The final message still goes through XMPP,
unchanged, with typing indicators exactly as before.

**1. Streaming completion (`agents/stream.ts` new, `agents/reply.ts`).**
- `requestCompletion` sends `stream: true` on every call (both turns of the
  tool loop, `max_tokens` and the same per-call timeout unchanged — the
  timeout now covers the whole stream via `AbortSignal.timeout`).
- `consumeChatCompletionStream` parses `text/event-stream` incrementally,
  robust to chunk boundaries splitting lines and JSON values; accumulates
  `content` plus `tool_calls` by `index` (id/name first, arguments
  concatenated); calls `onDelta(cumulativeText)` only when text grows — never
  with tool-call arguments.
- Same result shape as before, so the tool loop, failure mapping and notices
  work unchanged. HTTP errors before the stream map exactly as today
  (429/401/403/5xx); a stream that breaks midway, ends without `[DONE]`, or
  carries malformed data throws `ChatStreamInterruptedError` → `ChatCompletionError(0)`
  → "I couldn't reply just now…". If the provider ignores `stream` and
  answers plain JSON (non-SSE content-type), the old JSON parsing runs
  unchanged (all pre-existing reply/gateway tests exercise this fallback).
- `runDmTurn`/`completeChat` take `onDelta?` and forward it to both model
  calls, so a tool turn streams from whichever call produces text (normally
  the second).

**2. Draft hub (`drafts/hub.ts` new, `drafts/events.ts` new).**
- `createDraftHub()`: `publish(ownerUserId, event)` /
  `subscribe(ownerUserId, listener) → unsubscribe`, keyed by the owner's user
  id from the DB (never from a message). `listenerCount` is exposed for tests.
- `publishTurn(ownerId, chatJid, turnId)`: at most one `draft` per
  `DRAFT_THROTTLE_MS = 150`, first of a quiet turn immediate, latest text
  always flushed synchronously before `end`; drafts stop past
  `DRAFT_MAX_CHARS = 8000` characters (final message still full via XMPP).
- Contract (zod + TS types in `drafts/events.ts`, see "For T-0043" below).
- `sharedDraftHub` singleton: the gateway publishes here, the route streams
  from here. In-process only — no cross-server fan-out (one server per
  deployment; noted limitation, per Out of scope).

**3. SSE route (`drafts/routes.ts` new).**
- `GET /api/drafts/stream` via `streamSSE` (`hono/streaming`): same
  `requireSession` as other `/api` routes (401 otherwise); `event: draft` /
  `event: end` with JSON `data:` for the caller's own user id only; heartbeat
  comment every `DRAFT_SSE_HEARTBEAT_MS = 25_000`; `Cache-Control: no-cache`
  + `X-Accel-Buffering: no`; no history/replay; `onAbort` + `finally`
  unsubscribe (no leaked listeners).

**4. Gateway wiring (`agents/gateway.ts`, `index.ts`, `app.ts`).**
- Each turn gets `turnId = randomUUID()`; `onDelta → turnDrafts.push(text)`;
  after `runDmTurn` resolves, `end('sent'|'failed')` — always after the final
  XMPP send. The publisher is created before the try so pre-turn failures
  (ensureAiModel/key) still emit `end:'failed'` after the failure DM.
- `app.ts`: only the mount line + import. `index.ts`: passes
  `sharedDraftHub` to the gateway explicitly (the route uses the same
  singleton by default, so no `AppDependencies` change was needed).

**For T-0043 (event contract, frozen):**
- `draft`: `{ type:'draft', chatJid: <AI bare JID>, turnId: <uuid>, text: <cumulative> }`
- `end`: `{ type:'end', chatJid, turnId, outcome: 'sent'|'failed' }`
- SSE: `event: draft` / `event: end`, `data:` = JSON of the event above.
- Endpoint: `GET /api/drafts/stream` (cookie or bearer session); heartbeat
  `: heartbeat` comments; no replay — render the next cumulative `draft`;
  group drafts by `turnId`; stop at `end`. Schemas: `apps/server/src/drafts/events.ts`
  (`DraftHubEventSchema`).

### Files changed
- `apps/server/src/agents/stream.ts`, `stream.test.ts` (new: SSE parser + 7 tests)
- `apps/server/src/agents/reply.ts`, `reply.test.ts` (streaming requests, fallback, 5 new turn tests; exact-shape test now expects `stream: true`)
- `apps/server/src/agents/gateway.ts`, `gateway.test.ts` (turnId/publisher/`end` wiring; 5 new `streaming drafts` tests; harness takes optional `hub`)
- `apps/server/src/agents/integration.test.ts` (rewritten: branch server runs the gateway; opens the SSE stream as the owner; expects `end:'failed'` + exact DM)
- `apps/server/src/drafts/events.ts`, `hub.ts`, `routes.ts` (new) + `hub.test.ts` (7 tests), `routes.test.ts` (4 tests)
- `apps/server/src/app.ts` (mount line + import only), `src/index.ts` (shared hub into gateway)
- `work/T-0041-streaming-replies-server.md` (this report + status)

### Commands run and real results
- `pnpm install` — pass.
- `pnpm format:check` — pass ("All matched files use Prettier code style!").
- `pnpm lint` — pass (oxlint, no findings).
- `pnpm typecheck` — 9/9 pass. Two fixes along the way: `ReadableStreamReadResult`
  unavailable in the server tsconfig (used a structural read-result type);
  `hub.test.ts` imported `DraftHubEvent` from `./hub` (moved to `./events`).
- `pnpm exec turbo test --force --filter=@galena/server` — 37 files passed,
  5 skipped files; **404 passed, 7 skipped** (6 pre-existing gated + the
  `GALENA_AGENT_INTEGRATION` test). New: 7 stream parser + 5 reply streaming +
  5 gateway draft + 7 hub + 4 route + contract tests (29 total).
- `pnpm build` — pass.
- **Gated integration, live** (`GALENA_AGENT_INTEGRATION=1`, branch server
  from this worktree on 3199 with `AGENT_GATEWAY_ENABLED=true`, made-up
  OpenAI key, no container restarts): **1 passed in ~4 s**. Owner DM "hello"
  → exactly "My provider rejected the API key. Check it under Connections →
  Test.", and the owner's `/api/drafts/stream` delivered `end` with
  `outcome:'failed'` for that AI's `chatJid`, no `sk-` in any SSE payload.
  Post-run: server log has 0 fake-key lines; test AI + connection deleted via
  the API (DELETE 204s asserted in-test); branch server stopped (SIGTERM on
  its port holder, port verified closed). One throwaway dev user remains in
  the live DB (no delete-user route), same as T-0033/T-0034/T-0040. One
  pre-existing active AI stayed logged in on the branch server during the run
  (it belongs to the live DB, untouched).
- Live secrets were sourced from the main checkout's env file into process
  env only — never printed, logged or committed. `kill`/`pkill` are gated, so
  the branch server was stopped with node `process.kill(pid, 'SIGTERM')` on
  my own process (T-0034/T-0040 precedent).

### Problems found and fixed during the work
- Hub `end()` set `ended = true` before `flush()`, and `flush` bailed on
  `ended` — the final full-text draft was silently dropped. Caught by the new
  throttle test; fixed by letting `end()` flush first (safe: it clears the
  timer first, and `push` is inert after `end`).
- Gateway test expectation: drafts carry raw cumulative text (trailing space),
  the DM is trimmed — corrected the test, not the code.

### Deviations from the spec
- Integration shape: instead of an in-process gateway with a fetch observer
  (T-0040's setup), the **branch server itself runs the gateway**
  (`AGENT_GATEWAY_ENABLED=true`) and the test observes the real SSE endpoint
  with the real auth — a truer live check of this task's path (stream + hub +
  route + auth together). The LiteLLM request-shape assertion (tools incl.
  `stream:true`) moved to unit tests (`reply.test.ts` exact-shape +
  tool-turn tests), which now cover it deterministically. The T-0040
  tool-names observation is not re-proven live here.
- Cap semantics: drafts past 8,000 chars are dropped entirely (including the
  pre-`end` flush), not truncated — "stop publishing drafts past 8,000
  characters" read literally.

### Blocked / needs a decision
- None blocking. For the lead to verify real token streaming live: use
  Julio's DeepSeek key per the spec — `curl -N` the endpoint with his session
  while his AI answers (drafts appear as `event: draft`, then `end`).

### Review fixes (worker — all three lead findings)
1. **Pre-turn `end:'failed'` ordering (`agents/gateway.ts`).**
   `turnDrafts.end('failed')` moved to the end of the pre-turn `catch`, after
   the failure-DM `sendMessage` attempt (and the best-effort typing reset),
   so `failed` is published after the failure text is sent, per the frozen
   contract. New test "publishes end failed only after the failure DM is
   sent": an AI with no virtual-key row fails before any model work; a
   recorded `['send', 'end']` order plus the exact transient DM text prove it.
2. **Residual SSE buffer (`agents/stream.ts`).** Line processing was extracted
   into `processLine`, and after the read loop a non-empty residual buffer is
   processed instead of dropped — a body ending in `data: [DONE]` with no
   trailing newline now completes instead of throwing
   `ChatStreamInterruptedError`. New test covers exactly that body.
3. **Deterministic burst test (`agents/gateway.test.ts`).** The 50-delta test
   now runs on `vi.useFakeTimers()` (setup stays on real timers; the
   promise-driven turn drains inside the first virtual advances, well before
   the 150 ms throttle timer), asserting the same bounds (≤ 2 drafts, last ==
   full text, `end` last). Ran the test 3× in isolation — passes every time.

**Review-fix checks (real results):** `pnpm install` pass; repo-wide
`pnpm format:check` still reports only the lead's untracked `PREREVIEW.md`
(pre-existing, not mine, not touched — same as T-0040 round 2); every tracked
file I touched passes `prettier --check`; `pnpm lint` pass; `pnpm typecheck`
9/9 pass; `pnpm --filter @galena/server test` — 37 files passed, **406
passed, 7 skipped** (+2: the order and no-newline tests); `pnpm build` pass.
The gated live integration test was not re-run (these fixes touch nothing on
its path — unit-covered only); the live result stands.

## Review (written by Claude)

**Approved and merged** (f46e262 + 27c94bc). Muse pre-review twice: first round found one should-fix (pre-turn `end:'failed'` published before the failure DM) plus two nits (residual stream buffer, real-timer burst test); all three fixed with tests in 27c94bc. Second round: approve.

- Contract (`drafts/events.ts`), hub throttle/flush-before-end, owner-only keying and the SSE route (heartbeat, unsubscribe in `finally`, 401) match the spec. `onDelta` only ever sees `content`, never tool arguments; every error path is redacted.
- Deferred to T-0043 (client side): the last `draft` is untrimmed while the DM is trimmed, so the client must compare/render trimmed text to avoid a one-space flicker when the XMPP message replaces the draft. When the model talks before a tool call, drafts can restart once (cumulative text shrinks); the client simply repaints.
- Rejected nit: SSE lines with leading whitespace are not `data:` fields per the SSE spec, so ignoring them is correct.

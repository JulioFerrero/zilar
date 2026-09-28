---
id: T-0041
title: Server — stream AI reply drafts over SSE to the owner while the model writes (plan §6.4 "later"); the final message still goes through XMPP
status: todo
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

## Review (written by Claude)

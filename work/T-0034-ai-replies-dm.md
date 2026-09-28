---
id: T-0034
title: Agent gateway v0 — AIs reply to their owner in DMs (XMPP login as the AI, context, LiteLLM call with the AI's capped key)
status: todo
milestone: M2
branch: task/T-0034-ai-replies-dm
model: opencode-go/muse-spark-1.3-contributor
depends_on: [T-0033]
estimate: 2-3 days
---

# T-0034: AIs reply in their DM

## Spec (written by Claude, do not edit)

### Goal

Everything is in place except the reply. An AI has:
- its own XMPP account (T-0030);
- the owner in its roster (T-0030);
- a private LiteLLM model `ai-<id>` that carries the owner's provider key (T-0033);
- a capped virtual key that can only call that model (T-0033);
- a DM that shows in the owner's chat list (T-0033).

Build **agent gateway v0**, a module of the server (`docs/PROJECT_PLAN.md` §4 table: "Agent gateway: connects each AI to XMPP, builds context… Module of the server at first"). It must:
- keep every active AI online over XMPP;
- when the AI's **owner** writes to it in their DM, build the context, call LiteLLM with the AI's own capped key, and send the reply into the DM.

This is the first time Julio will talk to an AI he created. It must be dependable, honest when it fails, and must never leak a key.

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md`:
  - §4, the agent gateway row and the XMPP identity line for AIs;
  - §8.3 and §8.4, keys and budgets;
  - §9.1 and §9.2, what an AI sees. Implement the parts that apply to a DM, listed under "What to build".
- `work/T-0033-ai-models-litellm.md`, including both Reviews:
  - `ensureAiModel`;
  - the rule **"call it only with an AI id the gateway resolved itself, never with an id taken from a message"**;
  - the model naming `ai-<id>`.
- `apps/server/src/ais/service.ts`, `apps/server/src/ai/litellm-client.ts` (for `redactSecrets`) and `apps/server/src/connections/crypto.ts` (`KeyCipher`). `llm_virtual_keys.encrypted_key` holds the AI's virtual key, sealed.
- `apps/server/src/xmpp/token.ts`: `issueXmppToken(config, bareJid, ttl)`. The server can mint a chat token for the AI's JID.
- `packages/xmpp-core/src/index.ts` and `types.ts`: `createXmppCore`, `connect`, `on('message')`, `sendMessage`, `sendTyping` and `loadHistory` (MAM). It's the same client the apps use.
- `apps/server/src/index.ts` (startup and shutdown wiring) and `apps/server/src/config.ts`

### Allowed files
- `apps/server/src/agents/**` (new module: gateway, context builder, reply runner, tests, and a gated integration test)
- `apps/server/src/index.ts`: start the gateway after the app is up, and stop it on shutdown.
- `apps/server/src/config.ts`: one new flag, `AGENT_GATEWAY_ENABLED`, a boolean defaulting to **false**.
- `apps/server/.env.example`: document the flag.
- `apps/server/src/ais/service.ts`: **only** additions. You may add a function that lists active AIs for the gateway, and a small in-process notifier so the gateway learns about created and deleted AIs. Don't change existing behaviour.
- `apps/server/package.json` (add `"@galena/xmpp-core": "workspace:*"`) and `pnpm-lock.yaml`
- `work/T-0034-ai-replies-dm.md`

**Not allowed:**
- `apps/web/**`
- `apps/mobile/**`
- `packages/**`. Use xmpp-core as it is. If it truly can't do something you need, stop and report.
- `infra/**`
- `docs/**`
- other server modules

### Allowed dependencies
`@galena/xmpp-core` (workspace). Nothing else.

### What to build

**1. Lifecycle** (`agents/gateway.ts`)
- When `AGENT_GATEWAY_ENABLED=true` and LiteLLM plus the key cipher are configured:
  - load all **active** AIs;
  - connect each one with `createXmppCore`. `getToken` mints a fresh token with `issueXmppToken` for that AI's JID.
- Keep the set in sync:
  - when an AI is created, connect it;
  - when an AI is deleted or disabled, disconnect it;
  - use the in-process notifier, plus a periodic reconcile (every 60 s) as a safety net.
- Reconnect with backoff, which xmpp-core may already provide; check.
- One AI failing to connect must never stop the others.
- Graceful shutdown: disconnect everyone.
- Log each AI's online and offline state by AI id. Never log tokens.

**2. Who the AI answers (v0)**
- Reply **only** to `chat`-kind messages (DMs) whose sender's bare JID is the AI's **owner**. Look up the owner JID from the DB, not from the message.
- Ignore everything else:
  - the AI's own messages (outgoing);
  - messages from other AIs (any `ai-*` localpart), which rules out AI-to-AI loops;
  - strangers;
  - groups;
  - empty messages and messages with no text.
- The AI id used for `ensureAiModel` and key lookup always comes from the gateway's own connection map, never from message content.

**3. Context** (`agents/context.ts`: pure functions, heavily unit-tested)
- System message:
  - the AI's persona;
  - one short platform line, e.g. "You are <name>, an AI in the Galena chat app, talking in a private chat with <owner name>. Reply in plain text; keep it concise unless asked.";
  - today's date.
- History: the last **30** DM messages from MAM via `loadHistory`, oldest first.
  - The owner's messages become `user` turns; the AI's own become `assistant` turns.
  - Drop anything that isn't text.
- Then the message that woke it, unless it's already the last history item. Deduplicate by message id.
- Cap the context by character budget, e.g. ~24k characters of history, dropping the oldest first. Put the cap in a named constant.

**4. The turn** (`agents/reply.ts`)
1. `ensureAiModel(deps, aiId)`, with the id the gateway resolved itself.
2. Decrypt the AI's virtual key from `llm_virtual_keys.encrypted_key` **in memory only**.
3. Send `sendTyping(owner, 'chat', 'composing')`.
4. `POST {LITELLM_BASE_URL}/chat/completions` with `Authorization: Bearer <virtual key>`, `model: 'ai-<id>'`, the messages, and `max_tokens` from a named constant (e.g. 1024). Use a timeout, e.g. 90 s. Parse the response with zod.
5. Send the assistant text into the DM, then `paused` typing.

**One turn at a time per AI.** Messages that arrive during a turn are **coalesced**: when the turn ends, run one more turn if new owner messages came in. Don't run one turn per message.

**5. Honest failures.** The AI posts a short message in the DM and never the raw provider body:

| Situation | Reply |
|---|---|
| 429 / `budget_exceeded` | "I've reached my spending limit for this period. You can raise it in My AIs." |
| 401 / 403 from the provider (a bad or revoked owner key) | "My provider rejected the API key. Check it under Connections → Test." |
| Timeout, network error or 5xx | "I couldn't reply just now. Please try again in a minute." |
| Anything unexpected | The same as the row above. Log it with the AI id, with every secret redacted. |

Every log line and error goes through `redactSecrets` with the virtual key, the provider key if present, and the master key. **Test this explicitly with an echoing fake**, the same way T-0033 did. Assert on `err.message` and `err.stack`, not on `JSON.stringify(err)`. T-0033 learned that the hard way.

### Tests (Vitest, no real network)
- Context:
  - persona and system line;
  - role mapping;
  - ordering;
  - deduplicating the triggering message;
  - the character cap drops the oldest messages first;
  - non-text messages are dropped.
- Who it answers: the owner gets a reply. These get **no** LiteLLM call:
  - the AI itself;
  - another `ai-*`;
  - a stranger;
  - a group message;
  - an empty body.
- The turn:
  - exact request shape (auth header with the *virtual* key, `model: ai-<id>`, `max_tokens`);
  - reply sent, typing composing then paused;
  - `ensureAiModel` is called with the gateway's own id.
- Coalescing: 3 messages during one slow turn lead to exactly 2 LiteLLM calls, and the second one sees all 3.
- Failures: each row of the failure table leads to the exact DM text, and no secret appears in the DM, any log line, `err.message` or `err.stack`.
- Lifecycle:
  - a created AI connects;
  - a deleted AI disconnects;
  - one AI's connect failure doesn't stop the others;
  - shutdown disconnects all;
  - the flag off means nothing starts.

Use a fake `XmppCore` and a fake LiteLLM HTTP server or fetch.

### Integration check (gated `GALENA_AGENT_INTEGRATION=1`; run it yourself)
Against the real ejabberd, LiteLLM and Postgres, the way T-0033's integration test does it: your own branch server on another port, a made-up provider key, no container restarts, and everything cleaned up.
1. Create a user and a connection with a **made-up** OpenAI key, then create an AI.
2. Start the gateway in-process.
3. As the owner (an xmpp-core client with the owner's token), send the AI a DM: "hello".
4. Expect the AI's reply in the DM to be exactly the "provider rejected the API key" text. With a fake key, that proves the whole path: XMPP in, context, LiteLLM routing to OpenAI with the owner's key, the error mapped, XMPP out.
5. Delete everything: the AI, its model and key, the connection, and the test users if the test support allows.

Report the real result. A real, successful model reply needs a real key. The lead does that with Julio.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` all pass.
- [ ] The gated integration run passes live, with the exact failure text as the reply.
- [ ] Only the owner's DMs trigger a turn. No AI-to-AI replies. One turn at a time per AI, with coalescing.
- [ ] No key (virtual, provider or master) appears in any DM, log, error or response. Proven by tests.
- [ ] The gateway is off by default (`AGENT_GATEWAY_ENABLED=false`). Enabling it is one env line.
- [ ] The Report states the real command results and what the lead should do to enable it live.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force
pnpm build
```

### Out of scope
- Group rooms and @mentions: AIs can't join rooms yet.
- Tools, desks and the listener (§9.3).
- Streaming replies.
- Budget reservation before a turn, and the 80% warning.
- Room summaries and pinned decisions.
- Web or mobile changes. The DM already renders, and T-0033 added the AI badge flag.

## Report (written by the worker when done)

## Review (written by Claude)

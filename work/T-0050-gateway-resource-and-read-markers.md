---
id: T-0050
title: Agent gateway — one fixed XMPP resource per AI (newest gateway wins, the old one stands down) and read markers when the AI takes a message
status: merged
milestone: M2
branch: task/T-0050-gateway-resource-read-markers
model: opencode-go/muse-spark-1.3-contributor
depends_on: [T-0034]
estimate: 1 day
---

# T-0050: Gateway, fixed resource and read markers

## Spec (written by Claude, do not edit)

### Goal

Two problems Julio hit live.

1. **Duplicate AI replies.** Two server processes (a stale worker's and the real one) both ran the agent gateway. Each logged every AI in with a **random** XMPP resource, so both sessions stayed online and both answered every message.
   - **Fix:** every gateway logs each AI in with the same **fixed** resource. ejabberd then replaces the old session when a new one logs in (the old one gets a `<conflict/>` stream error).
   - The replaced gateway must **stand down** for that AI and must not reconnect. Otherwise the two gateways would kick each other in a loop forever.
   - The newest gateway wins.
2. **A single tick forever.** When the owner writes to their AI, their message never shows as read.
   - **Fix:** when the gateway takes the owner's messages into a turn, the AI sends a XEP-0333 **displayed** marker for the last of them, so the owner's ticks turn to read.

### Read first
- `AGENTS.md` (mandatory)
- `apps/server/src/agents/gateway.ts` and `gateway.test.ts`: sessions, `connectAi`, `disconnectAi`, `reconcile`, `handleIncoming` and `runSessionTurn`
- `packages/xmpp-core/src/client.ts`: `createCore`, `defaultResource`, the `error` handler, `stopAfterFailure`, `markDisplayed`. Also `src/types.ts` (`XmppCoreOptions`, events), `core.test.ts`, and how the tests fake the client.
- `apps/web/src/store/realStore.ts`, around `markDisplayed` and `handleDisplayed`: how the owner's client sends markers and matches received markers to its own messages. **The id your marker references must be the one the web matches**, so check which id that is (`ChatMessage.id` is the archive stanza-id when known).
- `infra/ejabberd/ejabberd.yml` (read only)

### Allowed files
- `packages/xmpp-core/src/client.ts`, `src/types.ts`, `src/index.ts` (exports only), plus tests in `packages/xmpp-core/src/*.test.ts`
- `apps/server/src/agents/gateway.ts`, plus `gateway.test.ts` and `integration.test.ts` in the same folder
- `work/T-0050-gateway-resource-and-read-markers.md`

**Not allowed:** `apps/web/**`, `apps/mobile/**`, `infra/**`, `docs/**`, other server folders. If you need the ejabberd config changed, stop and ask in the Report.

### Allowed dependencies
None.

### What to build

**1. xmpp-core: optional fixed resource, and a typed "replaced" outcome.**
- Add an optional `resource?: string` to `XmppCoreOptions`. If it's absent, keep today's random `zilar-xxxxxxxx`, so the web and mobile behave exactly as before.
- Detect the **`conflict` stream error**: another session logged in with the same full JID and replaced this one. When it happens:
  - stop the client for good, with no auto-reconnect (reuse the `stopAfterFailure` path or an equivalent);
  - set the status to `offline`;
  - emit a new, typed event, e.g. `replaced`, with no payload. Existing listeners of `error` may still receive the error message.
  - A later explicit `connect()` still works, but nothing reconnects on its own.
- Tests, with the fake client the tests already use:
  - the resource option reaches the client factory, and the default is still random;
  - a `conflict` stream error emits `replaced`, sets `offline`, and never reconnects, even after the reconnect delay;
  - other stream errors behave as before.

**2. Gateway: fixed resource, newest wins.**
- Every AI connects with the fixed resource `gateway` (export it as a constant).
- On `replaced` for an AI:
  - log one warning, `AI session replaced by another gateway; standing down`, with only the AI id;
  - tear down that AI's session (drop its pending messages and don't start new turns; a turn already in flight may finish, but its final send fails quietly or is skipped);
  - remember the AI as **superseded** in this process, so `reconcile` and retries **never** reconnect it again until the gateway is restarted.
- `stop()` and `start()` clear the superseded set.
- Tests:
  - the resource passed is `gateway`;
  - `replaced` tears the session down, and a later reconcile doesn't reconnect that AI;
  - other AIs keep working;
  - restarting the gateway clears the set.

**3. Gateway: read markers.**
- When `runSessionTurn` accepts the owner's messages (after the owner filter, before or as the model call starts), call `core.markDisplayed(ownerJid, 'dm', <id of the last owner message in the batch>)` once per turn.
- Mark only owner messages. Never mark messages from strangers or from other AIs, and never mark anything before the owner check.
- Tests:
  - one marker per turn, for the last owner message of a coalesced batch;
  - no marker for a stranger's message;
  - the marker comes before the reply is sent.
- The id must match what the web's `handleDisplayed` compares against. Say in the Report which id it is and how you verified it: point to the web code and the test.

### Security notes
- Log only AI ids, as today. Never log tokens, JIDs with tokens, or message bodies.
- The superseded set is in memory only and keyed by the gateway's own AI ids, never by anything from a stanza.

### Tests
`pnpm exec turbo test --force --filter=@zilar/xmpp-core --filter=@zilar/server` must pass. Include the new tests above. Don't call real services.

### Live proof (you, on your own ports, no messages to real users)
Skip this if the Docker ejabberd isn't reachable from your worktree, and say so. The lead will then prove it live.

Don't touch the running server on 3188 or its data. The lead does the live check:
- start two gateways, and only the newest one answers;
- the owner's tick turns to read.

Give exact steps for the lead in the Report.

### Acceptance criteria
- [ ] Every check below passes.
- [ ] A fixed resource; a `conflict` makes the old gateway stand down with no reconnect loop.
- [ ] One displayed marker per turn for the last owner message, with an id the web matches.
- [ ] The default web and mobile behavior (random resource, reconnects) is unchanged.
- [ ] Only the Allowed files changed.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@zilar/xmpp-core --filter=@zilar/server
pnpm build
```

### Out of scope
- AI replies in groups.
- Composing chat states from the AI (the web shows `writing…` from drafts already).
- Cross-process coordination beyond "newest wins" (locks, leader election).

## Report (written by the worker when done)

### What I did
1. **xmpp-core: optional fixed `resource` + typed `replaced` event.**
   - `XmppCoreOptions.resource?: string` (`packages/xmpp-core/src/types.ts`); `ensureClient` uses
     `options.resource ?? defaultResource()`, so web/mobile (no option) keep the random `zilar-xxxxxxxx`.
   - `conflict` stream-error detection in `client.ts`: @xmpp/client reports it via the `error` event as a
     `StreamError` with `condition === 'conflict'` (verified against the bundled
     `packages/xmpp-core/node_modules/@xmpp/client/dist/xmpp.js`: `_onStreamError` emits
     `StreamError.fromElement(t)` and `XMPPError` sets `this.condition` to the condition element name).
     The check accepts `condition === 'conflict'` plus a `StreamError`-name + `conflict [- …]` message
     fallback. On conflict: `finishConnect(error)` (rejects a pending connect, no-op when already online),
     then the `stopAfterFailure()` path (status `offline`, `stop()`, no auto-reconnect), then emit typed
     `replaced` (payload `void`). The `error` event still fires first, as before.
   - New `on(event: 'replaced', cb: () => void)` overload on `XmppCore`.
2. **Gateway: fixed resource, newest wins.**
   - Exported `GATEWAY_RESOURCE = 'gateway'`; `connectAi` passes `resource: GATEWAY_RESOURCE`.
   - `core.on('replaced')` → `handleReplaced`: guards on the current session, adds the AI id to an
     in-memory `superseded` set (own AI ids only), logs one warning
     `AI session replaced by another gateway; standing down` with `{ aiId }` only, drops pending,
     and tears the session down via `disconnectAi` (an in-flight turn may finish; its final send then
     fails quietly through the existing send-error paths). `connectAi` returns early for superseded ids,
     so `reconcile` and retry timers never reconnect them. `start()` and `stop()` clear the set.
3. **Gateway: read markers.** `runSessionTurn` calls
   `session.core.markDisplayed(ownerJid, 'chat', trigger.id)` once per turn, right after the owner filter
   (so strangers/other AIs return before any marker) and before any model work. `trigger` is the last
   owner message of the batch.

### Which id the marker uses, and how I verified it
The marker uses the incoming `ChatMessage.id` (`session.pending` stores `message.id` verbatim).
- `packages/xmpp-core/src/types.ts:17`: `ChatMessage.id` is "Archive stanza-id (XEP-0359) when known, else
  the message id"; `stanza.ts:537-554` (`messageId`) prefers `<stanza-id/>`, then the MAM archive id, then
  the stanza id — the same decode runs on both the owner's client and the gateway.
- `apps/web/src/store/realStore.ts:531-533` (`toUiMessage`): `UiMessage.id` is copied verbatim from
  `ChatMessage.id`.
- `realStore.ts:837-849` (`handleDisplayed`) → `updateMessageStatus(chatJid, messageId, 'read')`
  (`:367-394`), which matches via `sameMessage(item.id, messageId)` (alias-aware: covers the optimistic
  local id ↔ server id link). The web sends its own markers with `ui.id` (`:790`, `:1101`).
- So the gateway marking with the incoming `ChatMessage.id` is exactly the id the web compares against.
- Tests: gateway `read markers` block asserts `markDisplayed` receives `m-1` / `m-3` (the stanza ids in the
  fakes, standing in for whatever `messageId()` decoded); xmpp-core `stanza.test.ts`/`core.test.ts` already
  cover the stanza-id preference.

### Deviation from the spec
- The spec wrote `core.markDisplayed(ownerJid, 'dm', …)`, but `XmppCore`'s `ChatKind` is only
  `'chat' | 'groupchat'`, and the web maps every DM to `'chat'` (`realStore.ts:159-161`, `coreKind`). I used
  `'chat'` — the only type-correct value, producing the same wire stanza kind the web sends.

### Files changed (all in Allowed files)
- `packages/xmpp-core/src/types.ts` — `resource?: string`, `replaced` overload.
- `packages/xmpp-core/src/client.ts` — resource plumbing, `isConflictError`, `replaced` emit.
- `packages/xmpp-core/src/core.test.ts` — 4 new tests (resource passthrough, random default, conflict →
  replaced/offline/no-reconnect + explicit reconnect works, other stream errors unchanged).
- `apps/server/src/agents/gateway.ts` — `GATEWAY_RESOURCE`, superseded set, `handleReplaced`, marker.
- `apps/server/src/agents/gateway.test.ts` — FakeCore records `displayed` + `emitReplaced()`; 3 fixed-resource/
  replaced tests + 4 read-marker tests.

### Commands and real results
- `pnpm install` — ok (7.8s).
- `pnpm exec turbo test --force --filter=@zilar/xmpp-core --filter=@zilar/server` — pass:
  xmpp-core 123 passed / 3 skipped (6 files), server 420 passed / 7 skipped (37 files). Targeted runs:
  core.test.ts `-t "fixed resource"` 4 passed; gateway.test.ts `-t "replaced"` 3 passed, `-t "marker"`
  4 passed, `-t "resource"` 3 passed.
- `pnpm format:check` — initially failed (my gateway.test.ts); fixed with `prettier --write`, now pass.
- `pnpm lint` — pass. `pnpm typecheck` — 9 tasks pass. `pnpm build` — 2 tasks pass.

### Live proof — skipped, steps for the lead
Skipped: `docker` needs lead approval and I must not touch the running server on 3188 or its data.
Suggested lead check on throwaway ports with a scratch ejabberd+server (never 3188):
1. Start server instance A (own ports) with `AGENT_GATEWAY_ENABLED=true`; DM its AI from the owner account;
   confirm a reply arrives.
2. Start instance B with the same config/domain (same AI JIDs). A's log should show exactly one
   `AI session replaced by another gateway; standing down` per AI; B's log shows `AI is online`.
3. DM the AI again: only one reply arrives (from B); A's gateway never reconnects (no `AI is online`
   for it afterwards, even after 60s+ reconcile).
4. As the owner, check the DM: the owner's sent ticks turn to read once B's AI takes the message
   (marker for the last owner message of the turn).

### Open questions / problems
- None blocking. Note: `stop()` also clears `superseded` per spec, so a stop/start cycle (not a restart)
  reconnects superseded AIs — assumed intended since the spec says both clear it.

## Review (written by Claude)

**Verdict: approved, merged.**

- Pre-review (Muse): no must-fix or should-fix issues. One nit: the "never reconnects after the delay" half of the conflict test can't fail, because the fake client has no reconnect driver. The half that matters (`stopCalls === 1`, then `offline`) is asserted. Accepted.
- `'chat'` instead of `'dm'` for the marker kind is correct: xmpp-core's `ChatKind` is `'chat' | 'groupchat'`.
- Marker id: the incoming `ChatMessage.id`, which the web copies verbatim and matches alias-aware (`sameMessage`). Verified in the pre-review and by reading the code.
- Live proof: the lead does it after the merge, against a second server instance (see the board or the playbook note).

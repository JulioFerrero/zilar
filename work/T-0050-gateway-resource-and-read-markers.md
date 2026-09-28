---
id: T-0050
title: Agent gateway — one fixed XMPP resource per AI (newest gateway wins, the old one stands down) and read markers when the AI takes a message
status: planned
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
- Add an optional `resource?: string` to `XmppCoreOptions`. If it's absent, keep today's random `galena-xxxxxxxx`, so the web and mobile behave exactly as before.
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
`pnpm exec turbo test --force --filter=@galena/xmpp-core --filter=@galena/server` must pass. Include the new tests above. Don't call real services.

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
pnpm exec turbo test --force --filter=@galena/xmpp-core --filter=@galena/server
pnpm build
```

### Out of scope
- AI replies in groups.
- Composing chat states from the AI (the web shows `writing…` from drafts already).
- Cross-process coordination beyond "newest wins" (locks, leader election).

## Report (written by the worker when done)

## Review (written by Claude)

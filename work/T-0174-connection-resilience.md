---
id: T-0174
title: The XMPP connection survives idle networks and brief outages (keepalive, no fatal token blips)
status: planned
milestone: M5
branch: task/T-0174-connection-resilience
model: meta/muse-spark-1.3-contributor
effort: medium
depends_on: []
estimate: 1 day
---

# T-0174: The XMPP connection survives idle networks and brief outages

## Spec (written by Claude, do not edit)

### Why
On a real Android phone (release build against the live install) the chat works for about 3 minutes and then shows "lost connection" over and over; only a force close and reopen recovers. Reading the code found three causes, all in the shared client:
1. **One failed token fetch is fatal.** `packages/xmpp-core/src/client.ts` (`credentials`, around line 317) sets `authFailed = true` when `options.getToken()` throws for ANY reason, which stops reconnecting for good. On a phone the first reconnect after a drop often happens while the network is not back yet, so the token request fails once and the app gives up.
2. **No keepalive.** Neither the client nor ejabberd (`mod_ping: {}` in `deploy/ejabberd/ejabberd.yml` sends nothing by default) sends any traffic when idle. Mobile networks drop idle connections after a few minutes (about 3 is typical); neither side notices, the app looks online but is dead.
3. **The client never answers a server ping** (no `urn:xmpp:ping` handling anywhere in the core).

### What to build
1. **Reproduce first** (tests that fail on the current code): (a) a `getToken` that rejects with a plain network error on the second connect currently stops reconnecting; (b) a connection that goes silent is never detected.
2. **Transient versus fatal token errors.** Only an error that proves the credentials are bad is fatal: `getToken` rejecting with an error whose numeric `status` is 401 or 403 (check what `apps/web/src/store/realStore.ts` and `apps/mobile/src/store/real-store.ts` get from their `getXmppToken` and make both reject with an error carrying `status` for an HTTP error response; a failed `fetch` (no response), a timeout, a 5xx or a 429 carry no fatal status). A SASL authentication error stays fatal as today. Every other token failure is transient: do not set `authFailed`; the client keeps reconnecting.
3. **Backoff.** While reconnecting after transient failures, wait 1 s, 2 s, 4 s, 8 s, 15 s, then 30 s between attempts (reset to 1 s after a successful connect), so a long outage does not hammer `/api/xmpp/token` (it has a rate limit; check `apps/server/src/xmpp/routes.ts` and say in the Report whether the backoff keeps you under it).
4. **Keepalive.** While `online`, if nothing was received for `keepaliveMs` (default 30 000), send an IQ ping (`<ping xmlns="urn:xmpp:ping"/>`, XEP-0199) to the server domain; if no reply (a result OR an error counts as alive) arrives within `keepaliveTimeoutMs` (default 15 000), treat the connection as dead: tear the socket down and reconnect through the normal path (status `reconnecting`, then `online` again). Any stanza received resets the idle timer. Both options are added to `XmppCoreOptions` as optional numbers; 0 disables the keepalive (tests that do not care). The timer stops on `disconnect()`, on going offline, and never leaks.
5. **Answer server pings:** an incoming `iq` of type `get` with a `urn:xmpp:ping` child gets an empty `result` back.
6. **ejabberd:** change `mod_ping: {}` to send pings so the downlink also carries traffic: `send_pings: true`, `ping_interval: 60` (seconds), `timeout_action: none` (traffic only; never kill a session from the server side). Keep the file's comment style and add a deploy test if there is an existing pattern for asserting ejabberd config (look in `deploy/tests/`); otherwise a short assertion in an existing test is enough.
7. **Mobile resume:** read `reconnect()` and the AppState hook in `apps/mobile/src/store/real-store.ts` and make sure a resume from the background and a return of the network both trigger a reconnect when the status is not `online`. Do not redesign; fix what is missing and list what you checked in the Report.

### Read first
`AGENTS.md`, `packages/xmpp-core/src/client.ts` (credentials, status handling, `connect`, `stopAfterFailure`, `attachHandlers`), `packages/xmpp-core/src/types.ts`, the existing xmpp-core tests (they use a fake client factory; follow them), `apps/mobile/src/store/real-store.ts` around `boot`, `reconnect` and `getXmppToken`, `apps/web/src/store/realStore.ts` for the same, `deploy/ejabberd/ejabberd.yml`.

### Allowed files
`packages/xmpp-core/**`, `apps/mobile/src/store/real-store.ts` and its tests, `apps/web/src/store/realStore.ts` and its tests, `apps/mobile/src/lib/auth.ts` and `apps/web/src/lib/api.ts` (only to make the token error carry `status`) and their tests, `deploy/ejabberd/ejabberd.yml`, `deploy/tests/**`, `work/T-0174-connection-resilience.md`. Nothing else.

### Checks
```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/xmpp-core test --maxWorkers=2
pnpm --filter @zilar/web test --maxWorkers=2 src/store
pnpm --filter @zilar/mobile test --maxWorkers=2 real-store
```

### Acceptance
- A transient token failure (network error, timeout, 5xx, 429) never ends reconnecting; a 401 or 403 does (status offline, and it is reported once).
- A connection that goes silent is detected within `keepaliveMs + keepaliveTimeoutMs` and reconnected; with fake timers a test proves it, and a test proves any received stanza resets the timer.
- The client answers a server ping.
- Reconnect attempts follow the backoff and reset after success.
- No timer or listener remains after `disconnect()` (a test checks it).
- Existing tests pass unchanged except where a signature honestly changes; say which in the Report.

### Out of scope
Push notifications while the app is closed (T-0172 and later), changing the token lifetime (300 s is fine: a fresh token is fetched on every reconnect), a UI banner for connection state.

---

## Report (written by the worker when done)

## Review (written by Claude)

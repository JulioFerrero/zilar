---
id: T-0174
title: The XMPP connection survives idle networks and brief outages (keepalive, no fatal token blips)
status: review
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

### What I did
Made the shared XMPP client survive idle networks and brief outages:
- **Transient vs fatal token errors** (`packages/xmpp-core/src/client.ts`): only a `getToken` rejection carrying numeric `status` 401/403 sets `authFailed` (fatal, offline + reported once). Every other failure (network error, timeout, 0/429/5xx) is transient: the stuck unauthenticated stream is actively torn down so the library's auto-reconnect retries with a fresh token.
- **Backoff**: each attempt start (`connecting` status) arms `reconnect.delay` for the wait after it: 1s, 2s, 4s, 8s, 15s, then 30s; reset to 1s on `online`.
- **Keepalive**: while `online`, any received stanza restarts the idle timer; after `keepaliveMs` (default 30s) of silence an XEP-0199 ping goes to the server domain; a result OR error reply counts as alive; no reply within `keepaliveTimeoutMs` (default 15s) tears the socket down and reconnects via the normal path (`reconnecting` → `online`). `0` disables. Timers stop on `disconnect()`/fatal stop.
- **Server pings**: incoming `iq` type `get` with a `urn:xmpp:ping` child gets an empty `result`.
- **ejabberd**: `mod_ping: {}` → `send_pings: true`, `ping_interval: 60`, `timeout_action: none`, plus a shell deploy test.
- **Mobile resume**: `reconnect()` + AppState hook already reconnect when not `online`; fixed the missing piece — a resume during an in-flight boot started a second boot (two cores, doubled subscriptions). Boots now share one promise (`runBoot`); `start`/`reloadChats` use it too.

### Token `status` check (spec item 2, no code change needed)
- Web `getXmppToken` (`apps/web/src/lib/api.ts:306`) throws `ApiError` with numeric `status` (0 = network failure, 401/403/429/5xx passthrough).
- Mobile `getXmppToken` (`apps/mobile/src/lib/chat-api.ts:415`) throws `ChatApiError` with numeric `status` (0 = network, 401 = no session).
- So both already reject with an error carrying `status`; `apps/web/src/lib/api.ts` and `apps/mobile/src/lib/auth.ts` needed no changes.

### Rate-limit check (spec item 3)
Token route allows 120 per 10 min (`apps/server/src/xmpp/routes.ts:17`). Backoff attempts land at ~0,1,3,7,15,30,60,90,120…s, i.e. ~22 tokens per 10 min even at the 30 s floor — far under the limit. (No server files touched; read-only check.)

### Mobile resume checklist (spec item 7)
- Checked: AppState `active` → `reconnect()` (`real-store.ts`); skips when `started` false or status `online`; `core undefined` → boot; otherwise `connect()` + rejoin groups. Topics/pins pollers also refresh on resume via their own AppState listeners.
- Fixed: concurrent-boot guard (`runBoot`).
- Not added: no network listener — `@react-native-community/netinfo` is not a dependency and new deps are out of scope. A network return is covered by the core backoff (retries every ≤30 s until the network is back); a resume is covered by AppState. A resume while the store still shows stale `online` (suspended socket, no close event yet) is detected by the keepalive within ~45 s; per "do not redesign" I did not add a forced reconnect on every resume.

### Files changed
- `packages/xmpp-core/src/client.ts` (transient/fatal, backoff, keepalive, ping reply, timer cleanup)
- `packages/xmpp-core/src/types.ts` (`keepaliveMs`, `keepaliveTimeoutMs` options)
- `packages/xmpp-core/src/stanza.ts` (`buildPingRequest`, `buildPingResult`)
- `packages/xmpp-core/src/namespaces.ts` (`PING_NAMESPACE`)
- `packages/xmpp-core/src/connection-resilience.test.ts` (new, 17 tests)
- `packages/xmpp-core/src/core.test.ts` (1 test: plain-error fatal expectation → 401-error)
- `apps/mobile/src/store/real-store.ts` (`runBoot` guard)
- `apps/mobile/src/store/real-store.test.ts` (1 new test: resume during boot)
- `deploy/ejabberd/ejabberd.yml` (`mod_ping` with pings, 60 s, action none)
- `deploy/tests/connection-resilience.test.sh` (new, 4 assertions)
- Web store / token libs: intentionally unchanged (see above).

### Commands with real results
- `pnpm install`: ok (8 s).
- New tests before the fix: 11 failed / 6 passed — reproduced both spec bugs (fatal token blip, no keepalive/ping).
- `pnpm --filter @zilar/xmpp-core test --maxWorkers=2`: 7 passed files, 178 passed, 4 skipped (integration, need live stack) — includes the 17 new tests.
- `pnpm --filter @zilar/web test --maxWorkers=2 src/store`: 4 files, 159 passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 real-store`: 9 files, 155 passed.
- `sh deploy/tests/connection-resilience.test.sh`: pass=4 fail=0.
- `pnpm format:check`: pass. `pnpm lint`: pass. `pnpm typecheck`: 11/11 pass.
- Mobile regression-guard check: with the `runBoot` fix stashed, the new mobile test fails (double core); with it, passes.

### Problems / deviations / open questions
- The library (`@xmpp/client`'s `iqCallee`) already answers `urn:xmpp:ping` at its middleware layer, so in production a server ping now gets two empty results (library + core). Harmless (idempotent result, server consumes the first) but worth knowing; the core-level reply is what the spec and the fake-client tests require.
- `core.test.ts` "goes offline … when getToken fails" now uses a 401 error — the plain-error case is transient by design (covered in the new file). Only existing test whose expectation honestly changed.
- `transientTokenError` matches by object identity between the credentials throw and the client's error event (same object in both the real middleware path and the test helper). If a future library version clones the error, transient failures would fall back to "stay reconnecting without active teardown" (still reconnecting, just waiting on the server to close the stream).
- Deploy tests are not wired into CI (`.github/workflows/ci.yml` has no deploy step); the new `.sh` runs manually like its siblings.

## Review (written by Claude)

**Verdict:** Round 1: changes requested

Verified by reading the full diff and the pre-review: scope is clean; the transient/fatal split, backoff, keepalive and ping reply read correct; token `status` check and rate-limit arithmetic accepted.

### Findings
1. **`runBoot` is generation-blind** (`apps/mobile/src/store/real-store.ts` ~2906). A boot in flight for an older generation is awaited by a newer `runBoot(gen)`; the stale boot bails at its `gen !== generation` checks and creates no core, so the store sits with `core === undefined` and `chatsLoad: 'loading'` until the next resume. Store the generation next to the promise: if the cached boot belongs to a different generation, start a fresh boot for the new one (the stale one still ends by itself). Tests (mutation-check each): pull to refresh (`reloadChats`) during a slow first boot ends with a core and `loaded`; stop then start during a boot ends with a core; a resume during a boot of the SAME generation still shares one boot (keep your existing test). Also make `reconnect()` start a new attempt if the boot it awaited failed to produce a core, instead of silently dropping the resume.
2. **First retry waits 2 s on a cold start** (`packages/xmpp-core/src/client.ts` ~546): skip arming the delay when `reconnectAttempt === 0 && !hasBeenOnline` so the first retry is 1 s; add a test.
3. *(No change needed.)* The duplicate ping result from the library plus the core is accepted.

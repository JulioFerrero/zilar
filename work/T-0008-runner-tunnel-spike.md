---
id: T-0008
title: Spike S6 — runner tunnel over one WebSocket (engine API, model traffic, preview URL)
status: review
milestone: M0
branch: task/T-0008-runner-tunnel-spike
model: opencode-go/deepseek-v4-pro
depends_on: [T-0006]
estimate: 2 days
---

# T-0008: Spike S6 — runner tunnel over one WebSocket

## Spec (written by Claude, do not edit)

### Goal
Bring-your-own-compute (M3) rests on one claim in `docs/PROJECT_PLAN.md` §11.8:
**a runner opens one outbound WebSocket, and that single connection carries the
desk's engine API (HTTP + SSE), the AI's model traffic back to the LLM gateway,
and private preview URLs.** It must work behind home routers, so the runner
only ever dials out.

This spike answers, with evidence: does that design hold up? It must prove the
three traffic kinds, runner identity, and what happens when the connection
drops. The verdict decides the M3 design. The fallback, if it fails, is a
WireGuard mesh with Headscale, so say plainly if you think we need it.

This is throwaway-quality *architecture* but not throwaway-quality *code*: it
lives in a real package, fully typed and tested, because M3 will build on it.

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md` §11.2 (pairing), §11.8 (networking and previews),
  §11.9 (trust), §11.13 (runner protocol sketch), §15.4 (credential proxy)
- `packages/agent-drivers/` — the package layout, `package.json`, tsconfig and
  test style to copy for the new package
- The `ws` 8.x README (server `WebSocketServer`, `bufferedAmount`, ping/pong)
- Node 24 `node:crypto` docs for `generateKeyPairSync('ed25519')`, `sign`, `verify`

### Allowed files
- `packages/runner-tunnel/**` (new package)
- `pnpm-lock.yaml`
- `work/T-0008-runner-tunnel-spike.md`

**Not allowed:** `apps/**`, other `packages/**`, `infra/**`, `docs/**`, root
config files. Wiring into `apps/server` is M3 work. If the package cannot be
picked up by the root `turbo` tasks without a root change, say so in the Report.

> Another worker (T-0028) is editing `apps/server` and `apps/web`, and T-0031 is
> editing `apps/mobile`. Stay inside your package.

### Allowed dependencies
- `ws` (`^8.22.0`, already in the lockfile) and `@types/ws` as a devDependency.
- `zod` (already used across the repo).

Nothing else. Use Node's built-in `http`, `net`, `crypto` and `stream`.

### What to build
Two sides in one package: a **server side** (`src/server/`) and a **runner
side** (`src/runner/`), sharing a **protocol** module (`src/protocol.ts`).

1. **Framing and protocol.** Control messages are JSON text frames validated
   with `zod` on receipt (a malformed or unknown frame closes the connection with
   a clear close code; it never throws inside a handler). Stream bytes are
   binary frames with a small fixed header carrying the stream id. The first
   frame is `hello { runner_id, runner_version, protocol_version }`, and the
   server rejects an unsupported `protocol_version` with a close code.
   Tests: a malformed frame and an unknown type close the socket cleanly; an old
   protocol version is rejected; a binary frame for an unknown stream id is
   dropped and counted, not fatal.
2. **Runner identity** (§11.2 step 3). The runner generates an **ed25519 key
   pair**; the private key never leaves it. After `hello`, the server sends a
   random nonce, the runner signs it, and the server verifies the signature
   against a registry of **approved** public keys (an in-memory interface for
   the spike, so M3 can back it with Postgres).
   Tests: an approved runner connects; an unknown key is refused; a signature
   over a different nonce (replay) is refused; revoking a key closes its live
   connection.
3. **Engine API, server → runner.** The server can open a stream to a port on
   the runner's machine (`tunnel.open { port, stream_id }`) and use it as the
   transport for an HTTP request, e.g. through a custom `http.Agent`.
   Prove against a fake desk (a local HTTP server started by the test):
   - a JSON request and response round-trip
   - an **SSE stream arrives incrementally**: record arrival timestamps of
     events sent 200 ms apart and assert they are not buffered until the end
   - a 5 MB body arrives byte-identical (hash it)
   - 20 concurrent requests on one WebSocket all complete correctly
   The runner must refuse `tunnel.open` for a port it was not told to expose
   (an allowlist per runner). Test it.
4. **Model traffic, runner → server.** The runner listens on a local port
   (`127.0.0.1` only) that a desk uses as its LLM base URL. Bytes go through the
   tunnel, and the server forwards them to **one configured gateway URL only**.
   The runner can never make the server connect anywhere else. Tests: a request
   reaches a fake gateway; the runner-side listener is bound to 127.0.0.1 only;
   a crafted request (e.g. an absolute-form URL or a `Host` header naming
   another host) still only reaches the configured gateway.
5. **Preview URLs.** The server exposes `GET /preview/<token>/...` that proxies
   to an exposed runner port. The token is random (at least 128 bits,
   base64url), and an unknown token or a token whose runner is gone returns 404.
   Tests for both, plus a normal page load through the preview.
6. **Resilience.** Heartbeats with ping/pong. A dead connection is detected
   within a bounded time (make it configurable and test it with a short value).
   On a drop, in-flight streams on both sides **fail with a clear error**; they
   never hang. The runner reconnects with capped exponential backoff and
   re-authenticates. Backpressure: when the reader is slow, a sender must stop
   reading from its source (check `bufferedAmount` or equivalent). Prove that
   memory stays bounded while streaming 50 MB to a deliberately slow reader,
   and report the peak.

### Demo and integration check
- `pnpm --filter @galena/runner-tunnel demo` starts a server, a runner, a fake
  desk (HTTP + SSE) and a fake gateway on localhost, runs through items 3–5, and
  prints a short table: what was proven, and latency per request through the
  tunnel vs direct (median of 50).
- Gated by `GALENA_TUNNEL_INTEGRATION=1`: point the model-traffic path at the
  **real LiteLLM** on `http://127.0.0.1:4000` and `GET /health/liveliness`
  through the tunnel. No key is needed for that endpoint; do not use or print
  any key. Paste the real output in the Report.

**Never** run `pnpm infra:up`, `infra:down` or `infra:reset`, and never stop or
restart anything that is already running: the stack is serving Julio. Use
random free ports (listen on port 0) for everything you start, and close
everything you start at the end of each test.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test`, `build` pass, and the new
      package's tests run as part of `pnpm test`.
- [ ] Every test named in items 1–6 exists and passes, with real sockets on
      localhost and no external network.
- [ ] The demo output and the gated LiteLLM output are pasted in the Report.
- [ ] The Report ends with a clear **yes/no verdict** on §11.8 as written, the
      measured overhead, the 50 MB peak memory, and anything that surprised you.
- [ ] Only allowed files touched; the running stack was never touched.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force
pnpm build
```
(`--force` because a turbo cache replay does not prove anything.)

### Out of scope
- Pairing codes, the Machines UI, the capability report, desks and Docker.
- Wiring into `apps/server`, Postgres storage of runner keys, TLS termination.
- Room-member authorization on previews (the token is the capability for now;
  say in the Report what M3 must add).
- `desk.*` commands and `runner.update`.

---

## Report (written by the worker when done)

### What I did
- Built the new `packages/runner-tunnel` package (`@galena/runner-tunnel`): server side
  (`src/server.ts`), runner side (`src/runner.ts`), shared protocol (`src/protocol.ts`),
  ed25519 identity + in-memory registry (`src/keys.ts`), stream multiplexing with
  backpressure (`src/mux.ts`), a loopback-bridged `http.Agent` (`src/http-agent.ts`), and
  the demo (`src/demo.ts`). No root config changes were needed: `pnpm-workspace.yaml`
  already covers `packages/*` and turbo picks up the package's `typecheck`/`test` scripts
  automatically, so the new tests run as part of `pnpm test`.
- Proved every item 1–6 with real localhost sockets (44 tests, all passing, no external
  network): protocol close codes, ed25519 challenge/response with replay refusal and
  revocation kill, engine HTTP+SSE+5 MB+20-concurrent through a custom agent, model
  traffic pinned to one gateway URL, preview tokens with 404s, ping/pong death detection,
  in-flight failure on drop, reconnect with capped backoff + re-auth, and a 50 MB slow-
  reader run with bounded heap.
- Ran the demo (`pnpm --filter @galena/runner-tunnel demo`) and the gated LiteLLM check
  (`GALENA_TUNNEL_INTEGRATION=1`): real LiteLLM `GET /health/liveliness` through the
  tunnel returned `200 "I'm alive!"`. No key used or printed. The running stack was never
  touched (no `infra:*` commands; everything on port 0, everything closed afterwards).
- Found and fixed a real protocol bug during stress testing (see Problems): a FIN could
  overtake stream data parked in backpressure, truncating bodies. Fix is per-stream FIFO
  teardown plus a deterministic regression test that fails on the old behavior.

### Files changed
- `packages/runner-tunnel/package.json` (deps: `ws ^8.22.0`, `zod ^4.6.5`; devDep:
  `@types/ws ^8.18.1`), `tsconfig.json` (extends base + `allowImportingTsExtensions`, see
  deviation 1), `README.md`.
- `packages/runner-tunnel/src/protocol.ts` — zod control schemas, close codes
  4400/4401/4402/4403/4404, 5-byte binary header (stream id + kind), direction-checked
  parsing that never throws.
- `packages/runner-tunnel/src/keys.ts` — ed25519 (SPKI/PKCS8 DER, base64), single-use
  32-byte nonces, `InMemoryKeyRegistry` with revoke listeners.
- `packages/runner-tunnel/src/mux.ts` — `StreamMux` (even/odd stream ids, pause/resume
  flow control, 1 MiB high-water mark on `bufferedAmount`, unknown-stream drop counter),
  FIFO send/teardown queue per stream, `attachSocketToStream` bridge,
  `TunnelClosedError`.
- `packages/runner-tunnel/src/server.ts` — hello/challenge/auth/ready handshake, `openEngineStream`,
  `engineAgent()`, model forwarding to the one configured gateway (http only, see M3 notes),
  `GET /preview/<token>/...` (unknown token or gone runner → 404), configurable ping/pong
  heartbeats, revocation kill, `disconnectRunner` kill switch.
- `packages/runner-tunnel/src/runner.ts` — dial-out only, port allowlist (`tunnel.refused`
  otherwise), 127.0.0.1-only model listener, reconnect with capped exponential backoff
  (`computeBackoff`), re-auth per attempt, no retry on 44xx.
- `packages/runner-tunnel/src/http-agent.ts` — `TunnelHttpAgent` (async `createConnection`
  override) + `createLoopbackPair`, so node's HTTP stack only sees real sockets.
- `packages/runner-tunnel/src/demo.ts`, `src/test-harness.ts` (fakes + `RawRunner` raw-socket
  client), 8 test files (44 tests).
- `pnpm-lock.yaml` (added `ws`/`@types/ws` entries for the new package).
- `work/T-0008-runner-tunnel-spike.md` (this Report + status).

### Commands run and real results
- `pnpm install`: ok (12s first, 3.8s after adding deps).
- `pnpm format:check`: pass ("All matched files use Prettier code style!").
- `pnpm lint` (`oxlint .`, 308 files): 0 warnings, 0 errors.
- `pnpm typecheck` (turbo, 9 tasks): all pass.
- `pnpm exec turbo test --force`: **pass, 9/9 packages, exit 0** — devtools 9, chat-core 50,
  protocol 134, agent-drivers 19, xmpp-core 118 (+3 skipped), mobile 94 (+2 skipped),
  web 85, **runner-tunnel 44**, server 208 (+3 skipped). (During the work, parallel runs
  intermittently hit the known load-sensitive web trio from T-0029's area and one real
  race in my tests; both addressed below. Final full run is green.)
- `pnpm build`: pass.
- `pnpm --filter @galena/runner-tunnel test`: 44/44 green repeatedly (8 solo runs + 7
  scoped/full parallel runs after the FIFO fix).
- `pnpm --filter @galena/runner-tunnel demo` output (real, 2026-09-28):
  `engine JSON round-trip ok (status 200)`, `engine SSE stream ok (~1010 ms end to end)`,
  `engine 5 MB byte-identical ok (5 MB hashed)`, `engine 20 concurrent ok (one WebSocket)`,
  `preview page load ok`, `model traffic to gateway ok (/v1/chat)`,
  `latency median of 50: 0.31 ms direct vs 0.55 ms tunnel (overhead 0.24 ms)`
  (overhead measured 0.13–0.65 ms across runs),
  `50 MB to a slow reader, bounded memory ok (peak heap +0.0 MB in demo; +2.0 MB in the
  test run, bound asserted < 64 MB)`.
- Gated (`GALENA_TUNNEL_INTEGRATION=1`): `LiteLLM /health/liveliness through the tunnel:
  ok status 200 body "I'm alive!"`.
- SSE incrementality (test): 4 events sent 200 ms apart; arrival span asserted ≥ 400 ms
  with every inter-event gap ≥ 30 ms (a buffered-until-end delivery would show ~ms gaps).

### Problems, deviations from the spec, open questions
- **Real bug found (the spike working as intended): FIN could overtake parked data.**
  `attachSocketToStream` sent FIN immediately on socket end while a `sendStreamData` for
  the same stream was still parked in backpressure; the peer then dropped the trailing
  bytes as "unknown stream" and big bodies arrived truncated (`Error: aborted` on ~1/6
  loaded runs, always near 100%). Fix: per-stream FIFO in `StreamMux` (`sendStreamData`
  chains behind the previous send; `enqueueTeardown` runs after all queued data).
  `src/mux.test.ts` reproduces it deterministically (fails on immediate-FIN semantics,
  verified by temporarily reintroducing them) and passes with the fix. 9/9 green runs
  since. This is the one thing in §11.8 that would have bitten M3 silently.
- **Two test races fixed (mine, not implementation):** the runner observes a revoke/close
  before the server processes its own `close` event, so `isRunnerLive` assertions now use
  `waitFor` (revoke test, preview-gone test).
- **Deviations:** (1) relative imports use explicit `.ts` extensions (repo style is
  extensionless) — required so `node src/demo.ts` runs on Node 24 type-stripping without
  adding `tsx` (forbidden by Allowed dependencies); accepted by tsc
  (`allowImportingTsExtensions`), vitest and node. (2) No TS parameter properties (Node
  strip-only mode rejects them). (3) `TunnelHttpAgent` overrides async `createConnection`
  instead of `createSocket` (the latter is not in @types/node; the former is the
  documented extension point). (4) Refused-port test targets `desk.port + 1` (unexposed
  and closed; refusal precedes any dial). (5) Added `disconnectRunner()` (admin kill
  switch; doubles for §15.5).
- **Surprises:** `ws` 8.x delivers text frames as `Buffer` with `isBinary=false`, never as
  `string` (all handlers use the flag); the loopback HTTP client half-closes its write
  side after the request (harmless: the FIN echo path handles it); Node JWK import of a
  private OKP key requires the public half too, so keys are SPKI/PKCS8 DER instead;
  `ws` auto-pongs, which is what makes server-side death detection sound.
- **Open for M3:** gateway is http-only (LiteLLM is http; https needs an `https.Agent`
  equivalent); preview tokens never expire and the token is the whole capability (no
  room-member authorization — must add); registry is in-memory (needs Postgres +
  `store_model_in_db`-style ownership); no TLS on the tunnel itself (M3 terminates
  TLS/wss at the platform); heartbeats tune for WAN, not localhost (defaults 15 s/45 s).

### Verdict on §11.8 as written: YES — no WireGuard needed for the proven scope
One outbound WebSocket per runner carries engine API (HTTP incl. incremental SSE),
model traffic, and previews, with the runner only dialing out. Measured cost on
localhost: **median +0.24 ms per request** (0.13–0.65 across runs) and **+2.0 MB peak
heap while streaming 50 MB to a 10 ms/64 KiB slow reader** (bound 64 MB). Identity
(ed25519 challenge/response, revocation kill), allowlist enforcement, gateway pinning
(incl. absolute-form/foreign-Host attacks), death detection, fail-fast (never hang) and
reconnect-with-backoff all proven by tests. The one design correction: teardown must be
ordered behind queued stream data (fixed + regression-tested). M3 can build on this
package directly; it must still add TLS, Postgres keys, preview authorization/expiry,
and pairing codes (all out of scope here).

### Blocked / needs a decision
- None. Status is review, work is committed on the task branch, not pushed.

---

## Review (written by Claude)

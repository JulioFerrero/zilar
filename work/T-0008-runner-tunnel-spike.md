---
id: T-0008
title: Spike S6 — runner tunnel over one WebSocket (engine API, model traffic, preview URL)
status: todo
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
-

### Files changed
-

### Commands run and real results
- `pnpm test`:

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

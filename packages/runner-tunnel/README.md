# @zilar/runner-tunnel

One outbound WebSocket per runner carries the desk's engine API (HTTP + SSE),
the AI's model traffic back to the LLM gateway, and private preview URLs. The
runner only ever dials out, so it works behind home routers. This is the spike
for `docs/PROJECT_PLAN.md` §11.8; M3 builds on it.

## Layout

- `src/protocol.ts` — control-message schemas (zod) and the binary frame codec.
- `src/keys.ts` — ed25519 runner identity and the approved-keys registry.
- `src/mux.ts` — stream multiplexing, backpressure, and socket bridging.
- `src/server.ts` — the platform side: handshake, engine dial-out, model
  forwarding, preview URLs, heartbeats.
- `src/runner.ts` — the runner side: dial-out, auth, port allowlist, model
  listener, reconnect with capped backoff.
- `src/http-agent.ts` — an `http.Agent` whose connections travel the tunnel.
- `src/demo.ts` — the demo (`pnpm --filter @zilar/runner-tunnel demo`).

## Protocol

Control messages are JSON text frames, validated with zod on receipt. A
malformed or unknown frame closes the connection with a clear close code
(4400/4401); it never throws inside a handler. Stream bytes are binary frames
with a 5-byte header (stream id + kind).

Handshake: `hello { runner_id, runner_version, protocol_version }` →
`challenge { nonce }` → `auth { signature }` → `ready`. An unsupported
protocol version is rejected (4402); an unknown key or bad signature is
refused (4403). Nonces are single-use, so a signature over other bytes fails
as a replay.

Stream ids are split by parity (server even, runner odd), and each side closes
the connection (4400) on an id with the wrong parity or an already-live id, so
a buggy or hostile peer cannot hijack another stream. Pending engine opens are
tracked per connection, so one runner can never fail another runner's streams.
WebSocket messages are capped at 256 KiB plus the frame header on both sides.
Flow control is
` tunnel.pause` / `tunnel.resume` per stream, plus a high-water mark on the
WebSocket buffer: a slow reader makes the sender stop reading its source, so
memory stays bounded.

## Usage

```ts
import { InMemoryKeyRegistry, TunnelServer, RunnerClient, generateRunnerKeypair } from '@zilar/runner-tunnel';

const registry = new InMemoryKeyRegistry();
const keypair = generateRunnerKeypair();
registry.approve('office-linux', keypair.publicKey);

const server = await TunnelServer.start({ registry, gatewayUrl: 'http://127.0.0.1:4000' }, 0);
const runner = new RunnerClient({
  serverUrl: server.wsUrl,
  runnerId: 'office-linux',
  keypair,
  exposedPorts: [3000], // the only ports the server may open here
});
await runner.start();

// Engine API: HTTP through the tunnel to port 3000 on the runner's machine.
// The request port selects the runner port; the host is ignored.
import http from 'node:http';
const agent = server.engineAgent('office-linux');
http.get('http://desk:3000/api/session', { agent }, (res) => {
  // ... chunked bodies and SSE arrive exactly as if direct
});

// Model traffic: point the desk's LLM base URL at runner.modelUrl
// (http://127.0.0.1:<port>); bytes are forwarded to the gateway URL only.

// Previews: share a runner port behind an unguessable token.
const token = server.createPreviewToken('office-linux', 3000);
// GET <previewBaseUrl>/preview/<token>/...  (unknown token or gone runner: 404)
```

## Demo and the gated LiteLLM check

`pnpm --filter @zilar/runner-tunnel demo` starts a server, a runner, a fake
desk and a fake gateway on localhost, proves items 3–5 of the task, and prints
latencies (median of 50, direct vs tunnel) plus the 50 MB slow-reader peak.

With `ZILAR_TUNNEL_INTEGRATION=1`, the demo additionally points the
model-traffic path at the real LiteLLM on `http://127.0.0.1:4000` and fetches
`GET /health/liveliness` through the tunnel. No key is used or printed.

## Security notes for M3

- The model listener binds `127.0.0.1` only, and the server dials the one
  configured gateway URL no matter what the bytes say (absolute-form URLs and
  foreign `Host` headers still land on the gateway). The runner can never make
  the server connect elsewhere.
- The preview token is the capability: anyone holding it can load the page.
  Room-member authorization on previews is M3 work.
- The key registry is in-memory here; M3 backs it with Postgres. Revocation
  closes the live connection, and the runner does not retry auth rejections.

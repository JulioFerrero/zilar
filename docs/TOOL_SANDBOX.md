# Tool sandbox

A tool is one ES module (≤ 64 KiB) with an async default export:

```js
export default async function run(input) {
  const res = await fetch('https://api.example.com/price?symbol=BTC');
  const data = await res.json();
  return { text: `BTC: $${data.price}`, data: { price: data.price } };
}
```

`input` is any JSON value (default `null`). The function may return a
**string** (treated as `{ text }`) or `{ text: string, data?: JSON }`.
Anything else is `invalid_output`. `runTool` never throws for a problem in
the tool's code: every failure is `{ ok: false, error: { kind, message } }`.

## Limits (defaults)

| Limit | Default | Hard max |
|---|---|---|
| `wallMs` (whole run) | 10 000 | 30 000 |
| `cpuMs` (JS execution) | 2 000 | 30 000 |
| `memoryBytes` | 32 MiB | 64 MiB |
| `stackBytes` | 512 KiB | 8 MiB |
| `maxFetches` | 5 | 10 |
| `fetchTimeoutMs` | 5 000 | 30 000 |
| `maxResponseBytes` | 1 MiB | 4 MiB |
| `maxOutputBytes` | 16 KiB | 64 KiB |
| `maxLogBytes` | 4 KiB | 64 KiB |

Callers cannot raise a limit above its hard max. Error kinds: `invalid_source`,
`syntax`, `runtime`, `timeout`, `memory`, `output_too_large`, `invalid_output`,
`fetch_denied`, `sandbox_failure`.

## Threat model

- Untrusted tool code runs in QuickJS (WASM) inside a `worker_threads` worker,
  never in the server's JS realm. Each run gets a fresh runtime; nothing
  (no host object or function) crosses the boundary except JSON strings.
- Guaranteed: no filesystem, env vars, sockets or host globals (`process`,
  `require`, `Buffer`, timers, `crypto` are all absent); only `fetch` and
  `console.log/warn/error` (captured, capped) are added. `import` of any
  module fails. CPU, wall-clock, memory and stack limits are enforced; the
  worker is terminated past `wallMs`. Output shape and size are validated.
- Not guaranteed: QuickJS itself is unaudited; a VM bug could escape. Tools see
  no secrets because there are none to see — fetch carries no credentials.
- `console` output and return values are tool-controlled data, never
  instructions: quote or label them before feeding them to an AI.

## Fetch rules

- `GET`/`HEAD` only, no body, `https:` only, no credentials, no explicit port
  except 443. Only the `accept` header passes; the host sets
  `user-agent: GalenaTool/1`.
- The hostname must exactly equal an `allowedHosts` entry (case-insensitive,
  IDNA normalised; no wildcards, no suffix match, no IP literals).
- SSRF guard: the host is DNS-resolved, **every** address must be public
  (loopback, private, link-local incl. 169.254.169.254, CGNAT, multicast,
  unspecified, IPv6 ULA/link-local, mapped-private all rejected); the request
  then connects to the validated IP with SNI/`Host` kept as the hostname.
- 3xx responses are returned as-is (status + empty body) and never followed.
- The tool sees only `{ ok, status, text(), json() }`: no headers or streams.

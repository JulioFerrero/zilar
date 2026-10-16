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
**string** (treated as `{ text }`) or `{ text: string, data?: JSON,
blocks?: Block[], card?: Card }`. `blocks` uses the same kinds as `post_blocks`
(figure, number, checklist, status, link, callout) with pre-formatted string
values. When a scheduled tool routine returns valid `blocks`, it posts them as
a card whose header is the routine title and its schedule, while `text` stays
the plain message body. Anything else is `invalid_output`. `runTool` never
throws for a problem in the tool's code: every failure is
`{ ok: false, error: { kind, message } }`.

## Cards

`card` sets the header of a `tool.run` card: `title` (defaults to the tool name
with hyphens read as spaces, e.g. `Market prices`), `icon` (a lucide name from
`BlockIconSchema`, e.g. `chart`) and `meta` (a short time or date, e.g.
`22:34 UTC`). The card header is validated with the blocks: an invalid `card`
falls back to the plain text post.

QuickJS has no `Intl`, so format numbers inside the tool with the sandbox
`fmt` helpers (a non-finite number gives `—`):

- `fmt.number(n, digits = 2)` — `fmt.number(7744.1, 0)` is `"7,744"`.
- `fmt.money(n, symbol = '$', digits = 2)` — `fmt.money(82302, '$', 0)` is `"$82,302"`.
- `fmt.change(now, before, digits = 1)` — the absolute percent and its
  direction: `fmt.change(105, 100)` is `{ direction: 'up', text: '5.0%' }`.

The board's prices card, as a tool:

```js
export default async function run() {
  return {
    text: 'Prices for today',
    card: { title: 'Prices', icon: 'chart', meta: '22:34 UTC' },
    blocks: [
      {
        kind: 'figure',
        rows: [
          { label: 'BTC', value: fmt.money(82302, '$', 0), change: fmt.change(82302, 80598) },
          { label: 'Gold', value: fmt.money(4152, '$', 0), change: fmt.change(4152, 4164) },
          { label: 'S&P 500', value: fmt.number(7744, 0), change: fmt.change(7744, 7713) },
        ],
      },
    ],
  };
}
```

## Limits (defaults)

| Limit | Default | Hard max |
|---|---|---|
| `wallMs` (whole run) | 10 000 | 30 000 |
| `cpuMs` (JS execution only, never fetch waits) | 2 000 | 30 000 |
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
  `user-agent: ZilarTool/1`.
- The hostname must exactly equal an `allowedHosts` entry (case-insensitive,
  IDNA normalised; no wildcards, no suffix match, no IP literals).
  `allowedHosts` is the tool version's declared hosts **intersected with the
  hosts a human approved for the tool** (`tool.approve_hosts`, one card per
  tool): a tool with no approved hosts still runs, with no network. Saving a
  new version that declares a host outside the approved set keeps working
  without that host until a new approval; `tool.revoke_hosts` empties the set
  (the tool keeps running offline).
- SSRF guard: the host is DNS-resolved, **every** address must be public
  (loopback, private, link-local incl. 169.254.169.254, CGNAT, multicast,
  unspecified, IPv6 ULA/link-local/site-local, 6to4, Teredo, mapped-private
  all rejected); the request then connects to the validated IP with SNI/`Host`
  kept as the hostname.
- 3xx responses are returned as-is (status + empty body) and never followed.
- The tool sees only `{ ok, status, text(), json() }`: no headers or streams.

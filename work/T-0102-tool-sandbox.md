---
id: T-0102
title: Tool sandbox: run AI-written JavaScript in QuickJS with an allowlisted, SSRF-safe fetch
status: review
milestone: M4
branch: task/T-0102-tool-sandbox
model: meta/muse-spark-1.3-contributor
depends_on: []
estimate: 1.5 days
---

# T-0102: Tool sandbox

## Spec (written by Claude, do not edit)

### Why
Julio wants an AI to build small tools from a chat message ("every morning post the price of gold, the S&P 500 and BTC"), keep them, improve them, and run them on a schedule. The code is written by a model from text that any group admin typed, so it is **untrusted code**. It must never run in the server's own JavaScript realm. Julio chose (2026-09-29) to run tools in a **server-side sandbox** first (runner desks come later; the tool format stays the same). This task builds only the sandbox: a function that takes source code + input + an allowlist of hosts and returns the result. Storage, scheduling and the AI tools are separate tasks (T-0103 …).

### The contract of a tool
A tool is one ES module (≤ 64 KiB of text) with a default export:

```js
export default async function run(input) {
  const res = await fetch('https://api.example.com/price?symbol=BTC');
  const data = await res.json();
  return { text: `BTC: $${data.price}`, data: { price: data.price } };
}
```
- `input` is any JSON value (default `null`). The function may return a **string** (treated as `{ text }`) or `{ text: string, data?: JSON }`. Anything else → `invalid_output`.
- Only these globals are added by the host: `fetch` (below) and `console.log/warn/error` (captured, capped). Nothing else from the host exists: no `process`, `require`, `Buffer`, `setTimeout` from Node, no filesystem, no `import()` of anything (a dynamic or static import of another module must fail with a clear error), no `eval` escape to the host. Standard JS built-ins (`JSON`, `Math`, `Date`, `Intl`, `Promise`, `URL` if QuickJS provides it, etc.) are fine.

### What to build (`apps/server/src/sandbox/`)
1. **`run-tool.ts`**: `runTool(params): Promise<RunToolResult>`.
   ```ts
   interface RunToolParams {
     source: string;
     input?: unknown;                 // JSON-serialisable
     allowedHosts: readonly string[]; // exact host names, e.g. 'api.coingecko.com'
     limits?: Partial<SandboxLimits>;
     fetcher?: HostFetcher;           // injected in tests; defaults to the real one
   }
   interface SandboxLimits {
     wallMs: number;           // whole run, default 10_000, hard max 30_000
     cpuMs: number;            // time spent executing JS (not waiting on fetch), default 2_000
     memoryBytes: number;      // default 32 MiB
     stackBytes: number;       // default 512 KiB
     maxFetches: number;       // default 5
     fetchTimeoutMs: number;   // default 5_000
     maxResponseBytes: number; // default 1 MiB per fetch
     maxOutputBytes: number;   // returned {text,data} JSON, default 16 KiB
     maxLogBytes: number;      // default 4 KiB
   }
   type RunToolResult =
     | { ok: true; output: { text: string; data?: unknown }; logs: string; durationMs: number; fetchCount: number }
     | { ok: false; error: { kind: SandboxErrorKind; message: string }; logs: string; durationMs: number; fetchCount: number };
   type SandboxErrorKind = 'invalid_source' | 'syntax' | 'runtime' | 'timeout' | 'memory' | 'output_too_large' | 'invalid_output' | 'fetch_denied' | 'sandbox_failure';
   ```
   Limits are clamped to hard maxima (a caller cannot raise wall time above 30 s, memory above 64 MiB, fetches above 10). `runTool` **never throws** for a problem in the tool's code: every failure is a `{ ok: false }` result with a short, non-secret message (no host stack traces, no file paths).
2. **Engine: QuickJS compiled to WebAssembly** via `quickjs-emscripten` (add it to `apps/server/package.json`; this is the one dependency this task may add — use the current stable release, pin it with `^`). Use the synchronous runtime with promise-returning host functions (`context.newPromise()` + a loop that calls `runtime.executePendingJobs()` until the result promise settles or a limit hits), or the library's documented async approach if it is simpler and keeps every limit below enforceable. Set `runtime.setMemoryLimit`, `setMaxStackSize`, and an **interrupt handler** that stops the VM when `cpuMs` of JS execution or `wallMs` overall is exceeded. Dispose the context and runtime on every path (success, error, timeout).
3. **Run it off the main thread.** A runaway script must not freeze the API. Run each execution in a `worker_threads` Worker (with `resourceLimits`), and terminate the worker if `wallMs` (+ a small grace) passes without a reply. Find a mechanism that works under `vitest`, `tsx` (the server runs with `tsx`, there is no build step for the server) and `tsc --noEmit`; describe what you chose in the Report. If a worker turns out to be infeasible with the toolchain, stop and explain under "Blocked / needs a decision" rather than falling back to the main thread silently.
4. **`host-fetch.ts`: the only door out.** `fetch(url, init?)` inside the sandbox is a bridge to the host with **all** of these rules, each tested:
   - Method is `GET` or `HEAD` only; no request body; only the header `accept` (and `user-agent` set by the host to `GalenaTool/1`). Everything else is dropped or rejected.
   - The URL must parse, use `https:`, have no credentials (`user:pass@`), no explicit port other than 443, and its **hostname must equal an entry of `allowedHosts`** (case-insensitive exact match after IDNA/punycode normalisation; no wildcards, no suffix matching, no IP literals even if listed). Otherwise reject with kind `fetch_denied` and message `host not allowed: <host>`.
   - **SSRF guard:** resolve the host's addresses yourself, reject if **any** resolved address is loopback, private (RFC 1918), link-local (incl. `169.254.169.254`), carrier-grade NAT, multicast, unspecified, IPv6 loopback/ULA/link-local, or an IPv4-mapped IPv6 of one of those; then **connect to the resolved address you validated** (pin the IP; keep SNI and `Host` as the hostname) so a second DNS answer cannot swap it (DNS rebinding).
   - **No redirects followed**: a 3xx is returned to the tool as-is (status + `location` header is not exposed; give the tool `status` and empty body), so a redirect cannot leave the allowlist.
   - Limits: `maxFetches` per run, `fetchTimeoutMs` per request, response body capped at `maxResponseBytes` (stop reading and fail with `fetch_denied: response too large`), content-encoding decoded by the host, body returned as text (invalid UTF-8 replaced).
   - The tool sees a minimal response: `{ ok, status, text(): Promise<string>, json(): Promise<unknown> }`. No headers, no streams, no `Response` class.
   - The fetcher is injected (`HostFetcher` = `(request: { url: URL; address: string }) => Promise<{ status: number; body: Uint8Array }>` or a similar small shape you define) so tests never touch the network. Provide the real implementation with `node:https`/`undici` **using only what is already installed** (do not add another dependency); tests for it use a local TLS server or are limited to the pure pieces (validation and IP classification) if a real socket test is not practical — say which in the Report.
5. **Output handling.** `console.*` lines are captured with a total cap of `maxLogBytes` (truncate, add `…`). The returned value is JSON-stringified **inside** the sandbox and measured against `maxOutputBytes` before crossing the boundary; the host parses it again and validates the shape with `zod` (`text` string ≤ `maxOutputBytes`, `data` any JSON). No host object or function ever crosses the boundary in either direction, only JSON strings.
6. **`docs/TOOL_SANDBOX.md`** (new, ≤ 80 lines): the tool contract, the limits table, the threat model (what the sandbox guarantees, what it does not, why it has no secrets), and the fetch rules.

### Read first
- `AGENTS.md` (mandatory)
- `apps/server/src/config.ts` and `apps/server/package.json` (style, zod, vitest setup); an existing small module with a port + fake for tests, e.g. `apps/server/src/actions/announce.ts`
- The `quickjs-emscripten` README: `newQuickJSWASMModule`, `runtime.setMemoryLimit`, `setInterruptHandler`, `evalCode` with `type: 'module'`, `newPromise`, `executePendingJobs`, `dump`, disposal rules
- `docs/PROJECT_PLAN.md` §13 and §15.1 (untrusted content, no secrets in the tool runner)

### Allowed files
- `apps/server/src/sandbox/**` (new)
- `apps/server/package.json`, `pnpm-lock.yaml` (only the `quickjs-emscripten` addition)
- `docs/TOOL_SANDBOX.md` (new)
- `work/T-0102-tool-sandbox.md`

**Not allowed:** anything else in the server (no wiring into `app.ts`, no routes, no DB), web, mobile, other packages, other dependencies.

### Tests (Vitest; no real network, no real API keys)
Happy path: a tool that returns a string; one that returns `{text,data}`; one that calls the (fake) fetch, awaits `.json()`, and formats; `input` reaches the function; logs are captured.
Limits: `while(true){}` → `timeout` within the cpu limit (and the worker is really gone: no leaked handle; the test process exits cleanly); an allocation bomb (`'x'.repeat(1e9)`, growing arrays) → `memory`; deep recursion → `runtime`/stack error, not a crash; a tool that awaits a fetch that never answers → `timeout`; a 2 MiB output → `output_too_large`; 100 KB of `console.log` → truncated; 6th fetch → `fetch_denied`; oversized source (65 KiB) → `invalid_source`.
Contract errors: syntax error → `syntax`; no default export / default export not a function → `invalid_output` or `syntax` with a clear message; returns a number/undefined/function/circular object → `invalid_output`; a rejected promise / thrown error → `runtime` with the message but no host paths.
**Escape attempts** (each must end as a normal `{ ok:false }` or harmless result, and prove nothing leaked): `typeof process`, `typeof require`, `typeof globalThis.Buffer`, `import('node:fs')`, `import fs from 'node:fs'`, `this.constructor.constructor('return process')()`, `Function('return this')()`, `(async()=>{}).constructor`, prototype pollution of `Object.prototype` does not affect a **second** run in the same process (each run has its own runtime), reading `globalThis` keys lists only the allowed ones plus JS built-ins.
Fetch rules (with a fake resolver + fake fetcher): non-https, `http://`, credentials in the URL, port 8443, host not in the list, a listed host that resolves to `127.0.0.1` / `10.0.0.5` / `169.254.169.254` / `::1` / `::ffff:127.0.0.1` / `fd00::1`, a host that resolves to one public and one private address (reject), IP-literal URLs, mixed-case host and punycode host normalisation, a 302 response is not followed, POST/PUT and a body are refused, only allowed headers pass, response over the cap is refused, and the fetcher is called with the **validated IP** (rebinding: the resolver returns a different answer the second time and the run still uses the first).

### Acceptance criteria
- [ ] Every test above exists and passes; the escape tests are explicit about what they assert.
- [ ] A hostile tool cannot read files, env vars, the network (outside the allowlist), the server's memory, or crash / stall the server for longer than `wallMs`.
- [ ] `runTool` has no dependency on the database, Hono, or any other server module (it is a leaf module).
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint re-run after your last edit; `TOOL_SANDBOX.md` is accurate (states real limits, no promises the code does not keep).

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/server test
pnpm build
```

### Out of scope
- Storing tools, versions, schedules, routes, the AI's tools, approval cards, UI (T-0103 and later).
- Secrets or credentials for tools (there are none by design), a `POST` capability, WebSockets, timers, filesystem, other languages.
- Any usage or cost tracking.

---

## Report (written by the worker when done)

### What I did
- Built the tool sandbox in `apps/server/src/sandbox/`: `run-tool.ts` (public
  `runTool`, owns the worker lifecycle and fetch mediation), `tool-worker.ts`
  (runs one QuickJS runtime per execution inside the worker), `host-fetch.ts`
  (allowlist + SSRF validation and the pinned `node:https` fetcher),
  `ip-guard.ts` (IPv4/IPv6 non-public classification), `types.ts` (limits,
  clamping, output parsing). Added `quickjs-emscripten@^0.32.0` to
  `apps/server/package.json` (the one dependency the spec allows).
- Worker mechanism: `runTool` spawns a `worker_threads` Worker whose entry
  (`tool-worker.ts`) is TypeScript. The worker is started with an eval
  bootstrap (`require('tsx/cjs'); require('<abs path to tool-worker.ts>')`)
  so it loads under tsx (server `dev`), plain node, and vitest (whose workers
  do not inherit a TS loader — a bare `.ts` worker path fails there with
  "Cannot find module .../types.js"). The parent validates every fetch
  (allowlist + SSRF) and performs HTTPS itself; the worker only ever receives
  `{ status, body }`. The parent terminates the worker on the first result or
  at `wallMs + 500 ms`, and also sets `resourceLimits` on the worker.
- Inside the VM: fresh `QuickJS.newRuntime()` per run (`setMemoryLimit`,
  `setMaxStackSize`, interrupt handler on `wallMs`/`cpuMs` deadlines), only
  `fetch` + `console.log/warn/error` installed, source evaluated as
  `type: 'module'`, default export called with the JSON input, promise driven
  with `context.newPromise()` deferreds + `runtime.executePendingJobs()`,
  output JSON-stringified inside the VM and re-validated with zod on the host.
  Context and runtime are disposed on every path.
- Wrote `docs/TOOL_SANDBOX.md` (63 lines): contract, limits table, threat
  model, fetch rules.
- Tests: 104 in `src/sandbox/` (`run-tool.test.ts` 48 happy/limit/contract/
  escape/fetch cases, `host-fetch.test.ts` 24 incl. a real local-TLS pinned
  request test proving SNI + Host stay the hostname while TCP goes to the
  validated IP, plus a header test proving only `accept` + `GalenaTool/1`
  reach the wire, `ip-guard.test.ts` 32). No real network except local
  loopback in those two tests; everything else uses injected fake
  fetchers/resolvers.

### Review fixes (lead items 1–7, all done)
- cpuMs now counts only VM execution: `enterVm`/`exitVm` segments around every
  `evalCode`/`callFunction`/`executePendingJobs` entry (depth-counted for
  nesting), interrupt handler compares `cpuUsedMs + open segment` against
  `cpuMs`; fetch waits no longer consume cpu. Tests: lead repro (cpuMs 300 +
  800 ms delayed fetch + 200k loop) now succeeds; busy loop still times out at
  cpuMs; never-answering fetch still ends via `fetchTimeoutMs` as
  `fetch_denied: fetch timeout`.
- Removed `executePendingJobs()` from inside the `text`/`json` host functions
  (re-entrant pumping); the main loop pumps after every return. Async fetch
  continuation pumps go through `settleVm`, inside cpu accounting.
- `ip-guard.ts` now also blocks 6to4 `2002::/16`, Teredo `2001::/32`, and
  deprecated site-local `fec0::/10`; tests incl. `2002:7f00:1::1`.
- Removed dead code: `buildHostHeaders` (+ its tests) gone — the fetcher sends
  only `accept: */*` + fixed user-agent and takes no headers argument;
  `maxFetches` and `fetcher` removed from `FetchBridgeOptions` (fetch count is
  enforced in the worker; noted in a comment).
- Worker bootstrap resolves `tsx/cjs` via `createRequire(import.meta.url)`,
  not the cwd; test runs `runTool` after `process.chdir('/')` and restores it.
- `withFetchPrefix` (in `types.ts`, shared by worker and parent) strips a
  leading `fetch_denied:` before prefixing; tests assert exact messages
  (e.g. `fetch_denied: host not allowed: evil.com`).
- `docs/TOOL_SANDBOX.md` updated: cpuMs is JS-execution-only, extra blocked
  ranges listed.

### Files changed
- `apps/server/src/sandbox/types.ts` (new): limits, `resolveLimits` clamping,
  `parseToolOutput`, result/error types.
- `apps/server/src/sandbox/ip-guard.ts` (new): IPv4 CIDR + IPv6 classification.
- `apps/server/src/sandbox/host-fetch.ts` (new): `validateFetchRequest`,
  `buildHostHeaders`, `createDefaultFetcher`/`fetchPinnedHttps` (pinned IP,
  SNI + Host = hostname, 3xx returned as-is with empty body, per-request
  timeout, body cap).
- `apps/server/src/sandbox/tool-worker.ts` (new): QuickJS runtime, `fetch` and
  `console` bridges, output stringify-in-VM, error-kind mapping.
- `apps/server/src/sandbox/run-tool.ts` (new): worker spawn/terminate, wall
  clock, log cap, fetch mediation, zod validation of worker messages and
  output shape, message sanitising.
- `apps/server/src/sandbox/*.test.ts` (new, 3 files, 98 tests).
- `apps/server/package.json`, `pnpm-lock.yaml`: only the
  `quickjs-emscripten@^0.32.0` addition.
- `docs/TOOL_SANDBOX.md` (new, 63 lines).
- `work/T-0102-tool-sandbox.md`: this Report + `status: review`.

### Commands run and real results (review-fixes pass; full suite run once at the end)
- `pnpm install`: ok.
- `pnpm exec vitest run src/sandbox --maxWorkers=2` (from `apps/server`):
  3 files, 104 tests passed. One flake found while iterating: `growing arrays`
  (cpuMs 5000 + worker startup under load) exceeds vitest's default 5 s
  per-test timeout when vitest is run bare without the repo's
  `--testTimeout=30000`; gave that test an explicit `{ timeout: 25000 }`.
- `pnpm --filter @galena/server test -- --maxWorkers=2` (once, at the end):
  60 files passed, 5 skipped; 1001 tests passed, 7 skipped (~517 s).
- `pnpm format:check`: all files use Prettier style.
- `pnpm lint` (oxlint): clean.
- `pnpm typecheck` (turbo): 10 tasks successful.
- `pnpm build`: 2 tasks successful (cached).
- Original probes (thrown away in /tmp): infinite loop →
  `InternalError: interrupted` (~220 ms for a 200 ms deadline); `'x'.repeat(1e9)` → `out of memory`;
  deep recursion → `InternalError: stack overflow` at 128 KiB guest stack but
  crashes the host process at 512 KiB — hence the spec default of 512 KiB is
  kept but `stackBytes` is user-raisible only to 8 MiB **worker** stack while
  the *guest* QuickJS stack stays capped; recursion inside a worker returns a
  normal `runtime` error and the worker exits 0 (verified). Static and dynamic
  `import('node:fs')` → `could not load module`. `typeof process/require/
  Buffer/setTimeout/TextEncoder/crypto` all `undefined`; `URL` also undefined
  in QuickJS (tools must not rely on it). `Function('return 1')()` works but
  only inside the VM (returns 42/43 there, `typeof process` still undefined).
  Pollution of `Object.prototype` does not cross runtimes (separate worker +
  fresh runtime per run). A `while(true){}` run reports `timeout` in ~410 ms
  and the worker is terminated (parent `terminate()` resolves; 3 sequential
  runs exit cleanly, process exits 0, no leaked handles beyond 2 stdio
  sockets).

### Problems, deviations from the spec, open questions
- `stackBytes` default is 512 KiB per the spec, but a 512 KiB *guest* stack
  lets deep recursion overflow the host (WASM) stack and crash the process
  when run on the main thread. Containment is the worker thread: inside the
  worker the same recursion returns `InternalError: stack overflow` mapped to
  `runtime` and the worker exits 0. `HARD_MAX_LIMITS.stackBytes` is 8 MiB for
  the worker thread stack; the guest QuickJS stack limit passed to
  `setMaxStackSize` is the resolved `stackBytes` (default 512 KiB, hard max
  8 MiB). Deep-recursion tests pass reliably under vitest and tsx.
- `cpuMs` measures wall time of JS execution including `executePendingJobs`
  pumping (the interrupt handler fires on `cpuUsedMs + open segment`), not
  isolated JS-thread CPU time; a tool awaiting a hanging fetch consumes no cpu
  time and is stopped by `wallMs`/`fetchTimeoutMs`. This keeps every limit
  enforceable without asyncify.
- Error messages carry the `fetch_denied:` prefix exactly once via the shared
  `withFetchPrefix` helper; messages stay short and secret-free
  (paths/`wasm…` frames/`at …` lines stripped).
- `fetchPinnedHttps` takes an optional `port` used only by the local-TLS test;
  production callers always use 443 (the validator rejects explicit ports).
- `TOOL_SANDBOX.md` documents the real defaults and guarantees; the one
  deliberate hedge is "QuickJS itself is unaudited; a VM bug could escape".
- `runTool` is a leaf module: it imports only `node:` builtins, zod,
  quickjs-emscripten (worker) and its sibling files — no DB, Hono, or config.

### Blocked / needs a decision
- None.

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-

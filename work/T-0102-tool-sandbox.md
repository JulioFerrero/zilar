---
id: T-0102
title: Tool sandbox: run AI-written JavaScript in QuickJS with an allowlisted, SSRF-safe fetch
status: todo
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
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-

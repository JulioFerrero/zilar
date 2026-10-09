---
id: T-0771
title: "S5a: sandbox host fetch on Effect — sandbox/host-fetch.ts validateFetchRequest (DNS resolve + SSRF check) and fetchPinnedHttps (https request as Effect.callback, destroy on interrupt) as Effects behind the unchanged exported Promise functions; same FetchCheck results, same error texts, same pinning to the validated IP"
status: todo
milestone: M5
branch: task/T-0771-sandbox-host-fetch
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-0771 (S5a): the sandbox host fetch on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 2 of `docs/audit/effect-100-plan.md` (task S5, split by the lead: the host fetch now, the QuickJS worker later). It is security-sensitive: this module is the SSRF guard for the tools' network access. **Behaviour must not change.**

### Verified facts (do not re-derive)
- **`apps/server/src/sandbox/host-fetch.ts`** (187 lines):
  - the types `HostFetcher = (request) => Promise<FetchResponse>` (line 26) and `DnsResolver = (host) => Promise<string[]>` (line 28);
  - `normalizeHost` (line 44, a try/catch over a URL parse) and `isHostAllowed` (line 56);
  - `validateFetchRequest(...)` (line 64, async). It parses the URL inside a try/catch (line 76) and resolves DNS with a default resolver over `dnsLookup` (lines 99-100) inside a try (line 104). It returns a `FetchCheck` (line 39);
  - `createDefaultFetcher(options)` (line 120) returns an async fetcher;
  - `fetchPinnedHttps(...)` (line 128) wraps `httpsRequest` in `new Promise`, with `response too large` and `fetch timeout` errors through `req.destroy` (lines 162-182).
- **Callers:** `sandbox/run-tool.ts:10`, and `sandbox/tool-worker.ts:3` (type only). **Tests:** `host-fetch.test.ts` and `ip-guard.test.ts`, plus `run-tool.test.ts` and `run-tool.effect.test.ts`, which inject a `HostFetcher`.
- **The same pattern was done in T-0760** for `apps/server/src/gifs/routes.ts` `fetchProxiedMediaEffect` (an `Effect.callback` with destroy on interrupt, keeping `req.setTimeout` as the socket idle timeout). Copy that approach.
- **The rules:** `docs/EFFECT_GUIDE.md` (Promise edges, lines 12-32; `Effect.callback`, line 164). Use the 4.0.2 APIs from `node_modules/effect/dist`.

### What to build
1. **Effects behind the same exports:** `validateFetchRequestEffect` and `fetchPinnedHttpsEffect`. The existing exported functions and types keep their signatures and run the Effects (`Effect.runPromise`). `HostFetcher` and `DnsResolver` stay Promise types, so injected test fakes keep working.
2. **Parsing:** the URL parse uses `parseUrl` from `@zilar/chat-core` **only if** the server already depends on chat-core (check `apps/server/package.json`); otherwise use `Effect.try`. `normalizeHost` stays pure: if its try/catch is only a total parse, keep it and say so.
3. **Keep exactly:** the order of checks (scheme, host allow-list, DNS, IP guard), the `FetchCheck` shapes and messages, the pinning to the validated address with SNI and Host kept as the hostname, no redirects, the size cap and the timeout texts.
4. **Tests:** every existing sandbox test passes unchanged. Add one test showing that interrupting `fetchPinnedHttpsEffect` destroys the request (a local TLS-less server cannot test https; use whatever `host-fetch.test.ts` already uses, or inject the request function if the code allows it without changing the exports, and say what you did).

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `apps/server/src/sandbox/host-fetch.ts`, `apps/server/src/sandbox/run-tool.ts`, `apps/server/src/gifs/routes.ts` (the T-0760 pattern), the sandbox tests.

### Allowed files
`apps/server/src/sandbox/host-fetch.ts`, `apps/server/src/sandbox/host-fetch.test.ts`, `work/T-0771-sandbox-host-fetch.md`.

In `host-fetch.test.ts`, only add tests.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/sandbox
pnpm gate
```

### Acceptance
- `host-fetch.ts` imports Effect, with no `new Promise` and no async functions left (beyond the Promise edges).
- The SSRF behaviour is identical, and the tests pass unchanged plus the new one.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

---
id: T-0761
title: "S9: server small edges C on Effect — git/proxy.ts (the GitProxy handler as an Effect program with HttpError failures, token via Effect.tryPromise, upstream fetch via the injected fetch) and connections/probe.ts (testKey as an Effect with timeoutOrElse; unreachable/401/403/429/ok mapping unchanged); same exported Promise signatures"
status: todo
milestone: M5
branch: task/T-0761-server-edges-c
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-0761 (S9): git proxy and connection probe on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 2 of `docs/audit/effect-100-plan.md` (task S9), accepted by Julio on 2026-10-09.

### Verified facts (do not re-derive)
- **`apps/server/src/git/proxy.ts`** (180 lines):
  - `export type GitProxy = (request: Request) => Promise<Response>` (line 134);
  - `createGitProxy(deps)` (line 136) returns an async handler (lines 142-179). The handler reads `request.arrayBuffer()` for receive-pack POSTs, throws `HttpError(403, 'push_rejected', ...)` for unparseable or disallowed refs, strips the hop-by-hop headers, awaits `tokenClient.getToken()` (line 171) and returns `fetchImpl(...)` (`deps.fetch ?? fetch`, line 140).
  - Since T-0740 it is called from `git/api.ts`, which is not mounted. The tests live under `apps/server/src/git/`; list them.
- **`apps/server/src/connections/probe.ts`** (101 lines):
  - `createProviderProbe(fetchImpl = fetch)` (line 60) returns `{ async testKey(provider, key) }` (lines 62-92). It fetches with `AbortSignal.timeout(PROBE_TIMEOUT_MS)`, maps a thrown fetch to `{ ok: false, message: 'The provider is unreachable' }`, 401 or 403 to `'The provider rejected the key'`, 429 to the rate-limit message, `response.ok` to `{ ok: true }`, and anything else to `'The provider returned an unexpected response'`.
  - The comment at lines 72-76 explains why no error detail is kept: a URL can echo the key.
- **The rules:** `docs/EFFECT_GUIDE.md` (Promise edge, lines 12-32; tagged errors, lines 61-72; `timeoutOrElse`, line 165). Check the APIs in `node_modules/effect/dist/*.d.ts` (Effect 4.0.2).

### What to build
1. **`git/proxy.ts`:**
   - add `gitProxyEffect(deps): (request: Request) => Effect.Effect<Response, HttpError>`. It reads the body, getting the token and calling the upstream fetch through `Effect.tryPromise`. It fails with the same `HttpError` values. A failure of the token client or of the upstream fetch must keep today's behaviour exactly: find out what happens today (an error thrown out of the async function) and keep it (a defect or rejection reaching the caller in the same way). Explain in the Report.
   - `createGitProxy` stays, returning `(request) => Effect.runPromise(gitProxyEffect(deps)(request))`. Ensure an `HttpError` failure rejects with the same `HttpError` instance (use `Effect.runPromise` plus the 4.0.2 way to unwrap a `Cause` failure if needed; check how `apps/server/src` already does this, for example `git grep -n "runPromiseExit\|squash" apps/server/src`).
2. **`connections/probe.ts`:** `testKeyEffect(provider, key): Effect.Effect<ProbeResult>` (no error channel: every outcome is a value). The fetch goes through `Effect.tryPromise` with the abort signal from Effect, and the timeout is `Effect.timeoutOrElse` with the same `PROBE_TIMEOUT_MS`, mapping to "unreachable". `testKey` runs it. All the messages stay byte-identical, and nothing from the error object reaches a message.
3. **Tests:** the existing git and connections tests must pass unchanged. Add one test per file for interruption: an interrupted probe aborts its fetch signal; a proxy request whose token call never resolves can be interrupted.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, the two files and their tests (`git grep -l "createGitProxy\|createProviderProbe" apps/server/src`).

### Allowed files
`apps/server/src/git/proxy.ts`, `apps/server/src/git/proxy.test.ts`, `apps/server/src/connections/probe.ts`, `apps/server/src/connections/probe.test.ts`, `work/T-0761-server-edges-c.md`.

If a listed test file does not exist, create it.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/git src/connections
pnpm gate
```

### Acceptance
- Both files import Effect, with no async handler bodies or try/catch left.
- The exported signatures and behaviour are unchanged, and the tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

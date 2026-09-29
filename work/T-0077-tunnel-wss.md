---
id: T-0077
title: Runner tunnel — accept wss:// server URLs in RunnerClient (TLS to the hub)
status: review
milestone: M3
branch: task/T-0077-tunnel-wss
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0008]
estimate: 0.25 day
---

# T-0077: wss:// for the runner client

## Spec (written by Claude, do not edit)

### Goal

`RunnerClient` only accepts `ws://` server URLs (`packages/runner-tunnel/src/runner.ts`, its config schema). A runner cannot connect to a hub that sits behind TLS, which is how it will be deployed. Allow `wss://` in the **client**, and keep the server side as it is (the hub binds to loopback and a reverse proxy terminates TLS).

### Read first
- `AGENTS.md` (mandatory)
- `packages/runner-tunnel/src/runner.ts` (the config schema and where `serverUrl` is used to open the socket), `server.ts` (for context only), `runner.test.ts`
- `apps/runner/src/identity.ts`, `connect.ts` (they already accept `wss://` and hand the URL to `RunnerClient`)

### Allowed files
- `packages/runner-tunnel/src/runner.ts`, `packages/runner-tunnel/src/runner.test.ts`
- `packages/runner-tunnel/README.md` if it states the ws-only rule
- `work/T-0077-tunnel-wss.md`

**Not allowed:** anything else. No new dependencies.

### What to build
1. The `serverUrl` validation accepts `ws://` and `wss://` and nothing else (`http:`, `file:`, `javascript:` and garbage stay rejected). Certificate verification stays **on** (do not add any option that disables it).
2. Nothing else changes for `ws://`.

### Tests
- `wss://host:1234/tunnel` passes validation; `http://`, `https://`, `ftp://`, an empty string and a URL without a scheme are rejected with the same kind of error as today.
- Existing tests unchanged and green. You cannot run a real TLS server in the tests; assert only on validation, and say so in the Report.

### Acceptance criteria
- [ ] `wss://` accepted, everything else still rejected, TLS verification untouched.
- [ ] `pnpm exec turbo test --force --filter=@galena/runner-tunnel --filter=@galena/runner` passes.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/runner-tunnel --filter=@galena/runner --filter=@galena/server
pnpm build
```

### Out of scope
- The hub serving TLS itself, certificates, proxies.

---

## Report (written by the worker when done)

### What I did
- Loosened `RunnerOptionsSchema.serverUrl` in `packages/runner-tunnel/src/runner.ts` from `z.string().url().startsWith('ws://')` to a `.refine()` that accepts only `ws://` or `wss://` schemes. Everything else (`http:`, `https:`, `ftp:`, `file:`, `javascript:`, no scheme, empty string) is still rejected by either the `.url()` validator or the `.refine()`. The runtime socket constructor (`new WebSocket(this.serverUrl, ...)`) and the rest of `RunnerClient` are untouched, so TLS verification stays on by default — no option to disable it was added.
- Added a `serverUrl validation` describe block to `packages/runner-tunnel/src/runner.test.ts` with 3 accept assertions (`ws://`, `wss://…`, `wss://host:1234/tunnel`) and 7 reject assertions (`http:`, `https:`, `ftp:`, empty, no scheme, `javascript:`, `file:`). Per the spec, these only exercise the validation — no real TLS server is dialed.
- `packages/runner-tunnel/README.md` was inspected: it does not state the ws-only rule, so no edit was needed.

### Files changed
- `packages/runner-tunnel/src/runner.ts` — schema now accepts `ws://` and `wss://`.
- `packages/runner-tunnel/src/runner.test.ts` — new `serverUrl validation` describe block.
- `work/T-0077-tunnel-wss.md` — status and report.

### Commands run and real results
- `pnpm install` — `Done in 6.6s`, lockfile up to date, 1010 packages.
- `pnpm --filter @galena/runner-tunnel test` — 9 files, 61 tests passed.
- `pnpm --filter @galena/runner-tunnel exec vitest run --reporter=verbose src/runner.test.ts` — 13/13 in that file, including the 10 new validation tests.
- `pnpm format:check` — after one prettier auto-fix on `runner.test.ts`, `All matched files use Prettier code style!`.
- `pnpm lint` — `oxlint .` exited 0.
- `pnpm typecheck` — `Tasks: 10 successful, 10 total`.
- `pnpm exec turbo test --force --filter=@galena/runner-tunnel --filter=@galena/runner --filter=@galena/server` — `Tasks: 3 successful, 3 total`. `@galena/runner-tunnel`: 9 files, 61 tests passed. `@galena/runner`: 6 files, 63 tests passed. `@galena/server`: 44 files passed (5 skipped), 613 tests passed (7 skipped).
- `pnpm build` — `Tasks: 2 successful, 2 total` (mobile + web; runner-tunnel has no build script).

### Problems, deviations from the spec, open questions
- The schema change replaced `.startsWith('ws://')` with `.refine(...)`. `.refine` requires a `.string().url()` chain to keep the URL parse before the prefix check, so the message I emit (`serverUrl must use ws:// or wss://`) replaces the zod default. This still surfaces as a thrown `ZodError` from `RunnerOptionsSchema.parse(...)`, identical in shape to the previous failure mode — only the message text is different.
- No real TLS handshake is tested: per the spec, only validation is asserted. The `ws` library in Node will use the system CA bundle for any future `wss://` connection, so verification is on by default and unaffected by this change.

### Blocked / needs a decision
- None.

---

## Review (written by Claude)

**Verdict:**

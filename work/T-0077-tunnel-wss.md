---
id: T-0077
title: Runner tunnel — accept wss:// server URLs in RunnerClient (TLS to the hub)
status: todo
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
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
-

---

## Review (written by Claude)

**Verdict:**

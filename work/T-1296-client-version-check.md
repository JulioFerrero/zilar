---
id: T-1296
title: "OPS-21: clients compare their protocol version with the server's — the server answers a minimum client protocol in /health, and web shows 'A new version is available — Reload' while mobile shows 'Please update the app' when the client is older; SEC-11: Better Auth logs its warnings and errors through the server logger"
status: merged
milestone: M5
branch: task/T-1296-client-version-check
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1296: Client version check; Better Auth warnings logged

## Spec (written by Claude, do not edit)

### Why
- **OPS-21** (P2, `docs/audit/ops-reliability-audit.md:183`): the server reports `protocolVersion` in `/health` (`apps/server/src/health.ts:3,23,78`, from `@zilar/protocol`), but clients never compare it. Open web tabs and old APKs keep calling a changed API with no "please update" path.
- **SEC-11** (P2, `docs/audit/security-audit.md:231`): `logger: { disabled: true }` in `apps/server/src/auth/auth.ts` silences Better Auth's own warnings, such as the rate-limit fallback to one shared bucket and "Invalid origin". The fix is a pino-backed logger object with `warn`/`error` only.

**First recheck both findings on main.** If one is already fixed, say so with `file:line` and skip it.

### What to build
1. **Server:** `/health` also returns `minClientProtocol`, a constant in `@zilar/protocol` next to `protocolVersion`, starting equal to the current version. Add a comment on when to raise it (a breaking API change).
2. **Clients:**
   - both compare their built-in `protocolVersion` with `minClientProtocol` at boot and on each foreground or focus, at most once per 10 minutes, using `/health`;
   - **web**, when older, shows a thin banner: "A new version is available." with a Reload button;
   - **mobile**, when older, shows a banner: "Please update the app to keep chatting.";
   - they never block use, and a failed `/health` call does nothing.
3. **SEC-11:** replace `logger: { disabled: true }` with a logger that forwards `warn` and `error` to the existing server logger (cite it) and drops `info`/`debug`. Never log request bodies or secrets.
4. **Test,** 1 case: the `/health` shape includes `minClientProtocol`. Use the nearest health test, or a tiny pure compare helper in `@zilar/protocol` with a test if no health test exists. Cite which.

### Read first
`AGENTS.md`, `docs/audit/ops-reliability-audit.md` (`:38`, `:176-186`), `docs/audit/security-audit.md` (`:231`), `apps/server/src/health.ts`, `apps/server/src/auth/auth.ts` and `packages/protocol/src/index.ts` (find `protocolVersion`).

### Allowed files
`apps/server/src/health.ts`, `apps/server/src/health*.test.ts`, `apps/server/src/auth/auth.ts`, `packages/protocol/src/**/*.ts`, `apps/web/src/components/*.tsx`, `apps/web/src/lib/*.ts`, `apps/web/src/App.tsx`, `apps/web/src/routes/ChatShell.tsx`, `apps/mobile/src/components/**/*.tsx`, `apps/mobile/src/lib/*.ts`, `apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/app/(tabs)/*.tsx`, `work/T-1296-client-version-check.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check:** the web mock shows no banner at the current version.

---

## Report (written by the worker when done)

**Status: done, gate green.** Both findings were still present on `main`, so both were fixed.

### What I did

**1. Server `/health` returns `minClientProtocol` (OPS-21).**
- `packages/protocol/src/version.ts`: added `minClientProtocol = '0.2.0'` next to `protocolVersion`, with a comment saying to raise it only on a breaking API change. Also added the pure `isClientOutdated(clientVersion, minimumVersion)` dotted-version compare helper.
- `packages/protocol/src/index.ts`: exports the two new names.
- `apps/server/src/health.ts`: `HealthBody` gains `minClientProtocol: string`, and `healthBody()` writes it next to `protocolVersion`.

**2. Web client banner.**
- New `apps/web/src/lib/useClientVersionCheck.ts`: reads `/health` (mock-aware), compares this build's `protocolVersion` with the server's `minClientProtocol`, at boot and on window focus / tab re-show, throttled to one check per 10 minutes. A failed or malformed `/health` answer changes nothing. The fetch is an Effect (`Effect.gen` + `tryPromise`) run through `runWeb`, per the repo's Effect ratchet.
- New `apps/web/src/components/ClientVersionBanner.tsx`: thin fixed top bar with "A new version is available." and a `Reload` button (`window.location.reload()`).
- `apps/web/src/App.tsx`: mounts `<ClientVersionBanner />` inside `BrowserRouter`.

**3. Mobile client banner.**
- New `apps/mobile/src/lib/use-client-version.ts`: same check via `${API_URL}/health`, at boot and on every `AppState` `active` (foreground), throttled to 10 minutes; run through `runMobile`.
- New `apps/mobile/src/components/client-version-banner.tsx`: thin top bar (safe-area padded, in-flow) with "Please update the app to keep chatting."
- `apps/mobile/src/app/_layout.tsx`: renders `<ClientVersionBanner />` above the root `Stack` inside a flex `View`.

**4. SEC-11 (Better Auth logging).**
- `apps/server/src/auth/auth.ts`: replaced `logger: { disabled: true }` with a logger object whose `log` forwards `warn`/`error` to the existing server logger (`main.ts:323` passes the pino logger into `createAuth`). Better Auth's own default level is `warn`, so `info`/`debug` are dropped; keeping `level` unset also stops its API-error handler (which logs through a global console logger, not this instance's) from double-logging client errors. Only Better Auth's formatted message string is forwarded (never `...args`, which can carry objects); the fields object stays empty.

### Files changed
- `packages/protocol/src/version.ts`, `packages/protocol/src/version.test.ts` (new), `packages/protocol/src/index.ts`
- `apps/server/src/health.ts`, `apps/server/src/auth/auth.ts`
- `apps/web/src/lib/useClientVersionCheck.ts` (new), `apps/web/src/components/ClientVersionBanner.tsx` (new), `apps/web/src/App.tsx`
- `apps/mobile/src/lib/use-client-version.ts` (new), `apps/mobile/src/components/client-version-banner.tsx` (new), `apps/mobile/src/app/_layout.tsx`
- `work/T-1296-client-version-check.md`

### Test choice (spec item 4)
There is no `/health` test (`apps/server/src/health.ts` has no companion test file), so per the spec I used the pure compare helper in `@zilar/protocol`: `packages/protocol/src/version.test.ts` covers `isClientOutdated` (equal / older / newer / missing parts padded with zero / malformed part) and asserts `minClientProtocol` is a dotted version not newer than `protocolVersion`.

### Commands and real results
- `pnpm install` — Done in 22.6s (1181 added); only the pre-existing `@types/react` peer warning.
- `pnpm --filter @zilar/protocol test --maxWorkers=2 --reporter=dot src/version.test.ts` — 1 file passed, 6 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/auth.test.ts` — 1 file passed, 36 tests passed.
- `pnpm gate` — **GATE PASS**. Summary lines:
  ```
  gate: 12 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (0.8s)
  PASS  lint  (0.9s)
  PASS  typecheck  (5.6s)
  PASS  effect  (1.0s)
  PASS  tests @zilar/mobile  (2.2s)
  PASS  tests @zilar/protocol  (2.5s)
  PASS  tests @zilar/server  (16.4s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Notes / deviations
- **Lead's check (web mock shows no banner at the current version):** `apps/web/src/mock/backend.ts` has no `/health` route, so in mock mode the check gets a JSON 404 and no banner renders at any version. `apps/web/src/mock/**` is outside my Allowed files, so I did not add a mock `/health`; on a real server `/health` carries `minClientProtocol` and the same compare runs. If you want to see the banner on the mock, the mock would need a `/health` route (a separate task).
- The Effect ratchet requires new `fetch`/`async` code to use Effect, so the two client checks are written as Effects rather than plain async functions.
- I did not add tests for the web/mobile UI (UI gets no tests per `AGENTS.md`) and did not edit `auth.test.ts` (outside Allowed files); SEC-11 forwarding is verified by code inspection of Better Auth's `createLogger` plus the auth suite passing, which confirms no secret leaks in the captured log output.

### Open questions
- None blocking.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (1 nit, 1 follow-up).**
- **Lead's checks after the rebase:** protocol vitest: 52 tests pass. tsc: 0 errors in server, web and mobile.
- **SEC-11:** the logger forwards only `warn` and `error`, with empty fields.
- **Nit, accepted:** Better Auth's extra args (stack and cause) aren't forwarded.
- **Follow-up done by the lead:** `docs/SERVER_CONFIG.md` now documents `minClientProtocol`.
- **Next:** WUX-44 (a reload prompt for a new web build) can build on this banner.

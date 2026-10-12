---
id: T-1296
title: "OPS-21: clients compare their protocol version with the server's — the server answers a minimum client protocol in /health, and web shows 'A new version is available — Reload' while mobile shows 'Please update the app' when the client is older; SEC-11: Better Auth logs its warnings and errors through the server logger"
status: todo
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

## Review (written by Claude)

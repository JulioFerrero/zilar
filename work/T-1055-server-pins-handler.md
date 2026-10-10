---
id: T-1055
title: "Dedup F2 (S2): pins/api.ts uses the shared handler() instead of three hand-written withErrorEnvelope blocks"
status: todo
milestone: M5
branch: task/T-1055-server-pins-handler
model: auto
effort: default
depends_on: [T-1051]
estimate: 0.1 day
---

# T-1055: Pins API on `handler`

## Spec (written by Claude, do not edit)

### Why
`docs/audit/dedup-status.md` §2 (slice S2). `apps/server/src/effect/http-core.ts:208` `handler(logger, body)` is exactly this: read the request id, `yield* CurrentUser`, run `body(request, user)` (a Promise is lifted like `Effect.promise`), and render defects through `withErrorEnvelope`.

The lead read the three hand-written copies of that in `apps/server/src/pins/api.ts:73-116` (`list`, `create`, `remove`) on main, 2026-10-10.

The other `withErrorEnvelope` sites in the audit are public routes with no session: `auth/api.ts:225` `checkInvite`, `setup/api.ts:216,232`, and `machines/api.ts:311` `pair`. `handler` needs `CurrentUser`, so they stay as they are.

### What to build
1. **The three handlers:** in `apps/server/src/pins/api.ts`, rewrite `list`, `create` and `remove` with `handler(logger, (request, user) => ...)`, the way `apps/server/src/blocks/api.ts:83` does. Keep each service call and its arguments exactly as they are:
   - `list` returns `{ pins }` from `listPins(serviceDeps(), request.query.chat, user.id)`;
   - `create` returns `pinMessage(serviceDeps(), { ...request.payload, actorId: user.id })`;
   - `remove` returns `unpinMessage(serviceDeps(), request.params.id, user.id)`.
2. **Comments:** keep the comments above each `.handle`.
3. **Imports:** drop the imports that become unused (`withErrorEnvelope`, `requestIdOf`, `CurrentUser` and `Effect`, if nothing else uses them; `grep` first).
4. **No other file changes.** The rate-limit layers and `apiLayer` stay as they are.

### Read first
`AGENTS.md`, `apps/server/src/effect/http-core.ts:185-232`, `apps/server/src/pins/api.ts`, and `apps/server/src/blocks/api.ts:75-95`.

### Allowed files
`apps/server/src/pins/api.ts`, `work/T-1055-server-pins-handler.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- `grep -n "withErrorEnvelope" apps/server/src/pins/api.ts` prints nothing.

---

## Report (written by the worker when done)

## Review (written by Claude)

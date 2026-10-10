---
id: T-1055
title: "Dedup F2 (S2): pins/api.ts uses the shared handler() instead of three hand-written withErrorEnvelope blocks"
status: merged
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

### What I did
- Rewrote the three pins handlers in `apps/server/src/pins/api.ts` with the shared `handler(logger, (request, user) => ...)` from `../effect/http-core`, the way `apps/server/src/blocks/api.ts:83` does. Service calls and arguments are unchanged:
  - `list`: `{ pins: await listPins(serviceDeps(), request.query.chat, user.id) }` (async body, since the return is a lifted `{ pins }`).
  - `create`: `pinMessage(serviceDeps(), { ...request.payload, actorId: user.id })`.
  - `remove`: `unpinMessage(serviceDeps(), request.params.id, user.id)`.
- Kept the comments above each `.handle`.
- Removed the now-unused imports: `Effect` (from `effect`), `CurrentUser` (from `@zilar/api-contract`), and `withErrorEnvelope` + `requestIdOf` (from `../effect/http-core`); added `handler`. Grepped first: `Effect`, `CurrentUser`, `withErrorEnvelope` and `requestIdOf` were only used inside the three old handlers.
- Rate-limit layers, `apiLayer`, route array and everything else are unchanged.

### Deviation from the spec
- The local `const { handler } = HttpRouter.toWebHandler(...)` (line 107) shadowed the imported `handler`, so the import was reported unused and the new call sites resolved to the `const` binding (TDZ). I aliased the local as `const { handler: effectHandler }` and returned `{ handler: effectHandler, routes: PINS_API_ROUTES }`, matching the existing precedent in `apps/server/src/gifs/api.ts:357`. This is the only change beyond the three handlers and the imports; it is inside the Allowed file. Without it `pnpm gate` failed at lint (`Identifier 'handler' is imported but never used`).

### Files changed
- `apps/server/src/pins/api.ts`
- `work/T-1055-server-pins-handler.md`

### Commands and results
- `pnpm install`: done, 15 workspace projects, 12.3s.
- Single tests: none run. There are no pins test files (`rg` found no `pins` tests; the gate reports `SKIP tests @zilar/server (no nearby test files)`).
- `grep -n "withErrorEnvelope" apps/server/src/pins/api.ts`: no output, exit 1 (Acceptance met).
- `pnpm gate` (from repo root), real summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (1.1s)
  PASS  lint  (0.8s)
  PASS  typecheck  (3.3s)
  PASS  effect  (1.5s)
  SKIP tests @zilar/server (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / open questions
- None. No test added: this is a behavior-preserving refactor of the message pipeline's pin endpoints, not a bug fix, and the repo has no pins tests.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The change:** `list`, `create` and `remove` in `apps/server/src/pins/api.ts` now use `handler(logger, …)` instead of three hand-written `requestIdOf` + `withErrorEnvelope` + `CurrentUser` blocks.
  - Each service call keeps its exact arguments.
  - `list` is an async body returning `{ pins }`. A rejection is still a defect, rendered by the same envelope.
  - The local `HttpRouter.toWebHandler` result is renamed `effectHandler` to avoid the name clash, and the returned `handler` key is unchanged.
- **Same behaviour:** `handler` (`effect/http-core.ts:208`) does exactly what the removed blocks did. The lead read every changed line.
- **The lead's check:** no pins tests remain, so the lead ran `src/authz-sweep.test.ts` on the branch: 5 of 5 passed.
- **Check:** the gate passed.

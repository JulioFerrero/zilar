---
id: T-0074
title: Web — route ConnectionsPage through the shared `request()` and drop the global fetch wrapper from mock mode
status: todo
milestone: M2
branch: task/T-0074-connections-through-request
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0069]
estimate: 0.5 day
---

# T-0074: ConnectionsPage through `request()`

## Spec (written by Claude, do not edit)

### Goal

`routes/ConnectionsPage.tsx` carries a private copy of `request()` that calls `fetch` directly (T-0028). Because of it, the mock layer (T-0069) has to replace `globalThis.fetch` for the whole page load. That is a hack: it makes every other `fetch` in dev mock mode go through the wrapper, and the page duplicates error handling. Move the page's calls into `lib/api.ts` next to `listConnections`, use them from the page, and delete both the private `request` and the global wrapper. Behavior on screen must stay the same.

### Read first
- `AGENTS.md` (mandatory)
- `apps/web/src/routes/ConnectionsPage.tsx` and `ConnectionsPage.test.tsx`
- `apps/web/src/lib/api.ts` (`request`, `ApiError`, `listConnections`, the AI functions as a model) and `api.test.ts`
- `apps/web/src/mock/api.ts` (the routes for `/connections`, `createMockFetch`, `installMockFetch` and the auto-install block at the bottom) and `mock/api.test.ts`
- The server contract: `apps/server/src/connections/routes.ts` (paths, bodies, statuses, error shapes)

### Allowed files (under `apps/web/`)
- `src/routes/ConnectionsPage.tsx`, `src/routes/ConnectionsPage.test.tsx`
- `src/lib/api.ts`, `src/lib/api.test.ts`
- `src/mock/api.ts`, `src/mock/api.test.ts`
- `work/T-0074-connections-through-request.md` (path from the repo root)

**Not allowed:** anything else. No new dependencies.

### What to build
1. In `lib/api.ts` add typed, zod-validated functions for every call the page makes (create, test, remove, and whatever else it does; `listConnections` already exists). They use `request()`, so errors are `ApiError` like everywhere else. Reuse the existing `connectionSchema`; export the result types the page needs.
2. Change the page to call them. The error text the user sees must not change: where the page showed the server's `error.message`, it still does (look at how `ApiError` exposes it). A network failure still reads "Could not reach the server" (check what `request()` throws today and keep the visible text).
3. Make sure the mock layer serves those routes through `mockRequest` (they may already exist; add what is missing, including the test-connection call).
4. Delete the private `request`/`loadConnections`/`errorBodySchema` in the page, and remove `createMockFetch`/`installMockFetch` and the auto-install block from `mock/api.ts` together with the tests that only covered them. If something else still imports them, stop and say so in the Report instead of guessing.

### Tests
- The page tests keep passing with the fetch fakes updated only where the call path changed; add tests for each new `api.ts` function (path, method, body, schema failure) in the style of the existing ones.
- One test that the mock layer answers the connection routes (`mockRequest`).
- No test may depend on a real network.

### Live check (the lead does it)
Not needed from you. If you can, run the web dev server on a **free port other than 3000, 5173 and 8081** in mock mode and take a screenshot of the connections page working; say what you did in the Report. Never touch the ports above.

### Acceptance criteria
- [ ] `ConnectionsPage.tsx` no longer calls `fetch` and has no private request helper.
- [ ] `globalThis.fetch` is never replaced by the app.
- [ ] Same on-screen behavior and error texts; mock mode still shows a working connections page.
- [ ] No `any`, no `@ts-ignore`, no new dependencies.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/web
pnpm build
```

### Out of scope
- New features on the connections page, styling, the server.

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

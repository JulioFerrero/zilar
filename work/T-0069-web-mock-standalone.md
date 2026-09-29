---
id: T-0069
title: Web mock mode — gate `?mock=1` to dev builds, and make it run standalone (fake session, mock /api data for AIs and connections)
status: todo
milestone: M2
branch: task/T-0069-web-mock-standalone
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0060, T-0062]
estimate: 1 day
---

# T-0069: Web mock mode, gated and standalone

## Spec (written by Claude, do not edit)

### Goal

Two problems, one fix:
1. **A production build honors `?mock=1`.** Anyone can send a link like `https://…/c/x?mock=1` and a signed-in user sees fake chats (the same hole T-0063 closed on mobile).
2. **Mock mode does not run on its own.** The QA sweep (T-0060) had to fake `/api/auth/get-session` by hand, the AI panel and the New AI dialog are dead ends without `/api/ais` and `/api/connections`, and workers cannot screenshot those screens.

So: `?mock=1` is honored only in dev builds (or with `VITE_MOCK=1`), and in mock mode the app needs no server at all.

### Read first
- `AGENTS.md` (mandatory)
- `apps/web/src/store/ChatStoreProvider.tsx` (`isMockMode`), `auth/AuthProvider.tsx`, `lib/api.ts` (`request`, all the exported calls and their zod schemas), `lib/auth.ts`, `routes/AppRoutes.tsx` (`RequireAuth`, the name page)
- `apps/web/src/mock/index.ts`, `mock/chats.ts` (existing mock data; mock AIs and owned AIs already exist there), `components/ais/AisPage.test.tsx` and `NewAiDialog.test.tsx` (how the real calls are faked in tests today)
- Vite env: `import.meta.env.DEV`, `MODE`, `VITE_MOCK`

### Allowed files (under `apps/web/`)
- `src/store/ChatStoreProvider.tsx`, `src/auth/AuthProvider.tsx`, `src/lib/api.ts`, `src/lib/auth.ts`, `src/routes/AppRoutes.tsx`, plus their tests
- `src/mock/gate.ts` (new), `src/mock/api.ts` (new: the mock HTTP layer), plus tests for both
- `src/vite-env.d.ts` if a new env typing is needed
- `screenshots` are not needed; put none in the repo
- `work/T-0069-web-mock-standalone.md`

**Not allowed:** `src/mock/messages.ts`, `chats.ts`, `index.ts` (another task edits them; if you need new mock data, put it in `mock/api.ts`), the store files (`realStore.ts`, `store.ts`), components, `apps/mobile/**`, `apps/server/**`, `packages/**`, `docs/**`. No new dependencies.

### What to build

1. **One gate (`mock/gate.ts`).** `isMockMode()`, the only place that decides:
   - true when `import.meta.env.MODE === 'test'` or `import.meta.env.VITE_MOCK === '1'` (unchanged);
   - true for `?mock=1` in the URL **only when `import.meta.env.DEV` is true**;
   - false otherwise (a production build ignores the param).
   `ChatStoreProvider` re-exports or imports it (keep the existing import path working for tests). A pure inner function `resolveMockMode({ mode, viteMock, dev, search })` makes it unit-testable. Tests: every combination that matters, including production + `?mock=1` → false and `?mock=0`.
2. **Standalone session.** In mock mode `AuthProvider` reports `authenticated` with a fixed mock user (the same user id/name the mock store uses; check `store.ts` for `currentUserId`), without calling Better Auth, and `RequireAuth` lets the app through (including no redirect to the name page). Outside mock mode nothing changes.
3. **Mock HTTP layer (`mock/api.ts`).** `mockRequest(path, init)` used by `request()` in `api.ts` when `isMockMode()` is true, **before any `fetch`**. It answers, with data that passes the same zod schemas the real responses do:
   - `GET /me`, `PATCH /me`;
   - `GET /chats`, `GET /contacts` (derived from the existing mock data, or a small fixed list if that is not exported; do not edit the mock data files);
   - `GET /ais`, `GET /ais/:id`, `POST /ais`, `PATCH /ais/:id`, `DELETE /ais/:id`: an in-memory list seeded with 2 AIs (one with usage `null`, one at 85% of its daily limit), edits and deletes apply to the memory list;
   - `GET /connections`, `POST /connections/…/test`, `DELETE`: 2 connections;
   - anything else → an `ApiError` with status 404 and code `mock_not_implemented`.
   It must add a small async delay (about 150 ms, injectable in tests) so loading states are really exercised, and it must never touch the network. Data is per page load (in memory), never persisted.
4. **Guard.** Add a test that with `import.meta.env.DEV` false and `?mock=1`, `request()` still calls the real `fetch` (spy) and does not use the mock layer, and that `AuthProvider` does not fake a session.
5. In mock mode, the app shows nothing that suggests it is a production session, but the header of the AIs page or the sidebar may show a tiny "Mock data" hint in muted mono text (optional; skip if it needs edits outside Allowed files).

### Tests (Vitest, no network)
- Gate combinations (above).
- Mock layer: each route validates against the real schema from `api.ts` (import the exported types/schemas or parse through the exported functions with mock mode on); create/patch/delete on `/ais` change what `GET /ais` returns; the 404 fallback; the delay is honored with fake timers.
- Auth: mock mode → authenticated mock user, guest otherwise.
- Existing web tests must pass unchanged (they run with `MODE === 'test'`, so mock mode is on there today; make sure component tests that inject their own fakes are not silently switched to the mock HTTP layer. If `request()` is faked at a different level today, keep that working).

### Integration / visual check
- With `pnpm --filter @galena/web dev` on **your own port** (`--port 52xx --strictPort`, never 3000, 3188, 5173, 8081), open `/?mock=1`, `/ais?mock=1` and `/c/<a mock chat id>?mock=1` **without any API running**, and confirm they render (use the Chrome tools if you have them; downscale screenshots with `sips -Z 900`; at most 8 images). Then run `pnpm --filter @galena/web build`, serve the build with `vite preview` on your own port, and confirm `/?mock=1` now goes to the login page (production ignores the param). Stop every server you start.
- No screenshots are committed.

### Acceptance criteria
- [ ] A production build ignores `?mock=1` (proved by unit tests and the preview check).
- [ ] In dev, `?mock=1` shows the chats, the AI list and panel, the New AI dialog and the connections page with no server.
- [ ] The real app path (no mock) is unchanged.
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
- Mock data for groups beyond what exists, mock XMPP, mobile, the server, a Storybook.

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

### Findings
-

### Follow-ups
-

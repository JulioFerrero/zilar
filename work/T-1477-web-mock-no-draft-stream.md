---
id: T-1477
title: "Web mock mode stops opening the live /api/drafts/stream EventSource (it 404s against vite and retries on every page); the mock store gets a no-op draft stream"
status: merged
milestone: M5
branch: task/T-1477-web-mock-no-draft-stream
model: auto
effort: default
depends_on: []
estimate: 0.05 day
---

# T-1477: No live draft stream in web mock mode

## Spec (written by Claude, do not edit)

### Why
In the lead's headless sweep of web mock mode (2026-10-15), every page logs "Failed to load resource: 404" for `/api/drafts/stream`, 12 times over five page loads.
- Mock mode builds the real store, and its draft port defaults to a real `EventSource`.
- An `EventSource` bypasses the mock fetch, so it reaches vite, gets 404, and retries with backoff.
- It is console noise, plus a request loop in the mock that hides real errors during QA.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/web/src/store/ChatStoreProvider.tsx:36-38`:** in mock mode it calls `createRealChatStore({ createXmpp })`.
- **`apps/web/src/store/effects/ports.ts:219`:** `RealStoreDeps.openDrafts?: OpenDraftStream`. It defaults to `subscribeToDrafts` (`:324`, `:335`), which opens `new EventSource('/api/drafts/stream')` (`apps/web/src/lib/drafts.ts:38`, `:55`, `:120`).
- **`OpenDraftStream`** is `(onEvent) => () => void` (`apps/web/src/lib/drafts.ts:35`).
- **The test fakes** already use a no-op, `() => () => undefined` (`ports.ts:388`).

### What to build
1. In `ChatStoreProvider.tsx`, the mock-mode store passes `openDrafts: () => () => undefined` next to `createXmpp`, with a one-line comment (mock mode has no draft stream; an `EventSource` would bypass the mock and 404).
2. The real store is unchanged.

### Tests
None.

### Allowed files
`apps/web/src/store/ChatStoreProvider.tsx`, `work/T-1477-web-mock-no-draft-stream.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The lead's headless mock sweep shows no `/api/drafts/stream` 404.

---

## Report (written by the worker when done)

### What I did
In mock mode, `ChatStoreProvider` now passes `openDrafts: () => () => undefined` next to
`createXmpp` when it builds the real store, with a one-line comment explaining that mock
mode has no draft stream (an `EventSource` would bypass the mock fetch and 404 against
vite). The real store's default draft stream (`subscribeToDrafts`) is unchanged.

### Files changed
- `apps/web/src/store/ChatStoreProvider.tsx` — mock-mode store deps.
- `work/T-1477-web-mock-no-draft-stream.md` — front matter + this Report.

### Commands run
- `pnpm install`: done, 17 workspace projects, 12.7s.
- Single tests: none — the spec says "Tests: None" and the change is UI wiring.
- `pnpm gate`: GATE PASS.
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.6s)
  PASS  lint  (1.0s)
  PASS  typecheck  (4.5s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/web  (5.4s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Deviations from the spec
None. The comment is two lines (one sentence) rather than literally one line, to keep it
inside the repo's line width.

### Blocked / needs a decision
None.

### Acceptance
- Gate passes (see above).
- The lead's headless mock sweep is not something I can run here; the code change removes
  the mock-mode `EventSource` (no-op `openDrafts`), which is what produced the
  `/api/drafts/stream` 404.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 0. The headless mock sweep over five pages shows no 404 at all (main had 12 for `/api/drafts/stream`).

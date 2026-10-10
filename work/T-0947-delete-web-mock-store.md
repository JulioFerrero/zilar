---
id: T-0947
title: "Mock sweep O: delete the web mock store (apps/web/src/store/mockStore.ts, 1,294 lines), its production stub and the vite alias, now that web mock mode runs the real store"
status: todo
milestone: M5
branch: task/T-0947-delete-web-mock-store
model: auto
effort: default
depends_on: [T-0946]
estimate: 0.25 day
---

# T-0947: Delete the web mock store

## Spec (written by Claude, do not edit)

### Why
Since T-0946 (merged), web mock mode runs the real store on `@zilar/mock-backend`. `apps/web/src/store/ChatStoreProvider.tsx` always calls `createRealChatStore()`. The hand-written mock store is now dead code. This is task O of the deletion sweep in `docs/audit/mock-plan.md` section 4.

What still references it (the lead grepped main on 2026-10-10):
- `apps/web/src/store/store.ts:37-41`: the re-export of `createChatStore` and `ChatStoreSeed` from `@/store/mockStore`;
- `apps/web/src/mock/storeStub.ts` (9 lines): the production stand-in;
- `apps/web/vite.config.ts:13-18`: the alias that swaps `@/store/mockStore` for the stub in a production build.

### What to build
1. **Delete** `apps/web/src/store/mockStore.ts` and `apps/web/src/mock/storeStub.ts`, the re-export lines in `store.ts`, and the alias block in `vite.config.ts` (keep the `@` alias).
2. **Check with grep** that nothing else imports `createChatStore`, `ChatStoreSeed`, `mockStore` or `storeStub`. If something does, it is dead mock wiring: delete it too and list it in the Report. If a live file needs it, stop and report.
3. **No other change, no tests.**

### Read first
`AGENTS.md`, `apps/web/src/store/store.ts`, `apps/web/vite.config.ts`, and `apps/web/src/store/ChatStoreProvider.tsx`.

### Allowed files
`apps/web/src/store/mockStore.ts`, `apps/web/src/mock/storeStub.ts`, `apps/web/src/store/store.ts`, `apps/web/vite.config.ts`, `work/T-0947-delete-web-mock-store.md`.

### Checks
```bash
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/web exec vitest run --reporter=dot
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report gives the lines deleted and the grep showing no importer remains.

---

## Report (written by the worker when done)

## Review (written by Claude)

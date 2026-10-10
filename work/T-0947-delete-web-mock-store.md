---
id: T-0947
title: "Mock sweep O: delete the web mock store (apps/web/src/store/mockStore.ts, 1,294 lines), its production stub and the vite alias, now that web mock mode runs the real store"
status: merged
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

### What I did
Deleted the dead web mock store and its production wiring, exactly per the Spec.

### Files changed
- **Deleted** `apps/web/src/store/mockStore.ts` (1,294 lines).
- **Deleted** `apps/web/src/mock/storeStub.ts` (9 lines).
- **`apps/web/src/store/store.ts`**: removed the 3-line comment plus the two re-exports (former lines 37-41):
  ```ts
  // The in-memory mock store lives in `mockStore.ts`; re-exported so every
  // existing import of `createChatStore` keeps working.
  // A production build swaps `@/store/mockStore` for a stub (see vite.config.ts).
  export { createChatStore } from '@/store/mockStore';
  export type { ChatStoreSeed } from '@/store/mockStore';
  ```
  Also dropped the now-blank line that separated them from `ConnectionStatus`.
- **`apps/web/vite.config.ts`**: removed the production alias block (former comment + the `...(mode === 'production' && loadEnv(...) …)` spread, lines 13-18). The `@` alias is kept. Removing the block left `loadEnv` and the config's `mode` argument unused, so I also dropped the `import { loadEnv } from 'vite'` and the `({ mode })` wrapper (`defineConfig({ … })`), or lint/typecheck would fail on unused symbols. This is the only change beyond the literal alias block.

### Grep: no importer remains
`grep -rn 'createChatStore|ChatStoreSeed|mockStore|storeStub|loadEnv' apps/web` → **No matches found**. The repo-wide grep (92 hits) has no remaining source reference: every other hit is docs under `docs/` and `work/`, the mobile app's own unrelated `createChatStore` in `apps/mobile/src/store/chat-store.ts`, or a classifier regex in `packages/devtools/src/code-map/collect.ts:85` that matches the string `mockStore` to label files — it is not an import and stays correct without the file (left untouched; it is outside the Allowed files and is not dead mock wiring).

### Commands and real results
- `pnpm install` → "Done in 16.5s" (only the usual peer-dependency warning for `@types/react-dom` in `apps/mobile`).
- Per AGENTS.md I did not run typecheck/lint/tests one by one; `pnpm gate` runs them. I did run the build separately because gate does not cover it, and the task changes the Vite config:
- `pnpm --filter @zilar/web build` → `✓ built in 872ms` (only the pre-existing "chunks larger than 500 kB" warning).
- `pnpm gate` (from repo root):
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (0.6s)
  PASS  lint  (1.3s)
  PASS  typecheck  (4.3s)
  PASS  effect  (1.2s)
  PASS  tests @zilar/web  (3.8s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
No single test files were run beyond gate's @zilar/web suite; no test writes were needed (no test referenced the deleted symbols).

### Deviations / notes
- The extra `loadEnv` import and `mode` argument removal in `vite.config.ts` (described above) is the only change not literally spelled out in the Spec; it is required to keep the file lint/typecheck-clean after deleting the alias block.
- `packages/devtools/src/code-map/collect.ts` still lists `mockStore` in its classifier regex. It is outside the Allowed files and is not an importer, so I left it. Flagging it in case the lead wants it updated in a later sweep.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 follow-up.**
- **The deletion:** `mockStore.ts` (1,294 lines), `storeStub.ts`, the re-export in `store.ts` and the production alias in `vite.config.ts`. That is 1,322 lines deleted and nothing left importing them.
- **Follow-up:** the code-map classifier's `mockStore` pattern (`packages/devtools/src/code-map/collect.ts:80,85`) can go when the mock sweep ends.
- **Check:** the gate passed, and so did the web build and the 8 tests.

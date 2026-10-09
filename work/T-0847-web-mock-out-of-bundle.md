---
id: T-0847
title: "Web: the mock backend and mock store leave the production bundle (build-time gate plus dynamic imports)"
status: todo
milestone: M5
branch: task/T-0847-web-mock-out-of-bundle
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0847: Web: the mock backend and mock store leave the production bundle (build-time gate plus dynamic imports)

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Finding D-W1 / G-F6 in `docs/audit/simplify-2026-10-09/D-web.md` and `docs/audit/simplify-2026-10-09/G-deadcode.md`.
- **The mock is imported statically:**
  - `apps/web/src/lib/api.ts:4-5` imports `isMockApiEnabled` and `mockRequest` from `@/mock/*`, and so does `apps/web/src/lib/tools.ts:9-10`;
  - `apps/web/src/store/store.ts:39` re-exports `createChatStore` from `./mockStore`;
  - `apps/web/src/store/ChatStoreProvider.tsx:22` does `isMockMode() ? createChatStore() : createRealChatStore()`;
  - `StickerPanel.tsx:21-22` imports `mockGifItems`, and `AuthProvider.tsx:8-9` imports `currentUserId` from the mock.
- **Why it cannot be dropped:** `apps/web/src/mock/gate.ts:34` decides at run time, so the bundler keeps about 112 KB minified (about 8% of the single 1.4 MB chunk). The fixture string "Acme Announcements" is in `apps/web/dist`.
- **Who uses the mock:** tests (33 test files use `createChatStore`, 15 use `setMockDelay`) and dev `?mock=1`.

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Make the mock decision a build-time constant that Vite folds: an inline `import.meta.env.DEV || import.meta.env.MODE === 'test' || import.meta.env.VITE_MOCK === '1'` check. Read `gate.ts` for the exact current conditions and keep them identical in dev and tests.
2. Reach the mock modules only through `await import()` inside those branches, or move the static imports behind a module that production does not import. Keep every public function signature the same; where a sync API needs the mock, find a shape that keeps tests unchanged.
3. Fix the "ineffective dynamic import" warnings for `lib/api` in `mockStore.ts`.
4. **Verify the build:** run `pnpm --filter @zilar/web build`, then `grep -c "Acme Announcements" apps/web/dist/assets/*.js`, which must be 0 for the main chunk. Report the main chunk size before and after (gzip too).
5. The tests must pass unchanged. If a test needs a change because of the async import, keep it minimal and list it.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`apps/web/src/lib/api.ts`, `apps/web/src/lib/tools.ts`, `apps/web/src/mock/**`, `apps/web/src/store/store.ts`, `apps/web/src/store/mockStore.ts`, `apps/web/src/store/ChatStoreProvider.tsx`, `apps/web/src/components/StickerPanel.tsx`, `apps/web/src/auth/AuthProvider.tsx`, `apps/web/src/**/*.test.ts`, `apps/web/src/**/*.test.tsx`, `apps/web/vite.config.ts`, `work/T-0847-web-mock-out-of-bundle.md`.

This task runs the whole web suite (16 s), because the mock touches every store test.

### Checks (wave mode)
```bash
pnpm --filter @zilar/web test --reporter=dot
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/web build
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Every number the spec asks for (sizes, timings, counts) is in the Report, measured.
- Live check for Julio's single test: Web loads and works normally; `?mock=1` still works in dev.

---

## Report (written by the worker when done)

## Review (written by Claude)

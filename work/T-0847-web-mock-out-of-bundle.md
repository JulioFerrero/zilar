---
id: T-0847
title: "Web: the mock backend and mock store leave the production bundle (build-time gate plus dynamic imports)"
status: merged
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

**Lead, 2026-10-10: approved.**
- **What changed:** the mock backend now loads through a dynamic import behind the same gate as `gate.ts`, and a production build swaps the mock store for a stub. The main chunk drops 1,437 → 1,323 kB (gzip 416 → 387 kB), and the fixture text is gone from the bundle.
- **Checks:** the combined check is clean.
- **Not this task:** the `Composer.voice` flake fails on base too; it is a follow-up.
- **Still open:** StickerPanel and AuthProvider still import `mock/helpers` and `mock/ids`; they go to T-0882.
- **Incident:** an early `git stash` swapped changes with T-0846. Both trees were checked clean, and the brief now forbids `git stash`.

### Report

**What changed** (commit 11f926ff)
- `apps/web/src/mock/load.ts` (new): `loadMockRequest()` has the inline fold-able check (`DEV || MODE === 'test' || VITE_MOCK === '1'`, same conditions as `gate.ts`) and reaches `mock/api` only via `await import()`. `lib/api.ts` (6 sites) and `lib/tools.ts` (1 site) use `await (await loadMockRequest())(...)`; signatures unchanged.
- `apps/web/src/mock/storeStub.ts` (new) plus an alias in `vite.config.ts`: a production build without `VITE_MOCK=1` resolves `@/store/mockStore` to the stub. The store must stay synchronous (33 test files, `ChatStoreProvider`), so a dynamic import was not an option. `store.ts` now re-exports from `@/store/mockStore` (the alias target). Dev and tests keep the real module.
- The INEFFECTIVE_DYNAMIC_IMPORT warning for `lib/api` is gone from the build output.
- Not changed: `StickerPanel.tsx` (`mock/helpers`) and `AuthProvider.tsx` (`mock/ids`): both are small, and "Acme Announcements" is gone without touching them.

**Measured** (`pnpm --filter @zilar/web build`)
- Main chunk before: 1,437.39 kB, gzip 416.18 kB. After: 1,322.72 kB, gzip 387.10 kB (-114.7 kB, -8.0%; gzip -29.1 kB).
- `grep -c "Acme Announcements" dist/assets/*.js`: before 1, after 0 (only one JS chunk).

**Checks**
- typecheck: clean. oxlint and prettier on changed files: clean. build: ok.
- Tests (full web suite, 1943 tests): `Composer.voice.test.tsx` fails 1-3 tests per run in 4 runs after the change (3 of 3 runs are NOT green). The same file fails 3 of 11 on the clean base commit (checked without my changes), so it is not caused by this task. `TopicPanel.test.tsx` failed once in the first full run, then passed in the later runs (flaky under load). No test was changed.

**Behaviour differences**: none intended. Not live-checked in a browser (`?mock=1` in dev takes the unchanged dev path).

**Unsure**: Composer.voice failure is pre-existing ("Unable to find a label with the text of: Send voice message"). Also: an early `git stash`/`pop` of mine collided with another worktree's stash (stashes are shared across worktrees); I popped a foreign mobile change, saved it as a patch in my scratchpad (`foreign-mobile.patch`), and reverted it here. If another task lost its stash, that is the cause.

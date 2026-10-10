---
id: T-0891
title: "api-contract prep for parallel group moves: one Session/CurrentUser (no pins bridge), per-chain blocks in the shared lists, per-group smoke test files"
status: merged
milestone: M5
branch: task/T-0891-contract-prep-chains
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-0891: api-contract prep for parallel group moves

## Spec (written by Claude, do not edit)

### Why
Phase 3 of the simplify plan (`docs/audit/simplify-plan.md`) moves every JSON API group into `packages/api-contract`, following the recipe in the Report of `work/T-0864-api-contract-pilot.md` ("How to move a group"). Four Sonnet chains will move groups in parallel (T-0892 to T-0895).

Every group move edits the same few lines, so the chains would conflict:
- **`packages/api-contract/src/api.ts`:** `export const ZilarApi = HttpApi.make('zilar').add(PinsGroup);`, a single line.
- **`packages/api-contract/src/index.ts`:** six `export *` lines.
- **`apps/server/src/contract-smoke.test.ts`:** 128 lines, one file for all groups.

Recipe step 3 also says that the first group moved after the pilot should change `apps/server/src/effect/http-core.ts` to re-export `Session`/`CurrentUser` from the contract, and delete `contractSessionLayer` from `apps/server/src/pins/api.ts` (lines 45 and 189 today). Four chains doing that at once would collide.

### What to build
1. **One Session/CurrentUser:**
   - The server's `Session` and `CurrentUser` (`apps/server/src/effect/http-core.ts:29,38`) become re-exports of the contract's (`packages/api-contract/src/middleware.ts:19,27`). The keys are already identical (`zilar/effect/http/CurrentUser`, `zilar/effect/http/Session`).
   - Keep `sessionLayer(auth, logger)` and its T-0858 cookie-cache behaviour exactly as they are, and make it provide the contract tag.
   - Delete `contractSessionLayer` from `apps/server/src/pins/api.ts`, so pins uses `sessionLayer` like every other module.
   - Every server test must pass unchanged.
2. **Conflict-free shared lists for four chains:**
   - In `packages/api-contract/src/api.ts`, build `ZilarApi` as `HttpApi.make('zilar').add(PinsGroup)` followed by four clearly separated, commented blocks: `// Chain A (T-0892)`, `// Chain B (T-0893)`, `// Chain C (T-0894)` and `// Chain D (T-0895)`.
     - Each block must leave at least two unchanged lines between it and the next, so additions in different blocks merge without git conflicts.
     - Use one array per chain, for example `const chainAGroups = [] as const`, spread into the `HttpApi` with `.add(...)` per entry, or another typed pattern where adding a group is one new line inside that chain's block. The `HttpApi` type must still carry each group, so the derived client is typed. Check how `HttpApi.add` composes in `node_modules/effect/dist` before choosing.
   - Do the same in `packages/api-contract/src/index.ts`: the existing exports, then four separated chain blocks.
3. **Per-group smoke files:**
   - Move the shared setup of `apps/server/src/contract-smoke.test.ts` (the `cookieClient`/`bearerClient` builders, `TEST_BASE_URL`, the `app.request` fetch) into `apps/server/src/contract-smoke-support.ts`, a non-test file name.
   - Keep the pins cases as `apps/server/src/pins/contract.smoke.test.ts`, using the support module.
   - The test count stays the same.
4. **Recipe update:** add a short section to `docs/API_CONTRACT_RECIPE.md` (new file) that copies the T-0864 recipe and adds:
   - "add your group in your chain's block in `api.ts` and `index.ts`";
   - "your smoke case goes in `apps/server/src/<x>/contract.smoke.test.ts` using `contract-smoke-support.ts`";
   - "`Session`/`CurrentUser` come from `@zilar/api-contract` (no bridge)".

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), the Report of `work/T-0864-api-contract-pilot.md`, `packages/api-contract/src/*`, `apps/server/src/effect/http-core.ts`, `apps/server/src/pins/api.ts` and `apps/server/src/contract-smoke.test.ts`.

### Allowed files
`packages/api-contract/src/**`, `apps/server/src/effect/http-core.ts`, `apps/server/src/effect/*.test.ts`, `apps/server/src/pins/**`, `apps/server/src/contract-smoke.test.ts`, `apps/server/src/contract-smoke-support.ts`, `docs/API_CONTRACT_RECIPE.md`, `work/T-0891-contract-prep-chains.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/api-contract exec vitest run --reporter=dot
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=120000 --hookTimeout=120000 src/pins src/effect src/auth src/blocks src/roles src/authz-sweep.test.ts src/routes-manifest.test.ts
pnpm --filter @zilar/web exec vitest run --reporter=dot src/lib
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/lib
pnpm --filter @zilar/api-contract typecheck
pnpm --filter @zilar/server typecheck
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/mobile typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```

### Acceptance
- The Checks pass.
- `contractSessionLayer` no longer exists.
- Adding a group touches only its chain's block in `api.ts` and `index.ts`. Show this in the Report with a two-line sample diff.
- Only Allowed files change.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/effect/http-core.ts` now imports and re-exports `CurrentUser`, `Session`, `SessionUser` from `@zilar/api-contract`. `sessionLayer` and its T-0858 cookie-cache logic are unchanged and now provide the contract tag. `contractSessionLayer` is deleted from `apps/server/src/pins/api.ts`, which uses `sessionLayer` directly. The comment in `middleware.ts` says there is no bridge.
- `packages/api-contract/src/api.ts`: `chainAGroups` .. `chainDGroups` (`[] as const`, each with comment lines around it), spread into `HttpApi.make('zilar').add(PinsGroup, ...chainAGroups, ...)`. `HttpApi.add` is variadic (`HttpApi.d.ts:59`), so the type keeps each group; the pins smoke test still compiles `client.pins.*`. `index.ts` has four commented chain blocks.
- `apps/server/src/contract-smoke-support.ts` has `createSmokeHarness()` (`cookieClient`, `bearerClient`, `requestCount`, `context`, `app`). `apps/server/src/pins/contract.smoke.test.ts` holds the 2 pins cases; `contract-smoke.test.ts` is deleted.
- `docs/API_CONTRACT_RECIPE.md` is new: the T-0864 recipe plus the three rules.

### Sample diff: a chain adds a group (chain A)
```diff
 const chainAGroups = [
+  UsersGroup,
 ] as const;
```
```diff
 // Chain A (T-0892): add `export * from './<x>';` lines below.
+export * from './users';
```
(plus one `import { UsersGroup } from './users';` line in the "Chain A (T-0892) imports" area of `api.ts`, which sits apart from the other chains' areas, so no chain edits the top of the file)

### Commands run (wave mode; no `pnpm gate`)
- api-contract vitest: 8 passed (8).
- server vitest (the Checks list): 188 passed, 2 skipped (22 files passed, 1 skipped), pins smoke included.
- web `src/lib`: 358 passed (37 files). mobile `src/lib`: 767 passed (85 files). Counts are lower than the pilot's 413/821 because main changed since then; nothing here touches them.
- typecheck api-contract, server, web, mobile: all exit 0.
- prettier --write, oxlint on the changed .ts files: clean.

### Deviations
- Arrays hold a placeholder comment instead of being empty lines; adding a group is one line plus one import. Round 1: each chain has its own imports area in `api.ts`.

## Review (written by Claude)

**Lead, 2026-10-10: approved after round 1.**
- **One session:** `Session`, `CurrentUser` and `SessionUser` come from `@zilar/api-contract`. `sessionLayer`, with its T-0858 cache logic, provides them, and `contractSessionLayer` is gone.
- **Chain areas:** `api.ts` has four chain areas, each with its own imports and group array spread into `ZilarApi`. `index.ts` has four export blocks.
- **Smoke files:** smoke cases now live per group on `contract-smoke-support.ts`.
- **Recipe:** `docs/API_CONTRACT_RECIPE.md` is the recipe for chains T-0892 to T-0895.
- **Merge:** it goes through the full gate, because every server module uses `Session`.

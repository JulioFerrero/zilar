---
id: T-0891
title: "api-contract prep for parallel group moves: one Session/CurrentUser (no pins bridge), per-chain blocks in the shared lists, per-group smoke test files"
status: todo
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

## Review (written by Claude)

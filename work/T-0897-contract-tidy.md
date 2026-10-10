---
id: T-0897
title: "api-contract tidy: one middleware file and one schema-error layer, the chain lists merged, hand-decoded payloads declared and served with handleRaw, duplicate groups removed"
status: todo
milestone: M5
branch: task/T-0897-contract-tidy
model: auto
effort: default
depends_on: []
estimate: 1 day
---

# T-0897: api-contract tidy

## Spec (written by Claude, do not edit)

### Why
Wave 5 (T-0892 to T-0895) moved 28 groups into `packages/api-contract`. To avoid conflicts between parallel chains, it left these behind:
- **Per-chain middleware files in the contract:** `packages/api-contract/src/chain-a-middleware.ts`, `chain-c-middleware.ts`, `chain-d-middleware.ts` and `middleware-chain-b.ts`, next to `middleware.ts`.
- **Per-module schema-error and rate-limit layers on the server:** `apps/server/src/groups/schema-errors.ts`, `apps/server/src/auth/schema-errors.ts` and `apps/server/src/auth/rate-limit-layer.ts`, plus small layers inside module `api.ts` files. The shared ones are in `apps/server/src/effect/http-core.ts` and `apps/server/src/effect/rate-limit-middleware.ts`.
- **Four `chainXGroups` arrays** in `packages/api-contract/src/api.ts`.
- **Hand-decoded endpoints** that the contract cannot type, so web still calls them with `request()` (19 calls in `apps/web/src/lib/api.ts`):
  - connections `create`;
  - tools `revert` and `run`;
  - push `subscribe`, `updateSettings` and `test`;
  - machines `rename` and `pair`;
  - gifs `search` and `trending`;
  - media `gallery`;
  - stickers `discover`, `removeFavorite` and `importTelegram`.
- **Duplicate groups:** connections and tools each exist twice in the contract, as a client version with the payload and a server version without it.

`apps/server/src/auth/api.ts:121-137` already shows the fix for hand-decoded endpoints: declare the payload in the contract and serve it with `handleRaw`, so the handler keeps its own decode order (for example a 503 or 501 before a 400).

### What to build, one commit per item
1. **Contract middleware:** merge the four chain middleware files into `packages/api-contract/src/middleware.ts` and update the imports. Merge the four `chainXGroups` arrays into one list in `api.ts`, and the chain blocks in `index.ts` into one sorted list.
2. **Server layers:**
   - Fold the per-module schema-error layers and tags into one shared layer in `apps/server/src/effect/http-core.ts`, and the rate-limit layers into `apps/server/src/effect/rate-limit-middleware.ts`.
   - The rate-limit layer should take a `Pick<RateLimiter, 'allow'>`, a wave 4 follow-up; check the `RateLimiter` type first.
   - Delete `groups/schema-errors.ts`, `auth/schema-errors.ts` and `auth/rate-limit-layer.ts` once nothing imports them.
3. **Hand-decoded endpoints:** for each one listed above, declare its payload or query in the contract and serve it with `handleRaw` wherever the handler's own decode order must stay. Delete the duplicate client and server groups for connections and tools. Then move the web and mobile functions for these endpoints onto the derived client, keeping their names and signatures. Mobile stickers, gifs and media keep their lenient row decoding: if the strict contract response would change that, keep their hand-written row decode on top of the client call, and say which endpoints stay hand-written in the Report.
4. **Update `docs/API_CONTRACT_RECIPE.md`:** no more chain blocks, and the `handleRaw` pattern for hand-decoded endpoints.

**The wire must not change:** every server route test passes unchanged, including the status and error-order tests.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; scratch files only in `<scratchpad>/<task id>/`), `docs/API_CONTRACT_RECIPE.md`, and the Reports and Reviews of `work/T-0892-*.md` to `work/T-0895-*.md`.

### Allowed files
`packages/api-contract/src/**`, `apps/server/src/**/api.ts`, `apps/server/src/**/contract.smoke.test.ts`, `apps/server/src/effect/http-core.ts`, `apps/server/src/effect/rate-limit-middleware.ts`, `apps/server/src/effect/*.test.ts`, `apps/server/src/groups/schema-errors.ts`, `apps/server/src/auth/**`, `apps/server/src/connections/**`, `apps/server/src/tools/**`, `apps/server/src/blocks/**`, `apps/server/src/contract-smoke-support.ts`, `apps/web/src/lib/**`, `apps/web/src/components/**/*.test.tsx`, `apps/web/src/routes/**/*.test.tsx`, `apps/mobile/src/lib/**`, `docs/API_CONTRACT_RECIPE.md`, `work/T-0897-contract-tidy.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/api-contract exec vitest run --reporter=dot
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=120000 --hookTimeout=120000
pnpm --filter @zilar/web exec vitest run --reporter=dot
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/lib
pnpm --filter @zilar/api-contract typecheck
pnpm --filter @zilar/server typecheck
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/mobile typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```
Run the full server suite once at the end. Every module's `api.ts` changes, so it is the guard.

### Acceptance
- The Checks pass, and no server route test is edited.
- The contract has one middleware file and no chain arrays, and the server has one schema-error layer.
- The Report lists every endpoint still outside the client, with a reason.
- Report the lines removed.

---

## Report (written by the worker when done)

## Review (written by Claude)

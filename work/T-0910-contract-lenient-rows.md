---
id: T-0910
title: "Lenient row schemas in the api-contract, so the mobile gifs, media and stickers clients derive from it and still drop a bad row instead of failing the page"
status: todo
milestone: M5
branch: task/T-0910-contract-lenient-rows
model: auto
effort: default
depends_on: []
estimate: 0.75 day
---

# T-0910: Lenient row schemas in the contract

## Spec (written by Claude, do not edit)

### Why
These mobile clients are still hand-written: `apps/mobile/src/lib/gifs-api.ts`, `apps/mobile/src/lib/media-api.ts` and `apps/mobile/src/lib/stickers-api.ts`. On purpose, they drop a malformed row and keep the rest of the page. The derived client decodes the whole response strictly, so one bad row would fail the page.

The Reviews of T-0895 and T-0897 left this as a follow-up. `packages/api-contract/src/lenient.ts` already has lenient helpers for enums.

### What to build
1. **A lenient array schema in the contract:** add a `lenientArray(item)` (or similar) in `packages/api-contract/src/lenient.ts`. It decodes each element and drops the ones that fail, and has unit tests. Check `Schema` in `node_modules/effect/dist` (Effect 4.0.2) for the right building block.
2. **Use it** in the response schemas of the gifs, media and stickers list endpoints that the mobile clients decode leniently today. Find each with grep in those three files.
3. **Mobile:** move those three clients onto `createApiClient` and `runApi`, as the other mobile clients do (for example `apps/mobile/src/lib/pins-api.ts`). Keep the port interfaces and the exported names.
4. **Web:** check whether web decodes those lists strictly today. If the lenient schema changes what web shows (a bad row dropped instead of an error), list it as a behaviour difference.
5. **Server:** the server still encodes with the same schema. Its route tests pass unchanged.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; scratch files only in `<scratchpad>/<task id>/`; use the `@/test/wait` helpers, never a raw `setTimeout(resolve, 0)`), `docs/API_CONTRACT_RECIPE.md`, the Reports of `work/T-0895-contract-chain-d-media.md` and `work/T-0897-contract-tidy.md`, `packages/api-contract/src/{lenient,gifs,media,stickers}.ts`, and the three mobile clients with their tests.

### Allowed files
`packages/api-contract/src/**`, `apps/mobile/src/lib/gifs-api.ts`, `apps/mobile/src/lib/media-api.ts`, `apps/mobile/src/lib/stickers-api.ts`, `apps/mobile/src/lib/*.test.ts` (only the tests of those three clients; fake-response shape changes only, listed), `apps/server/src/gifs/**`, `apps/server/src/media/**`, `apps/server/src/stickers/**` (only if the schema import moves), `work/T-0910-contract-lenient-rows.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/api-contract exec vitest run --reporter=dot
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/lib
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=120000 --hookTimeout=120000 src/gifs src/media src/stickers
pnpm --filter @zilar/web exec vitest run --reporter=dot src/lib
pnpm --filter @zilar/api-contract typecheck
pnpm --filter @zilar/mobile typecheck
pnpm --filter @zilar/server typecheck
pnpm --filter @zilar/web typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```

### Acceptance
- The Checks pass.
- The three mobile clients derive from the contract and still drop a bad row, proven by a test each.
- The Report gives the lines removed and any web behaviour difference.

---

## Report (written by the worker when done)

## Review (written by Claude)

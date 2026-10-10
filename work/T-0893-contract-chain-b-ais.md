---
id: T-0893
title: "api-contract chain B: move the ais, agents/memory, connections, approvals, audit, tools, routines groups into packages/api-contract; web and mobile clients derive from it"
status: todo
milestone: M5
branch: task/T-0893-contract-chain-b-ais
model: auto
effort: default
depends_on: [T-0891]
estimate: 1 day
---

# T-0893: api-contract chain B

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of the simplify plan (`docs/audit/simplify-plan.md`, root cause "the client is written twice"). Today web (`apps/web/src/lib/api.ts`, 2,641 lines and 139 functions) and mobile (25 `apps/mobile/src/lib/*-api.ts` files) each hand-write schemas and fetch code for every endpoint.

T-0864 moved the pins group into `packages/api-contract` and derived both clients from it with `HttpApiClient`. T-0891 then:
- unified `Session`/`CurrentUser` with no bridge;
- gave each of the four chains its own import area and block in `packages/api-contract/src/api.ts` and `index.ts`;
- gave each group its own smoke file, `apps/server/src/<x>/contract.smoke.test.ts`, using `apps/server/src/contract-smoke-support.ts`.

**This is chain B.** It works only inside the Chain B blocks.

**Modules:** `apps/server/src/ais/`, `apps/server/src/agents/memory/`, `apps/server/src/connections/`, `apps/server/src/approvals/`, `apps/server/src/audit/`, `apps/server/src/tools/`, `apps/server/src/routines/`. **Mobile clients:** `apps/mobile/src/lib/ais-api.ts`, `apps/mobile/src/lib/ai-memory-api.ts`, `apps/mobile/src/lib/connections-api.ts`, `apps/mobile/src/lib/approvals-api.ts`, `apps/mobile/src/lib/audit-api.ts`, `apps/mobile/src/lib/tools-api.ts` (whichever exist).

### What to build
Follow `docs/API_CONTRACT_RECIPE.md` exactly, one group per commit. For each module:
1. **Server:** move its schemas into `packages/api-contract/src/<x>.ts`, and register the group in the Chain B import area and block of `api.ts` and `index.ts`. Keep the middleware order, the parse options and `.prefix('/api')`. The server module keeps its own `HttpApi` built from the contract group, plus `mountApi` and `routes.expected.ts`. Its existing tests must pass unchanged.
2. **Smoke test:** add `apps/server/src/<x>/contract.smoke.test.ts` covering one create or list and one error, through the derived client.
3. **Web:** in `apps/web/src/lib/api.ts`, move that group's functions onto `callApi((client) => client.<x>.<endpoint>(...))`. Keep the names, signatures and exported types, and delete the hand-written schemas.
4. **Mobile:** in `apps/mobile/src/lib/<x>-api.ts`, use `createApiClient` and `runApi` and keep the port interface. Delete the transport, the tagged errors and the schemas.
5. **What stays outside the client** (recipe step 9):
   - binary uploads and downloads (files, avatars, sticker images, media);
   - SSE streams;
   - better-auth's own endpoints, so in `auth` only the app's `/api/me` style JSON routes move.

   Leave those endpoints exactly as they are and list them in the Report.
6. **Undeclared payloads:** where a payload is still decoded by hand because declaring it would change the error order (the sweeps T-0866 to T-0873 noted these), the contract cannot type it. Leave the hand decode and declare nothing, or declare the payload only on the client side if the recipe allows it. Say which you chose, per endpoint.
7. **Measure:** report the lines removed per group (server, web, mobile, contract), and the web main bundle size (`pnpm --filter @zilar/web build`) at the start and at the end.

The wire must not change: every server route test passes unchanged. Web and mobile tests may change only where the recipe says (fetch-stub shapes, header casing, `new Response(...)` fakes), and each such edit is listed.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), `docs/API_CONTRACT_RECIPE.md`, the Reports of `work/T-0864-api-contract-pilot.md` and `work/T-0891-contract-prep-chains.md`, and `packages/api-contract/src/pins.ts` with `apps/server/src/pins/api.ts` as the worked example.

### Allowed files
`packages/api-contract/src/**` (only your chain's blocks in `api.ts` and `index.ts`), `apps/server/src/ais/**`, `apps/server/src/agents/memory/**`, `apps/server/src/connections/**`, `apps/server/src/approvals/**`, `apps/server/src/audit/**`, `apps/server/src/tools/**`, `apps/server/src/routines/**`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/*.test.ts`, `apps/web/src/lib/**`, `apps/web/src/components/**/*.test.tsx`, `apps/web/src/routes/**/*.test.tsx`, `apps/web/src/store/**/*.test.ts`, `apps/web/src/store/**/*.test.tsx`, `apps/mobile/src/lib/**`, `apps/mobile/src/**/*.test.ts`, `apps/mobile/src/**/*.test.tsx`, `work/T-0893-contract-chain-b-ais.md`.

Three other chains edit `apps/web/src/lib/api.ts` in parallel. Change only your groups' functions there, and never reorder or reformat other parts of the file.

### Checks (wave mode)
```bash
pnpm --filter @zilar/api-contract exec vitest run --reporter=dot
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=120000 --hookTimeout=120000 src/ais src/agents/memory src/connections src/approvals src/audit src/tools src/routines src/authz-sweep.test.ts src/routes-manifest.test.ts
pnpm --filter @zilar/web exec vitest run --reporter=dot src/lib
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/lib
pnpm --filter @zilar/api-contract typecheck
pnpm --filter @zilar/server typecheck
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/mobile typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```
Run the full web and mobile suites once at the end, too (`pnpm --filter @zilar/web test --reporter=dot`, the same for mobile), because components use these clients.

### Acceptance
- The Checks pass.
- Every moved group has a smoke file.
- Only Allowed files change.
- Lines removed and bundle sizes are in the Report, measured.
- Live check for Julio: the screens of these groups work on web and mobile.

---

## Report (written by the worker when done)

## Review (written by Claude)

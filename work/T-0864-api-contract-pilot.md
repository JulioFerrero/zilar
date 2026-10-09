---
id: T-0864
title: "packages/api-contract pilot: the pins group shared by server, web and mobile with derived HttpApiClient clients; Hermes TextDecoder polyfill"
status: todo
milestone: M5
branch: task/T-0864-api-contract-pilot
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0864: packages/api-contract pilot: the pins group shared by server, web and mobile with derived HttpApiClient clients; Hermes TextDecoder polyfill

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Findings B-B3, B-B1 (pins part) and B-B6 in `docs/audit/simplify-2026-10-09/B-api-contract.md` (read sections 3 and 4 fully, and the prototype `/private/tmp/claude-501/-Users-julio-personal-projects-galena/9686fd0a-230a-4af9-9695-0d5ca8d8e063/scratchpad/audit/b-api/proto.mjs`).
- **Three copies of `Pin`:** the contract lives in server files, so the clients copy it: `apps/server/src/pins/api.ts:96-107`, the web `pinKindSchema` (`apps/web/src/lib/api.ts:1017`), and `apps/mobile/src/lib/pins-api.ts:23-32, 59-71, 85-94`.
- **Status:** the create at `pins/api.ts:243` sends 201 through `jsonUnsafe` while it declares a 200 success.
- **`HttpApiClient`** is in effect 4.0.2 core (`effect/http-api`). It decodes every body with `new TextDecoder()` (`HttpApiClient.js:514`), and Hermes has no `TextDecoder`.

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
This is the pattern-setting task for the contract migration; later tasks repeat it per group.
1. **The package:** create `packages/api-contract` (TS source like `@zilar/protocol`, depending on `effect` only). It holds `errors.ts` (the `{ error: { code, message, requestId?, … } }` envelope schema), `middleware.ts` (tags only, if the pins group needs them), `pins.ts` (the schemas and `PinsGroup`) and `api.ts` (`ZilarApi` with pins).
2. **Server:** `apps/server/src/pins/api.ts` implements `PinsGroup` from the contract and keeps only handlers and layers. Make the create declare 201 (`HttpApiSchema.status(201)` or the 4.0.2 equivalent; check the .d.ts) instead of `jsonUnsafe`. Server pins tests unchanged.
3. **Contract smoke test:** one vitest that runs the derived client against `createTestContext()`'s app with an injected fetch, as the prototype does.
4. **Web:** the pins functions in `apps/web/src/lib/api.ts` become thin wrappers over the derived client, keeping their names, signatures and `ApiError`. Provide `FetchHttpClient.Fetch = (u, i) => globalThis.fetch(String(u), i)` so test stubs keep working (see the report's risk list).
5. **Mobile:** add a small UTF-8 `TextDecoder` polyfill in `apps/mobile/src/lib/polyfills.ts`, only when the global is missing. Make `apps/mobile/src/lib/pins-api.ts` use the derived client, with the bearer token in `transformClient`, keeping the `PinsApi` interface and the error class name as an alias so `instanceof` sites work.
6. **Bundle:** measure the web build size before and after (gzip).
7. **Report:** write a precise "how to move a group" recipe, including the test-adapter details.

Existing web and mobile pins tests may need edits only where they assert fetch-argument shapes (URL object or header casing). Keep those edits minimal and list them; this is the lead's exception for this task.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`packages/api-contract/**`, `apps/server/src/pins/**`, `apps/server/package.json`, `apps/server/src/contract-smoke.test.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/api*.test.ts`, `apps/web/src/lib/effect/**`, `apps/web/package.json`, `apps/mobile/src/lib/pins-api.ts`, `apps/mobile/src/lib/pins-api.test.ts`, `apps/mobile/src/lib/polyfills.ts`, `apps/mobile/src/lib/polyfills.test.ts`, `apps/mobile/src/lib/effect/**`, `apps/mobile/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `work/T-0864-api-contract-pilot.md`.

### Checks (wave mode)
```bash
pnpm install
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=30000 --hookTimeout=30000 src/pins src/contract-smoke.test.ts
pnpm --filter @zilar/web exec vitest run --reporter=dot src/lib
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/lib
pnpm --filter @zilar/server typecheck
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/mobile typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Every number the spec asks for (sizes, timings, counts) is in the Report, measured.
- Live check for Julio's single test: Julio pins and unpins a message on web and on the phone.

---

## Report (written by the worker when done)

## Review (written by Claude)

---
id: T-0878
title: "packages/client-core: the shared React + Effect glue (useAction, useQuery, atomStore, api-effect) used by web and mobile"
status: todo
milestone: M5
branch: task/T-0878-client-core-react-glue
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0878: packages/client-core: the shared React + Effect glue (useAction, useQuery, atomStore, api-effect) used by web and mobile

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Finding A-F4 in `docs/audit/simplify-2026-10-09/A-web-mobile.md`.
- **Two copies:** `use-action.ts` and `use-query.ts` are identical except for the runtime name (`webAtomRuntime`/`mobileAtomRuntime`). The mobile files say "It mirrors apps/web/src/lib/effect/use-action.ts and has the same API" (`apps/mobile/src/lib/effect/use-action.ts:2`).
- **Identical:** `api-effect.ts` and `atomStore.ts` are the same in both apps; mobile adds `createBoundStore` (`apps/mobile/src/store/atomStore.ts:82-101`).
- **Runtime:** both runtimes are `FetchHttpClient.layer`.
- **Versions:** both apps use the same `@effect/atom-react` 4.0.2 and `effect`.

Line numbers come from the audit and may have moved since: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Create `packages/client-core` (TS source like `@zilar/protocol`, with peer dependencies `effect`, `@effect/atom-react` and `react` at the apps' versions). Add `createAtomStore`, `useStoreSelector(store, selector)`, `makeUseAction(runtime)` / `makeUseQuery(runtime)` (or hooks taking the runtime), and `api-effect`.
2. Each app keeps its `lib/effect/use-action.ts` etc. as a 2-line binding to its own runtime, so no import elsewhere changes. Delete the duplicated bodies.
3. Wire the package into both apps' package.json, the Dockerfiles (`apps/web/Dockerfile`, `apps/server/Dockerfile` only if the server needs it, which it should not) and `pnpm install`. See how T-0864 added `packages/api-contract`.
4. Move the duplicated tests into the package and keep one copy.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), the audit section and task Reports cited above, and the files listed.

### Allowed files
`packages/client-core/**`, `apps/web/src/lib/effect/**`, `apps/mobile/src/lib/effect/**`, `apps/web/src/store/atomStore.ts`, `apps/mobile/src/store/atomStore.ts`, `apps/web/package.json`, `apps/mobile/package.json`, `apps/web/Dockerfile`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `apps/mobile/metro.config.js`, `work/T-0878-client-core-react-glue.md`.

### Checks (wave mode)
```bash
pnpm install
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm --filter @zilar/web test --reporter=dot
pnpm --filter @zilar/mobile test --reporter=dot
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/mobile typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit. The machine is shared, so note `uptime` next to any timing.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Lines removed (and every other number the spec asks for) are in the Report, measured.
- Live check for Julio's single test: The phone smoke (lead) must pass, because Metro must resolve the new package.

---

## Report (written by the worker when done)

## Review (written by Claude)

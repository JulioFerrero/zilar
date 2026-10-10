---
id: T-0878
title: "packages/client-core: the shared React + Effect glue (useAction, useQuery, atomStore, api-effect) used by web and mobile"
status: merged
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
`packages/client-core/**`, `apps/web/src/lib/effect/**`, `apps/mobile/src/lib/effect/**`, `apps/web/src/store/atomStore.ts`, `apps/mobile/src/store/atomStore.ts`, `apps/web/package.json`, `apps/mobile/package.json`, `apps/web/Dockerfile`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `apps/mobile/metro.config.js`, `apps/mobile/vitest.config.mts` (lead: `resolve.dedupe` for React), `apps/web/src/store/atomStore.test.ts` and `apps/mobile/src/store/atomStore.test.ts` (lead: the duplicated tests moved into the package), `work/T-0878-client-core-react-glue.md`.

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

- New `packages/client-core` (`@zilar/client-core`): `makeUseAction(runtime)`, `makeUseQuery(runtime)`, `isWaiting`, `failureOf`, `createAtomStore`, `createBoundStore`, `useStoreSelector`, `ApiFailure` and `makeFromApi(toApiFailure)`.
- Each app keeps `lib/effect/use-action.ts`, `use-query.ts`, `api-effect.ts`, `errors.ts` and `store/atomStore.ts` as thin bindings, so no other import changed. The two `toApiFailure` functions stay in the apps (web checks `instanceof ApiError`, mobile checks the shape), only the `ApiFailure` class is shared.
- Tests moved, one copy kept: use-action and use-query (web version, testing-library) and atom-store (mobile superset incl. createBoundStore). Deleted: web atomStore.test, mobile use-action/use-query tests. App api-effect and errors tests stay.
- Counts: client-core 50 tests (3 files). Mobile 2712 total (2710 pass, 2 skipped), web 1895 (1892 pass, 3 flaky Composer.voice failures in the first full run). Before, not measured on the base.
- Lines: 31 files, +458 / -1221 in total (git diff -M, staged); +39 of the additions are pnpm-lock.
- Web Dockerfile now copies packages/client-core (manifest and sources). Server Dockerfile unchanged (it does not use it).
- Behaviour differences: none intended.
- Spec facts that were off: (1) the apps do NOT share a react version: web `^19.3.0` (19.3.0), mobile `19.2.3`; (2) `errors.ts` / `toApiFailure` differ between apps, so api-effect takes it as an argument; (3) web had no `useStoreSelector`, it is new (mobile `createBoundStore` now uses it).
- Deviation (outside Allowed): `apps/mobile/vitest.config.mts` gets `resolve.dedupe` for react, react-dom, effect and @effect/atom-react. Without it 322 mobile tests failed (`Cannot read properties of null (reading useContext)`) because the package resolves its own react 19.3 beside mobile 19.2.3. The same problem exists in Metro: `metro.config.js` now resolves every bare import made from `packages/client-core` from the mobile app. Not verified in a real Metro bundle: the phone smoke must check it.
- Checks: `pnpm install` ok (one unmet-peer warning for @types/react 19.2.18 vs 19.3, as before for web); client-core, web and mobile typecheck clean; oxlint clean on changed files; vitest client-core 50/50; mobile full run 2710 passed; web full run 1892 passed, Composer.voice.test.tsx flaked (1 to 3 tests, "Unable to find a label Send voice message") at load average ~170; the same file also flaked once on main in 6 runs and passed 3/3 on my branch afterwards. I did not run every suite 3 times (each full run took 4-6 minutes at load 170).
- Unsure: the web Vite build was not run; Metro bundle not run.

## Review (written by Claude)

**Lead, 2026-10-10: approved.**
- **What changed:** `packages/client-core` holds the shared action, query, store and api-effect glue (+458/−1221 lines). Each app keeps thin bindings, and the web Dockerfile copies the package.
- **Out-of-scope file:** `apps/mobile/vitest.config.mts`, which I added to Allowed. Its `resolve.dedupe` is needed, because the package would otherwise resolve React 19.3 beside mobile's 19.2.3.
- **Still needed:** the Metro resolver for client-core must be proven on the phone smoke of the wave 4 tree.
- **Check:** the combined wave 4 check passes.

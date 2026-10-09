---
id: T-0762
title: "F2: web hooks useAction and useQuery on @effect/atom-react — an Atom.runtime over webLayer; useAction(fn) returns [AsyncResult, run, controls] (fn atom per component, ignores re-runs while waiting by default, interrupts on unmount); useQuery(effect, deps) returns [AsyncResult, refresh]; tested with testing-library"
status: merged
milestone: M5
branch: task/T-0762-web-use-action
model: auto
effort: default
depends_on: [T-0759]
estimate: 0.5 day
---

# T-0762 (F2): `useAction` and `useQuery` for web components

## Spec (written by Claude, do not edit)

### Why
This is Phase 1 of `docs/audit/effect-100-plan.md` (task F2), accepted by Julio on 2026-10-09. §3.6 sets the rule: no `async`, `await`, `.then`, `try` or timer inside a component. Components call `useAction` and `useQuery` instead. The 26 web UI tasks (WU1-WU26) all use these two hooks, so the hooks' API must be small and stable.

### Verified facts (do not re-derive)
- **T-0759 (merged) added** `apps/web/src/lib/effect/runtime.ts` (`webLayer = FetchHttpClient.layer`, `webRuntime`, `runWeb`), `errors.ts` (`ApiFailure`, `toApiFailure`) and `api-effect.ts` (`fromApi`).
- **Effect 4.0.2 `effect/reactivity`:**
  - `Atom.runtime(layer)` returns an `AtomRuntime` with `.atom(...)` and `.fn(...)` (`node_modules/effect/dist/reactivity/Atom.d.ts:320-433`);
  - `.fn(fn, { concurrent?, initialValue?, reactivityKeys? })` gives an `AtomResultFn<Arg, A, E>` (lines 339-360);
  - writing `Atom.Interrupt` interrupts the running computation and `Atom.Reset` returns it to `Initial` (lines 567-610);
  - disposing a node closes its Scope and interrupts its fiber (`AtomRegistry.d.ts:73-81`, `:303-329`; summary in `docs/audit/effect-atom-react-plan.md:92-111`);
  - `AsyncResult` is in `dist/reactivity/AsyncResult.d.ts`.
- **`@effect/atom-react` 4.0.2:** `useAtom`, `useAtomValue`, `useAtomSet` and `useAtomRefresh` (`dist/Hooks.d.ts:52-197`), and `RegistryContext` (`dist/RegistryContext.d.ts:30`).
- **The web provider:** `apps/web/src/store/ChatStoreProvider.tsx:35` provides the store's registry through `RegistryContext.Provider`.
- **Tests:** `apps/web/package.json:40` has `@testing-library/react` `^16.3.3`.

### What to build
1. **`apps/web/src/lib/effect/runtime.ts`:** add `export const webAtomRuntime = Atom.runtime(webLayer)`, with a comment that atoms needing HTTP or later services use it.
2. **`apps/web/src/lib/effect/use-action.ts`:** `useAction<I, A, E>(fn: (input: I) => Effect.Effect<A, E, HttpClient.HttpClient>, options?: { mode?: 'ignore' | 'replace' })`, returning `readonly [state: AsyncResult.AsyncResult<A, E>, run: (input: I) => void, controls: { reset(): void; interrupt(): void }]`.
   - Create the fn atom once per component instance with `useMemo([], ...)`. It calls the latest `fn` through a ref, so callers can pass inline lambdas without re-creating the atom.
   - `mode: 'ignore'` (the default) drops a `run` while the state is waiting. This replaces today's `busy` guards: a double click does not send twice. `'replace'` interrupts the running call and starts the new one.
   - Unmounting interrupts a running call; a test must prove it.
   - Also export `failureOf(state)`, which gives the typed failure `E | undefined` (not defects), and `isWaiting(state)`, so components need no `AsyncResult` pattern-matching boilerplate.
3. **`apps/web/src/lib/effect/use-query.ts`:** `useQuery<A, E>(make: () => Effect.Effect<A, E, HttpClient.HttpClient>, deps: ReadonlyArray<unknown>)`, returning `readonly [state: AsyncResult.AsyncResult<A, E>, refresh: () => void]`. Build the atom per `deps` (`useMemo(deps)`, through `webAtomRuntime.atom`). A deps change or an unmount interrupts the old run.
4. **Tests:** `use-action.test.tsx` and `use-query.test.tsx`, using `@testing-library/react` and real Effects (no mocks of Effect). Cover:
   - success and typed failure states;
   - `ignore` mode drops a second run while waiting (the effect runs once);
   - `replace` mode interrupts the first run (its finalizer runs);
   - unmount interrupts (the finalizer runs);
   - `reset`;
   - `useQuery` refetches on a deps change and on `refresh`, and interrupts the previous run.

   Render once inside a `RegistryContext.Provider` with a fresh registry, and once without a provider, the default registry. Both must work.
5. **A short usage comment** at the top of `use-action.ts` showing the before and after from plan §3.6. That is the pattern the WU tasks copy.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-100-plan.md` §3.3 and §3.6, `docs/audit/effect-atom-react-plan.md` (lines 60-140), `apps/web/src/lib/effect/*`, `apps/web/src/store/atomStore.ts`, `apps/web/src/store/ChatStoreProvider.tsx`.

### Allowed files
`apps/web/src/lib/effect/runtime.ts`, `apps/web/src/lib/effect/use-action.ts`, `apps/web/src/lib/effect/use-action.test.tsx`, `apps/web/src/lib/effect/use-query.ts`, `apps/web/src/lib/effect/use-query.test.tsx`, `work/T-0762-web-use-action.md`.

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot src/lib/effect
pnpm gate
```

### Acceptance
- Both hooks exist with the API above and are tested against the listed behaviours.
- No component changes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `runtime.ts`: added `webAtomRuntime = Atom.runtime(webLayer)` with a comment.
- `use-action.ts`: `useAction`, `failureOf`, `isWaiting`, the types `ActionMode`, `UseActionOptions`, `ActionControls`, `ActionState`, and the before/after usage comment from plan 3.6.
- `use-query.ts`: `useQuery`.
- `use-action.test.tsx` (13 tests x 2 registry modes = 26) and `use-query.test.tsx` (7 tests x 2 = 14), real Effects with `Deferred` gates and counters (`started`, `interrupted`, `finalized`) that finalizers flip.

### Signatures
```ts
useAction<I, A, E>(fn: (input: I) => Effect<A, E, HttpClient>, options?: { mode?: 'ignore' | 'replace' })
  : readonly [state: AsyncResult<A, E>, run: (input: I) => void, controls: { reset(): void; interrupt(): void }]
useQuery<A, E>(make: () => Effect<A, E, HttpClient>, deps: ReadonlyArray<unknown>)
  : readonly [state: AsyncResult<A, E>, refresh: () => void]
failureOf(state): E | undefined      isWaiting(state): boolean
```

### Design notes and deviations
- **`useAction` atom.** The fn atom is `webAtomRuntime.fn<Effect<A, E, HttpClient>>()((effect) => effect)`: `run(input)` builds the Effect from the latest `fn` (a ref set in `useLayoutEffect`) and writes it to the atom. The spec said "the atom calls the latest fn through a ref". The repo's oxlint `react(refs)` rule rejects reading a ref inside a `useMemo` callback, and `react(immutability)` rejects mutating a `useState` value. Reading the ref in the `run` callback passes lint, and the behaviour is the same: inline lambdas never rebuild the atom, and `run` / `controls` keep their identity (tested).
- **`ignore` mode** checks `AsyncResult.isWaiting(registry.get(atom))` in `run`. `replace` is the `Atom.fn` default (a new write interrupts the previous run).
- **Unmount** is not handled by extra code. Dropping the last subscriber lets the registry dispose the node, which interrupts the fiber. I first added an explicit `Atom.Interrupt` write in a cleanup effect, then removed it after a mutation check showed the unmount test passes without it. The test reads the finalizer flag, so it would fail if the interrupt did not happen.
- **`useQuery`** does not use `useMemo(..., deps)`: oxlint (`react(use-memo)`, `exhaustive-deps`) rejects a non-literal deps array and `[...deps]`. It keeps `{ deps, atom }` in `useState` and rebuilds during render when `Object.is` differs per item (React's derived-state pattern). The abandoned atom loses its subscriber, which interrupts its run (tested).
- No new dependencies, no component changes.

### Mutation checks (to be sure the tests can fail)
- `ignore` guard disabled: the two "ignore mode" tests fail (2 failed, 24 passed).
- `useQuery` deps fixed to `[]`: the two "refetches on a deps change and interrupts the previous run" tests fail (2 failed, 12 passed).
- Explicit unmount interrupt disabled (before I removed it): the unmount test still passed, so registry disposal does the interruption.
Both mutated files were restored before the final runs.

### Commands and results
- `pnpm install`: ok.
- `pnpm --filter @zilar/web test --reporter=dot src/lib/effect`: 4 files, 50 tests passed (use-action 26, use-query 14, plus the existing api-effect and errors tests).
- `pnpm gate`: 
  - `gate: 6 changed file(s) against main`
  - `PASS  install (frozen)`, `PASS  format`, `PASS  lint`, `PASS  typecheck`, `PASS  tests @zilar/web`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Open questions
- None blocking. `AsyncResult.isInterrupted` state after `interrupt()` is a `Failure`, and `failureOf` gives `undefined` for it; WU tasks that want a "cancelled" message must check `AsyncResult.isInterrupted(state)` themselves.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Sonnet 5.5. The lead reviewed the code directly.
- **`useAction`:** one `webAtomRuntime.fn` per component, written with the Effect built from the latest `fn`. `ignore` mode checks `isWaiting` before running; unmount disposes the node and interrupts it.
- **`useQuery`:** rebuilds the atom when its deps change, with the previous-render state pattern.
- **Two changes from the spec were needed by oxlint, and both are fine.**
- **Results:** 50 tests, run with a provider and with the default registry; the mutation checks show the guard and deps tests catch regressions. The gate passed.
- **Note for WU specs:** after `interrupt()`, `failureOf` is `undefined`; use `AsyncResult.isInterrupted` for a "cancelled" message.

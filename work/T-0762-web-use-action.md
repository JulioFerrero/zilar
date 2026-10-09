---
id: T-0762
title: "F2: web hooks useAction and useQuery on @effect/atom-react — an Atom.runtime over webLayer; useAction(fn) returns [AsyncResult, run, controls] (fn atom per component, ignores re-runs while waiting by default, interrupts on unmount); useQuery(effect, deps) returns [AsyncResult, refresh]; tested with testing-library"
status: todo
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

## Review (written by Claude)

---
id: T-0526
title: "atom-react W1 (web): add @effect/atom-react, a zustand-compatible createAtomStore over one registry atom, and swap both web stores and ChatStoreProvider onto it; every web test unchanged; bundle measured"
status: merged
milestone: M5
branch: task/T-0526-atom-react-web-w1
model: auto
effort: low
depends_on: [T-0521]
estimate: 1 day
---

# T-0526: atom-react W1 on web

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `@effect/atom-react` replaces zustand. The plan is `docs/audit/effect-atom-react-plan.md` (T-0521): read §1 (API facts) and §4 (the compatibility object) first.

**Lead decision for W1:** it is smaller and safer than the plan's W1. Instead of moving a pilot slice, W1 replaces zustand's **container** with a registry atom that holds the whole state, behind the same `StoreApi` surface. Then W2 and later split the one atom into slice atoms (plan §5). After this task, zustand is no longer used at runtime on web.

### Verified facts (do not re-derive)
- **`apps/web/src/store/realStore.ts`:**
  - imports `createStore` from `zustand/vanilla` (line 52) and the `StoreApi` type (line 51);
  - `createRealChatStore` returns `createStore<ChatStoreState>((set, get) => { … })` (line 787);
  - its actions use `set(partial)`, `set((state) => partial)` and `get()`. For example, `setSearch: (value) => set({ search: value })` at line 4693.
- **`apps/web/src/store/store.ts`:** the mock `createChatStore` has the same shape, `createStore<ChatStoreState>((set, get) => …)` (line 835), with imports at lines 70-71. `ChatStoreState` is at lines 132-452.
- **`apps/web/src/store/ChatStoreProvider.tsx`** (47 lines):
  - holds a `StoreApi<ChatStoreState>` in React context;
  - `useChatStore()` is `useStore(useChatStoreApi(), (state) => state)` (line 46), the whole state;
  - `useChatStoreApi()` returns the api;
  - `start()` and `stop()` run in an effect on auth.
- **Tests use the `StoreApi` surface:**
  - `getState`;
  - `setState` with a partial **and** with an updater (`apps/web/src/store/realStore.topics.test.tsx:299`, `apps/web/src/routes/ChatView.test.tsx:128`, `apps/web/src/routes/NotificationsPage.test.tsx:169`);
  - `subscribe` (`apps/web/src/store/realStore.test.tsx:2696`).
  
  The "in one update" draft test (`realStore.test.tsx:2690-2724`) pins **one notification per `set`**.
- **zustand semantics to keep:**
  - `set(partial | updater, replace?)` shallow-merges, unless `replace`;
  - **it notifies listeners only when `Object.is(next, prev)` is false**;
  - `subscribe(listener)` calls `listener(state, prevState)` and returns an unsubscribe;
  - `getInitialState()` is part of the surface;
  - `get()` inside an action is synchronous and sees the last `set`.
- **The package:** `@effect/atom-react` 4.0.2 is not installed. Its peers are `react >=19 <20`, `effect ^4.0.2` and `scheduler >=0.25 <0.28` (plan §0). Web has `effect` ^4.0.2 and React 19.3. Registry API: `AtomRegistry.make`, with `get`, `set`, `subscribe` and `dispose` (plan §1). The hooks are `RegistryProvider` and `useAtomValue`.
- **Bundle baseline:** `docs/audit/effect-everywhere-plan.md` §3.1.

### What to build
1. **Add `@effect/atom-react` at `4.0.2` to `apps/web/package.json`.** Add `scheduler` only if pnpm reports the peer as missing. Run `pnpm install` and commit the lockfile.
2. **Create `apps/web/src/store/atomStore.ts`** exporting `createAtomStore<T>(initializer, registry?)`:
   - `initializer` is the same `(set, get, api) => T` callback zustand takes;
   - the state lives in **one** `Atom.make` held in an `AtomRegistry`;
   - it returns an object with exactly the zustand `StoreApi<T>` surface (`getState`, `getInitialState`, `setState`, `subscribe`), plus `atom` and `registry` for the provider;
   - **keep every zustand semantic listed above,** including skipping notification when the state is unchanged and `listener(state, prev)`.
   
   Export a local `StoreApi<T>` type. **No zustand import in this file.**
3. **Swap `createStore` for `createAtomStore`** in `realStore.ts` and `store.ts`, and the `StoreApi` imports for the local type. **No other line in those two files changes.**
4. **`ChatStoreProvider.tsx`:** keep `useChatStoreApi()` and the `start()`/`stop()` effect. `useChatStore()` reads the state with `useAtomValue(store.atom)`, wrapped in a `RegistryProvider` (or a `RegistryContext` provider) for that store's registry, so behaviour stays whole-state as today. **No zustand import left in `apps/web/src`;** remove `zustand` from `apps/web/package.json` if nothing else imports it (check with grep, tests included).
5. **Tests:**
   - add `apps/web/src/store/atomStore.test.ts`, covering partial and updater sets, `replace`, no notification on an unchanged state, `listener(state, prev)`, unsubscribe, and `get()` seeing the last `set`;
   - every other web test passes **unchanged**.
   
   If one cannot, stop and report BLOCKED with the line.
6. **Measure:** run `pnpm --filter @zilar/web build` before and after, and report the main JS chunk sizes (raw and gzip) next to the §3.1 baseline.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-atom-react-plan.md` §0, §1, §4 and §6, `apps/web/src/store/ChatStoreProvider.tsx`, and the `createStore` call sites in `realStore.ts` and `store.ts`. After the install, also read the published type declarations of the atom-react package and of effect's reactivity module (Atom, AtomRegistry) in node_modules.

### Allowed files
`apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/src/store/atomStore.ts`, `apps/web/src/store/atomStore.test.ts`, `apps/web/src/store/realStore.ts`, `apps/web/src/store/store.ts`, `apps/web/src/store/ChatStoreProvider.tsx`, `work/T-0526-atom-react-web-w1.md`.

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot atomStore realStore reload ChatView NotificationsPage
pnpm gate
```

### Acceptance
- Both web stores run on `createAtomStore` over an atom registry, with the same `StoreApi` behaviour, and zustand is gone from web.
- `atomStore.test.ts` covers the semantics.
- Every other web test is unchanged and green.
- The bundle sizes are reported.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Status: review. Branch `task/T-0526-atom-react-web-w1`.

### What I did

- **`apps/web/package.json`:** added `@effect/atom-react` `4.0.2`; added
  `scheduler` `^0.27.0` because pnpm reported the atom-react peer as unmet
  (`found 0.28.0`, needs `>=0.25.0 <0.28.0`). Removed `zustand`.
- **`apps/web/src/store/atomStore.ts` (new):** `createAtomStore<T>(initializer, registry?)`.
  The whole state lives in one `Atom.writable` held in an `AtomRegistry` (one is
  created when none is passed). It returns the `StoreApi<T>` surface plus `atom`
  and `registry`, and keeps the semantics: partial **and** updater `set`,
  `replace`, `Object.is` skip when the state is unchanged, `subscribe(listener)`
  called with `(state, prevState)` and returning an unsubscribe,
  `getInitialState`, and a synchronous `get()` that sees the last `set`.
- **`apps/web/src/store/realStore.ts`, `store.ts`:** swapped
  `createStore<ChatStoreState>(…)` for `createAtomStore<ChatStoreState>(…)` and
  the `zustand/vanilla` `StoreApi` import for `./atomStore`. No other line in
  those two files changed.
- **`apps/web/src/store/ChatStoreProvider.tsx`:** `useChatStoreApi()` and the
  auth `start()`/`stop()` effect are unchanged; children are wrapped in
  `<RegistryContext.Provider value={value.registry}>` and `useChatStore()` now
  returns `useAtomValue(useChatStoreApi().atom)`.
- **`apps/web/src/store/atomStore.test.ts` (new):** 8 tests for the semantics
  above, plus that `registry.get(atom)` mirrors `getState()`.
- No `zustand` import remains under `apps/web/src`; the only hits are two
  explanatory comment lines in `atomStore.ts`.

### Files changed

`apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/src/store/atomStore.ts`,
`apps/web/src/store/atomStore.test.ts`, `apps/web/src/store/realStore.ts`,
`apps/web/src/store/store.ts`, `apps/web/src/store/ChatStoreProvider.tsx`,
`work/T-0526-atom-react-web-w1.md`.

### Commands and real results

- `pnpm install`: ok; after adding `scheduler` the atom-react peer warning is
  gone (only the pre-existing mobile `@types/react` warning remains).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store/atomStore.test.ts`: 8 passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store/reload.test.tsx`: 3 passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store/realStore.test.tsx`: 134 passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/routes/ChatView.test.tsx src/routes/NotificationsPage.test.tsx`: 17 passed.
- `pnpm gate` (repo root): EXIT 0 —
  `gate: 8 changed file(s) against main`, `PASS install (frozen)`, `PASS format`,
  `PASS lint`, `PASS typecheck`, `PASS tests @zilar/web (78.4s)`,
  `scope: every changed file is inside the Allowed files`, `GATE PASS`.

### Bundle (main JS chunk, `pnpm --filter @zilar/web build`)

- §3.1 documented baseline: `index-wv0dHVba.js` 1,339.44 kB raw / 374.56 kB gzip.
- Measured before the source change (same tree, deps added but not yet imported):
  `index-Bo7m48NY.js` 1,415.32 kB raw / 399.31 kB gzip. (The repo has grown since
  §3.1, so this is the meaningful before.)
- After (this task): `index-1qlpBPii.js` 1,465.29 kB raw / 416.05 kB gzip.
- Delta of this task: **+49.97 kB raw / +16.74 kB gzip** (CSS unchanged at
  57.14 kB / 11.55 kB gzip).

### Deviations and notes

- The local `StoreApi<T>` type carries the four store members **plus** `atom`
  and `registry`. That is deliberate: item 3 says the two store files keep their
  `: StoreApi<ChatStoreState>` return annotations with no other line changed, and
  the provider needs `.registry` / `.atom` from that same type. If the lead wants
  the local type to be exactly the four zustand members, both return annotations
  must widen instead.
- `atomStore.ts` has one cast, `partial as (state: T) => T | Partial<T>`, because
  the generic union `T | Partial<T> | fn` makes `typeof partial === 'function'`
  narrow to `T & Function`. No `any`, no `@ts-ignore`.
- `zustand` stays in the workspace only for `apps/mobile`; web no longer declares
  it.

## Review (written by Claude)

Approved (lead, 2026-10-08). Both web stores run on createAtomStore, a zustand-compatible StoreApi over one atom in an AtomRegistry. The provider reads it with useAtomValue under RegistryContext, and zustand is gone from web. atomStore.test.ts pins the semantics; every other web test is unchanged. Bundle +50 kB raw / +16.7 kB gzip. Lead browser check, mock mode, side by side with main on ports 5199 and 5198: chat list, opening a chat and a send updating the list all behave the same as main. Pre-review clean; the nit (a stale Report sentence) is accepted. Next: W2 (slice atoms).

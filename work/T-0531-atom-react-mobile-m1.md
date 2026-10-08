---
id: T-0531
title: "atom-react M1 (mobile): add @effect/atom-react, a zustand-compatible createAtomStore + bound-hook helper over an atom registry, swap real-store, chat-store (mock), session-store and the provider onto it, remove zustand from mobile; tests unchanged except dropping dead zustand mocks; Hermes export + phone smoke"
status: merged
milestone: M5
branch: task/T-0531-atom-react-mobile-m1
model: auto
effort: low
depends_on: [T-0526]
estimate: 1 day
---

# T-0531: atom-react M1 on mobile

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `@effect/atom-react` replaces zustand. The plan is `docs/audit/effect-atom-react-plan.md`. **Web did this first in T-0526** (merged): `apps/web/src/store/atomStore.ts`, its test, and `apps/web/src/store/ChatStoreProvider.tsx`. Read them and the Review in `work/T-0526-atom-react-web-w1.md`. This task does the same container swap on mobile. The state stays one atom per store; slice atoms come later.

### Verified facts (do not re-derive)
- **`apps/mobile/src/store/real-store.ts`:** `import { createStore, type StoreApi } from 'zustand/vanilla'` (line 50); `createStore<ChatStoreState>((set, get) => …)` (line 446).
- **`apps/mobile/src/store/chat-store.ts`** (the mock store): `import { create, type StoreApi, type UseBoundStore } from 'zustand'` (line 4); `create<ChatStoreState>()((set, get) => …)` (line 362) returns a `UseBoundStore<StoreApi<ChatStoreState>>` (line 361). That is a callable hook `useX(selector)` **plus** the four api methods.
- **`apps/mobile/src/auth/session-store.ts`:** `create<AuthStore>()((set) => …)` (line 75), returning a `UseBoundStore<StoreApi<AuthStore>>` (line 72). Eight files read it as `useAuthStore(selector)`.
- **`apps/mobile/src/store/chat-store-provider.tsx`:** `useChatStore(selector)` is `useStore(store, selector)` from zustand (line 74). `start()` and `stop()` run in an effect (around lines 61-62).
- **Selector stability is pinned** by `apps/mobile/src/store/selector-stability.test.ts`. zustand v5's `useStore` is `useSyncExternalStore(api.subscribe, () => selector(api.getState()))`, which re-renders only when `Object.is` on the selected value changes. **Do not use `useAtomValue(atom, selector)` with an inline selector:** it may build a new derived atom on every render. Read `Hooks.d.ts` and decide; if unsure, use `useSyncExternalStore` over the compat store's `subscribe` and `getState`.
- **Six tests mock zustand** with `vi.mock('zustand', () => ({ useStore: … }))`, and they also mock `@/store/chat-store-provider`:
  - `apps/mobile/src/components/chat/message-bubble-layout.test.tsx` (line 102);
  - `apps/mobile/src/components/chat/message-list.test.tsx` (line 133);
  - `apps/mobile/src/components/chat/message-bubble-stickers.test.tsx` (line 84);
  - `apps/mobile/src/components/chat/message-bubble-ticks.test.tsx` (line 84);
  - `apps/mobile/src/components/chat/attachment-body.test.tsx` (line 82);
  - `apps/mobile/src/components/chat/composer-gifs.test.tsx`.
  
  **No mobile component imports zustand** (only the four files above do).
- **The Hermes check:** `pnpm --filter @zilar/mobile exec expo export --platform ios --output-dir tmp-export`. T-0506 measured a 12.2 MB `.hbc`. Plan §6 flags that atom-react uses `WeakRef` and `FinalizationRegistry`, which must be checked on a device.

### What to build
1. **Add `@effect/atom-react` at `4.0.2` to `apps/mobile/package.json`.** Add `scheduler` only if pnpm reports the peer as missing. Run `pnpm install` and commit the lockfile.
2. **Create `apps/mobile/src/store/atomStore.ts`.** Port the web `createAtomStore` with the same zustand semantics and tests, plus `createBoundStore<T>(initializer)`, which returns a callable hook `(selector) => selected` with the same `getState`, `setState`, `subscribe` and `getInitialState` attached: the `create()()` replacement. Add `apps/mobile/src/store/atomStore.test.ts`, covering the store semantics and that the bound hook re-renders only when the selected value changes.
3. **Swap the four files:**
   - `real-store.ts`: `createStore` becomes `createAtomStore`;
   - `chat-store.ts` and `session-store.ts`: `create<T>()(…)` becomes `createBoundStore<T>(…)`;
   - the provider: `useStore` becomes the stable selector hook;
   - the `StoreApi` and `UseBoundStore` types become local equivalents.
   
   **No other line in those files changes.**
4. **In the six tests,** delete **only** the `vi.mock('zustand', …)` block (it is dead once no source imports zustand). Remove `zustand` from `apps/mobile/package.json` when grep finds no import left.
5. **Tests:** every other mobile test passes **unchanged**, `selector-stability.test.ts` included.
6. **The Hermes check:** run the Expo export into `tmp-export/` inside your worktree (delete it afterwards and never commit it). Report the bundle name and its size from `ls -l` next to 12.2 MB.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-atom-react-plan.md` §1, §3, §4 and §6, `apps/web/src/store/atomStore.ts`, `apps/web/src/store/atomStore.test.ts`, `apps/web/src/store/ChatStoreProvider.tsx`, `apps/mobile/src/store/chat-store-provider.tsx`, `apps/mobile/src/store/selector-stability.test.ts`, and the four zustand call sites.

### Allowed files
- `apps/mobile/package.json`, `pnpm-lock.yaml`;
- `apps/mobile/src/store/atomStore.ts`, `apps/mobile/src/store/atomStore.test.ts`;
- `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/chat-store.ts`, `apps/mobile/src/auth/session-store.ts`, `apps/mobile/src/store/chat-store-provider.tsx`;
- the six tests: `apps/mobile/src/components/chat/message-bubble-layout.test.tsx`, `apps/mobile/src/components/chat/message-list.test.tsx`, `apps/mobile/src/components/chat/message-bubble-stickers.test.tsx`, `apps/mobile/src/components/chat/message-bubble-ticks.test.tsx`, `apps/mobile/src/components/chat/attachment-body.test.tsx` and `apps/mobile/src/components/chat/composer-gifs.test.tsx`;
- `work/T-0531-atom-react-mobile-m1.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --reporter=dot atomStore selector-stability chat-store real-store session
pnpm gate
```

### Acceptance
- The mobile stores run on an atom registry, with zustand semantics and selector stability.
- zustand is gone from mobile.
- The Expo export succeeds, with its size reported.
- The tests are unchanged except for the six dead mock blocks.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Status: review. Branch `task/T-0531-atom-react-mobile-m1`.

### What I did

- **`apps/mobile/package.json`:** added `@effect/atom-react` `4.0.2`; added
  `scheduler` `^0.27.0` because pnpm reported the atom-react peer unmet
  (`found 0.28.0`, needs `>=0.25.0 <0.28.0`). Removed `zustand` (grep found no
  import left; only two explanatory comments in the new `atomStore.ts`).
- **`apps/mobile/src/store/atomStore.ts` (new):** ported the web
  `createAtomStore<T>(initializer, registry?)` unchanged in behaviour: the whole
  state lives in one `Atom.writable` held in an `AtomRegistry`, with partial and
  updater `set`, `replace`, the `Object.is` skip on unchanged state,
  `subscribe(listener)` called with `(state, prevState)` returning an
  unsubscribe, `getInitialState`, and a synchronous `get()` that sees the last
  `set`. Added `createBoundStore<T>(initializer)`: returns a callable hook
  `(selector?) => selected` with `getState`, `getInitialState`, `setState`,
  `subscribe`, `atom` and `registry` attached — the `create<T>()(…)`
  replacement. The callable is `useSyncExternalStore` over the compat store
  (zustand v5's `useStore`), so React re-renders only when `Object.is` on the
  selected value changes.
- **`apps/mobile/src/store/real-store.ts`:** `createStore` → `createAtomStore`,
  `zustand/vanilla` `StoreApi` → the local type. No other line changed.
- **`apps/mobile/src/store/chat-store.ts`:** `create<T>()(…)` →
  `createBoundStore<T>(…)`; return type `UseBoundStore<StoreApi<ChatStoreState>>`
  → the local `UseBoundStore<ChatStoreState>`. No other line changed.
- **`apps/mobile/src/auth/session-store.ts`:** same swap for `AuthStore`. No
  other line changed.
- **`apps/mobile/src/store/chat-store-provider.tsx`:** `useChatStore(selector)`
  now uses `useSyncExternalStore(store.subscribe, () => selector(store.getState()),
  () => selector(store.getInitialState()))` instead of zustand `useStore`; the
  `StoreApi` import is local. The `start()`/`stop()` effect and
  `useChatStoreApi()` are unchanged.
- **Six tests:** deleted only the `vi.mock('zustand', …)` block in
  `message-bubble-layout`, `message-list`, `message-bubble-stickers`,
  `message-bubble-ticks`, `attachment-body` and `composer-gifs`.
- **`apps/mobile/src/store/atomStore.test.ts` (new):** 8 semantics tests (ported
  from web) plus 2 for `createBoundStore`: the api is attached to the callable,
  and a rendered probe re-renders only when the selected value changes (a
  commit effect stays at 1 for a change to an unselected field and becomes 2
  when the selected field changes).
- **Hermes check:** ran `pnpm --filter @zilar/mobile exec expo export --platform
  ios --output-dir tmp-export`; it succeeded and wrote
  `apps/mobile/tmp-export/_expo/static/js/ios/entry-ebdcfaf643259acf4e736541b35ece36.hbc`
  (12,994,295 bytes ≈ 13 MB as expo prints, 12.39 MiB). Deleted `tmp-export`
  afterwards; it is not committed.

### Files changed

`apps/mobile/package.json`, `pnpm-lock.yaml`,
`apps/mobile/src/store/atomStore.ts`, `apps/mobile/src/store/atomStore.test.ts`,
`apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/chat-store.ts`,
`apps/mobile/src/auth/session-store.ts`,
`apps/mobile/src/store/chat-store-provider.tsx`, the six tests under
`apps/mobile/src/components/chat/`, and this task file.

### Commands and real results

- `pnpm install`: ok; after adding `scheduler` the atom-react peer warning is
  gone (only the pre-existing mobile `@types/react-dom` warning remains).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/atomStore.test.ts`:
  10 passed.
- `… src/store/selector-stability.test.ts src/store/chat-store.test.ts src/auth/session-store.test.ts`:
  3 files, 52 passed.
- `… src/store/real-store.test.ts`: 80 passed.
- `… the six component tests`: 6 files, 35 passed.
- `pnpm --filter @zilar/mobile exec expo export --platform ios --output-dir tmp-export`:
  exit 0; one iOS bundle, `entry-ebdcfaf643259acf4e736541b35ece36.hbc`,
  12,994,295 bytes (T-0506 measured 12.2 MB).
- `pnpm gate` (repo root): EXIT 0 —
  `gate: 15 changed file(s) against main`, `PASS install (frozen)`,
  `PASS format`, `PASS lint`, `PASS typecheck`,
  `PASS tests @zilar/mobile`, `scope: every changed file is inside the Allowed
  files`, `GATE PASS`.

### Deviations and notes

- **Selector hook choice.** Per the Spec's fallback I used
  `useSyncExternalStore` over the compat store instead of
  `useAtomValue(atom, selector)`, because the latter takes an inline selector
  and would derive a new atom per render. This is byte-for-byte zustand v5's
  `useStore` semantics, which the selector-stability test pins.
- I did **not** add a `RegistryContext.Provider` in the mobile provider. The
  compat hook does not read from the context (each store owns its registry, and
  `createAtomStore` creates one per store), and the Spec only asked to replace
  `useStore` with the stable selector hook. Web added the provider because its
  `useChatStore()` reads `useAtomValue`. If the lead wants mobile consumers on
  `useAtomValue` in M5, the provider should grow the `RegistryContext` wrapper
  then.
- The local `UseBoundStore<T>` is parameterised by the state type (`{ (): T;
  <U>(selector): U } & StoreApi<T>`), so the two bound-store return annotations
  change from `UseBoundStore<StoreApi<X>>` to `UseBoundStore<X>`. That is the
  "types become local equivalents" swap.
- `createAtomStore` keeps web's optional `providedRegistry` parameter untouched;
  `createBoundStore` takes only the initializer.

## Review (written by Claude)

Approved (lead, 2026-10-08). The mobile stores (real, mock and session) run on an atom registry through createAtomStore and createBoundStore. The bound hook and the provider use useSyncExternalStore with a selector, so selector stability holds. zustand is gone from mobile source; it stays only as a transitive dependency of @rn-primitives/portal. The six test edits are the dead zustand mocks only. Expo iOS export: 12.99 MB hbc. phone:smoke passed on the galena AVD, with the chat list showing live data, so WeakRef and the atom runtime work on Hermes. Pre-review clean, 0 nits.

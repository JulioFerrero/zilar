---
id: T-0531
title: "atom-react M1 (mobile): add @effect/atom-react, a zustand-compatible createAtomStore + bound-hook helper over an atom registry, swap real-store, chat-store (mock), session-store and the provider onto it, remove zustand from mobile; tests unchanged except dropping dead zustand mocks; Hermes export + phone smoke"
status: todo
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

## Review (written by Claude)

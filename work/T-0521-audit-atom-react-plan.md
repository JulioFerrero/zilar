---
id: T-0521
title: "Audit: how to replace zustand with @effect/atom-react on web (store.ts + realStore.ts) and mobile (chat-store.ts, session-store.ts) in small safe tasks — doc only"
status: todo
milestone: M5
branch: task/T-0521-audit-atom-react-plan
model: auto
effort: low
depends_on: []
estimate: 0.5 day
---

# T-0521: audit, zustand to @effect/atom-react

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `@effect/atom-react` replaces zustand on web and mobile (`docs/ROADMAP_EFFECT.md:15`). The stores are large, and 42 web files and 51 mobile files read them, so the move must be cut into small, behaviour-preserving tasks. **This task writes the plan only; it changes no code.**

### Verified facts (do not re-derive)
- **Web:**
  - `apps/web/src/store/store.ts` (1,863 lines; `createChatStore`, `ChatStoreState`, the mock store) and `apps/web/src/store/realStore.ts` (4,809 lines; `createRealChatStore`);
  - `apps/web/src/store/ChatStoreProvider.tsx` (47 lines) holds a zustand `StoreApi<ChatStoreState>` in React context. It calls `start()` and `stop()` on auth, and `useChatStore()` selects the **whole** state (`useStore(api, (state) => state)`);
  - the tests next to them: `realStore*.test.tsx`, `reload.test.tsx`, `search.test.ts`, `folders.test.ts`.
- **Mobile:** `apps/mobile/src/store/chat-store.ts` (1,595 lines), `apps/mobile/src/store/chat-store-provider.tsx` (88) and `apps/mobile/src/auth/session-store.ts` (142).
- **Effect** is 4.0.2 in web and mobile (T-0494). `docs/audit/effect-everywhere-plan.md` §2.6 (line 287 on) argued **against** atom-react; Julio overruled it on 2026-10-07. Line 445 says `@effect/atom-react` publishes 4.0.2. **It is not installed in this repo yet.**
- **Mobile constraints:** the Hermes bundle check in plan §2.7 and §3.2, and the Expo export used by T-0506.

### What to write
Write `docs/audit/effect-atom-react-plan.md` with these sections:
1. **API facts for atom-react 4.0.2.** Read the package's published `.d.ts`: fetch it with `pnpm view @effect/atom-react@4.0.2` and its tarball, or `pnpm dlx` into the temp folder. **Do not add it to any `package.json`.** Cover:
   - how an atom is defined;
   - reading and writing outside React (tests and actions);
   - the registry, its React provider and its scoping per provider;
   - how an Effect-backed atom runs, and how it is interrupted;
   - the selector or memo equivalent.
   
   Cite the `.d.ts` paths.
2. **Map of the web store:** each slice of `ChatStoreState`. For each, give its fields, its actions, the components that read it (by file) and whether they select narrowly or take the whole state. Do the same for the long-lived resources `start()` and `stop()` own (XMPP client, timers, subscriptions), with `file:line`.
3. **Same map for mobile.**
4. **The migration shape.** Recommend one shape, with a reason. For example:
   - a registry per provider, with one atom per slice;
   - actions stay plain functions that take the registry;
   - a `useChatStore()` compatibility hook during the move, so the 42 and 51 readers move gradually.
   
   Say how the tests that call `store.getState()` and `store.setState()` keep working during the move.
5. **Ordered task list:** 8 to 16 tasks, each **at most about 400 changed lines**, each with its files, the tests that must pass unchanged, its risk and its dependencies.
   - First: one task adds the package and a pilot slice behind the compatibility hook on web. **Measure the bundle size before and after** (`pnpm --filter @zilar/web build`; there is a baseline in plan §3.1).
   - Mark which tasks can run in parallel. Web goes first; mobile follows the web pattern.
6. **Hazards:**
   - render-count or ordering behaviour the tests pin (cite test names);
   - `subscribe` callers outside React;
   - `persist`-like caching (`chatListCache.ts`);
   - places where actions read state synchronously right after setting it.
   
   Give `file:line` for each.

Every claim cites `file:line` or a `.d.ts` path. Unknowns are listed as questions, not guesses.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/ROADMAP_EFFECT.md`, `docs/audit/effect-everywhere-plan.md` §2.6, §2.7, §3.1 and §3.2, then the store files listed above (skim the tests for pinned behaviour).

### Allowed files
`docs/audit/effect-atom-react-plan.md`, `work/T-0521-audit-atom-react-plan.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- `docs/audit/effect-atom-react-plan.md` exists with all 6 sections, citations and an ordered list of 8 to 16 small tasks.
- No code or `package.json` changed.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

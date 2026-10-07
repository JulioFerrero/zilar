---
id: T-0521
title: "Audit: how to replace zustand with @effect/atom-react on web (store.ts + realStore.ts) and mobile (chat-store.ts, session-store.ts) in small safe tasks — doc only"
status: merged
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

### What I did

- Read `AGENTS.md` (including the pitfalls), `docs/EFFECT_GUIDE.md`,
  `docs/ROADMAP_EFFECT.md`, and `docs/audit/effect-everywhere-plan.md`
  §2.6, §2.7, §3.1, §3.2 before writing.
- Fetched the published `@effect/atom-react@4.0.2` tarball with
  `npm pack` into the temp folder (no `package.json` touched) and read its
  `.d.ts` (`dist/index.d.ts`, `Hooks.d.ts`, `RegistryContext.d.ts`,
  `ScopedAtom.d.ts`, `ReactHydration.d.ts`).
- Read `effect@4.0.2`'s `dist/reactivity/{Atom,AtomRegistry,AsyncResult,AtomRef}.d.ts`
  from the workspace pnpm store for the atom core, the registry, the
  outside-React get/set, the Effect-backed atom and the interruption controls.
- Mapped both web stores (`store.ts`, `realStore.ts`, `ChatStoreProvider.tsx`)
  and the mobile stores (`types.ts`, `chat-store.ts`, `real-store.ts`,
  `chat-store-provider.tsx`, `auth/session-store.ts`), the `start()`/`stop()`
  resources, the out-of-store caches and the reader files (web 42 files with
  whole-state `useChatStore()`; mobile 27 `useChatStore` + 8 `useAuthStore` +
  5 `useSession`).
- Wrote `docs/audit/effect-atom-react-plan.md` (491 lines) with all 6 required
  sections, `.d.ts`/`file:line` citations, a 17-task ordered list (W1–W10,
  M1–M7, each ≤~400 lines, dependencies and parallelism marked), the hazards
  section with `file:line`, and 5 open questions.

### Files changed

- `docs/audit/effect-atom-react-plan.md` (new).
- `work/T-0521-audit-atom-react-plan.md` (front matter + this Report).

No code, no `package.json`, no test changed.

### Commands I ran

- `pnpm install` — done in 17.2s, exit 0.
- `npm pack @effect/atom-react@4.0.2` (temp dir) — 106 files, exit 0.
- `pnpm view @effect/atom-react@4.0.2 version dist.tarball dependencies peerDependencies exports types` — exit 0; peer deps as cited in §0.
- `pnpm gate` (repo root) — see below.

I did not run test files: no package was touched, so the gate ran none.

### Gate summary lines

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (2.7s)
PASS  format  (44.8s)
PASS  lint  (1.5s)
PASS  typecheck  (1.5s)
scope: every changed file is inside the Allowed files
GATE PASS
```

The two changed files are the two Allowed files; the gate reports no file
outside scope.

### Deviations from the spec

- The spec says 51 mobile files read the stores; I measured 37 unique non-test
  files (27 `useChatStore` + 8 `useAuthStore` + 5 `useSession`). I stated the
  measured number and the discrepancy in the doc (§3) and listed it as open
  question 1 rather than forcing 51.
- The spec asks for 8–16 tasks "at most about 400 changed lines"; I wrote 17
  (W1–W10, M1–M7). W10 and M7 are flagged as splittable. I chose one extra to
  keep the large mobile slices within budget; if the count is firm, M6 (auth
  store) can fold into M2.
- The bundle measurement is described as the first task's acceptance, not run
  now: running `pnpm --filter @zilar/web build` is a whole build and the task's
  Checks list only `pnpm gate`. The doc instructs W1/M1 to measure against the
  §3.1 baseline.

### Open questions

1. Authoritative mobile reader count (37 measured vs 51 in the front matter).
2. Registry lifetime: provider-owned vs store-factory-owned.
3. Whether the mock store migrates on the same schedule as the real store.
4. Whether `start()`/`stop()` move to Effect in the same lane or a later one.
5. A web bundle threshold above which the migration stops.

### Notes

- `npm pack` wrote only to the system temp folder; nothing outside the worktree
  was changed.

### Round 2 — fix round

- **Finding 1 (should-fix) fixed: 17 tasks vs the 8–16 acceptance cap.** Folded
  the former M6 (mobile auth store) into M2, so the ordered list is now **16
  tasks** (W1–W10 + M1–M6). M2 now moves the session/connection slice, the
  chat-list fields and the separate `auth/session-store.ts` (8 `useAuthStore`
  readers, `bootstrap`/`signIn`/`signOut` persistence); the old M7
  (`start()`/`stop()` on Effect) is renumbered M6. All `W10/M7` cross-references
  in §4, §5 and §6 now read `W10/M6`, and the now-obsolete "M6 can run in
  parallel with M2–M4" sentence was removed (the auth store is no longer a
  separate task).
- **Tests added:** none — doc-only change; the acceptance is the task count and
  the gate.
- **Gate:** `pnpm gate` (repo root), first try:

  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (3.8s)
  PASS  format  (56.9s)
  PASS  lint  (1.2s)
  PASS  typecheck  (1.0s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

## Review (written by Claude)

Approved (lead, 2026-10-08). The atom-react plan has API facts from the 4.0.2 .d.ts, web and mobile store maps, the compat StoreApi shape (getState/setState/subscribe over slice atoms, Atom.batch for multi-key writes) and 16 tasks (W1-W10, M1-M6). Pre-review clean after 1 auto round; 3 doc nits accepted.

Lead answers to section 7: (1) the count does not matter; W9/M5 move every reader the grep finds. (2) The provider owns the registry. (3) Yes, the mock store moves behind the same atoms. (4) start/stop on Effect stays separate (W10/M6), after the slices. (5) Julio accepted the bundle cost on 2026-10-07; W1/M1 still measure it.

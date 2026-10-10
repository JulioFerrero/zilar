---
id: T-0942
title: "Mock backend: one module per domain (seed, state and routes together) and alphabetical registries, so parallel mock tasks stop conflicting in state.ts, http.ts and data/index.ts"
status: merged
milestone: M5
branch: task/T-0942-mock-backend-domains
model: auto
effort: default
depends_on: [T-0939, T-0940, T-0941]
estimate: 0.5 day
---

# T-0942: Mock backend, one module per domain

## Spec (written by Claude, do not edit)

### Why
T-0937, T-0939, T-0940 and T-0941 (all merged) each had to edit the same three shared files in `packages/mock-backend/src`:
- `state.ts` (191 lines): one `MockData` with every table and mutator;
- `http.ts`: one `routes` array, plus an import per handler (`:15-30`, `:36-50`);
- `data/index.ts`: one `MockSeed` interface (`:28-41`) and `createSeed`.

So every pair of parallel tasks conflicted, and the lead had to stop each merge for a worker. The next tasks (D: groups and topics, F2: the fake XMPP, then C and F) would hit the same thing.

### What to build
1. **One folder per domain:** `src/domains/<domain>/`, where the domains are `me`, `chats`, `contacts`, `messages`, `search`, `ais`, `ai-memory`, `connections`, `machines`, `approvals`, `approval-rules`, `audit`, `tools` and `routines`. Each holds:
   - `seed.ts`: the domain's seed data and its type;
   - `state.ts`: the domain's table and mutators, built from its seed, with its own `reset`;
   - `routes.ts`: its route handler (today's `src/http/<domain>.ts`).

   Domains that share a table (for example tools, routines and runs) may share one folder. Move code; do not rewrite it.
2. **Registries:** `src/domains/index.ts` is the only list, one line per domain in **alphabetical order**, and each line points at a single `defineDomain({ name, seed, createState, routes })` object exported by that domain.
   - `src/state.ts` builds the combined `MockData` from that list.
   - `src/http.ts` builds the route list from it.
   - `src/data/index.ts` keeps only what is truly shared: people, the clock, and the `createSeed` assembly from the list.

   Adding a domain must then mean: create a folder, plus one alphabetical line in `src/domains/index.ts`.
3. **No behaviour change.** Every route answers exactly as before, and `createMockBackend`, `reset()` and `setDelay()` keep their signatures (`src/index.ts`). Prove it in the Report with a throwaway script, run before and after on the same seed: call every route the four tasks' Reports exercised and diff the JSON. Paste the diff, which must be empty.
4. **Every file stays under 400 lines.** No tests (Julio's rule).
5. **Document the rule** in a 5-line comment at the top of `src/domains/index.ts`: "a new domain is a folder plus one alphabetical line here".

### Read first
`AGENTS.md`, `docs/audit/mock-plan.md`, the whole of `packages/mock-backend/src`, and the Reports of `work/T-0937-*.md`, `T-0939-*.md`, `T-0940-*.md` and `T-0941-*.md` (for the routes to exercise).

### Allowed files
`packages/mock-backend/**`, `work/T-0942-mock-backend-domains.md`.

### Checks
```bash
pnpm --filter @zilar/mock-backend typecheck
pnpm gate
```

### Acceptance
- The Checks pass, and only `packages/mock-backend` changes.
- The before/after diff is empty.
- Every file is under 400 lines.
- `src/domains/index.ts` is the only list of domains.

---

## Report (written by the worker when done)

**Status: review. Every check passes; only `packages/mock-backend` and this task file changed.**

### What I did

Reorganised `@zilar/mock-backend` so each mock domain is one folder that owns its
seed, state and routes, and moved the three registries the four previous mock
tasks kept colliding on into a single list.

- **`src/domains/<domain>/`** — 14 domains: `me`, `chats`, `contacts`, `messages`,
  `search`, `ais`, `ai-memory`, `connections`, `machines`, `approvals`,
  `approval-rules`, `audit`, `tools` and `routines`. Each folder holds the files
  it owns: `seed.ts` (rows + type), `state.ts` (table + mutators, built fresh
  from the seed), `routes.ts` (the old `src/http/<domain>.ts`, unchanged bodies)
  and an `index.ts` exporting one `defineDomain({ name, seed, createState, routes })`.
  - `messages` has `seed.ts` + `state.ts` + the per-thread files under
    `threads/` (`builders.ts` moved next to them) but no route, because
    messages have no HTTP route today.
  - `contacts`, `search` and `ai-memory` are route-only (they read shared people
    or the AI memory built lazily); `ai-memory` keeps its own table and mutators.
  - `approval-rules` has an empty seed and a table; `tools` also owns the runs
    table, and `routines` is its own folder (the spec allows them to share, but
    separate folders keeps one registry line per domain).
- **`src/domains/index.ts`** — the only list of domains, one line per domain in
  alphabetical order, each pointing at its domain object. It starts with the
  5-line rule comment ("a new domain is a folder plus one alphabetical line here").
- **`src/state.ts`** — `MockData` (unchanged shape) is now assembled from the list:
  `createMockData(seed)` merges each `createState(seed)` slice onto `{ people }`.
  Getters are copied as accessors (`Object.defineProperties` over
  `getOwnPropertyDescriptors`), so a slice's mutator (`renameMe`, `putAi`,
  `removeConnection`, …) stays live on the merged view — this is what preserves
  the old object-literal getter behaviour exactly.
- **`src/http.ts`** — the route list is now `domains.map((domain) => domain.routes)`.
- **`src/data/index.ts`** — shrunk to what is truly shared: `people`, the clock,
  `MockSeed`/`MockMessage`, and the `createSeed` assembly that iterates the list.
  `data/` now holds only `people.ts` and `index.ts`.
- No behaviour change: I moved code (bodies of every handler are byte-for-byte the
  old ones apart from import paths) and did not rewrite route logic.

### Files changed

75 paths in `git diff --cached --stat` (all under `packages/mock-backend/src`, plus
this task file):

- New: `src/domains/index.ts`, `src/domains/domain.ts`, and per-domain
  `index.ts` + `seed.ts`/`state.ts` (and `routes.ts` where one exists).
- Moved (git rename): `src/http/*.ts` → `src/domains/<domain>/routes.ts`;
  `src/data/chats.ts` → `src/domains/chats/seed.ts`; `src/data/builders.ts` →
  `src/domains/messages/builders.ts`; `src/data/messages/*` →
  `src/domains/messages/threads/*` (the 12 thread files are unchanged except their
  `MockMessageSeed` import still resolves).
- Edited: `src/state.ts`, `src/http.ts`, `src/data/index.ts`, `src/index.ts`.
- Deleted: `src/data/{ais,approvals,audit,tools}.ts` (split into domain seeds).

Largest file is `src/domains/tools/routes.ts` at 205 lines (nothing is close to
the 400-line cap).

### Before/after proof (throwaway script, not committed)

A scratch `.mts` (in the OS temp dir, imported `createMockBackend` by absolute
path from `packages/mock-backend/src/index.ts`, run with
`pnpm --filter @zilar/devtools exec tsx <path>`). It pins the clock
(`Date` overridden and `now: () => new Date('2026-10-10T12:00:00.000Z')`), so
every id and timestamp is deterministic, and calls 64 routes — every route the
T-0937/39/40/41 reports exercised, including the error paths (400 search query,
400 audit "exactly one of", 404 deleted tool/AI/fact/machine, 409 second
decision, 204 deletes) and the mutations (`POST /ais`, `PATCH /ais/:id`,
stop/resume/assign machine, connection delete/test, ai-memory delete/clear,
approvals once and always, tool revert/run/delete, routine pause/resume/delete).

```
$ wc -l t0942-before.txt t0942-after.txt
      64 t0942-before.txt
      64 t0942-after.txt
$ diff t0942-before.txt t0942-after.txt && echo "DIFF EMPTY"
DIFF EMPTY
```

I ran the "before" file on the tree as it was at `ddca64cc` (before any edit) and
the "after" file on the refactored tree; the diff is empty, so every route
answers identically on the same seed.

### Commands and real results

- `pnpm install` — "Scope: all 15 workspace projects", "Done in 10.6s using pnpm
  v10.32.1" (no lockfile change: `package.json` untouched).
- `pnpm --filter @zilar/mock-backend typecheck` — clean (`tsc --noEmit`, no output).
- Throwaway single tests: none — `packages/mock-backend` has no test files (the
  task says no tests), so the gate's `SKIP tests` is correct.
- `pnpm gate` (from the repo root) — summary lines:

  ```
  gate: 75 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.2s)
  PASS  lint  (0.5s)
  PASS  typecheck  (0.7s)
  PASS  effect  (1.3s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

  (A first run before I filled in this Report printed the same steps and
  `GATE PASS` with `77 changed file(s)`; the count moved to 75 once the new files
  were staged. Both runs report the scope line in green.) The changed files are
  the moves (each rename shows as a delete + an add) plus the new/edited files,
  all inside `packages/mock-backend` and this task file; the scope line confirms
  nothing outside the Allowed files.

### Deviations / decisions (all intentional)

- **`defineDomain` keys are optional.** The object always has `name`; `seed`,
  `createState` and `routes` default to a no-op when a domain has nothing for
  them (`seed: () => ({})`, `createState: () => ({})`, `routes: () => undefined`).
  This is what lets `messages` have no route and `contacts`/`search` have no seed
  or table without dead placeholder files. Every domain still calls
  `defineDomain({ name, … })` and is listed by one line.
- **"its own reset" is the factory, not a method.** `defineDomain`'s fixed shape
  has no `reset` slot, so each `createState(seed)` is a pure rebuild; the backend
  `reset()` (unchanged signature) calls `createSeed()` + `createMockData()` again,
  rebuilding every domain's slice from scratch.
- **`tools` and `routines` are separate folders** rather than one shared folder.
  The spec allows sharing; separate folders keep exactly one registry line per
  listed domain, and the cross-reads (`tools` routes marking routines deleted,
  `routines` routes reading `tool.name`) go through the combined `MockData` as
  before.
- **`detachMachine` stays in the `ais` domain's state** (it clears AI
  home-machine links) but is called by the `machines` route through the merged
  `MockData`, matching the old single closure.
- **`ai-memory` owns its memory table** (moved out of the old `data/ais.ts`
  closure); the old `removeAiFact` used `this` on the data object and now uses a
  local closure instead — same behaviour, no `this` dependency (a T-0940 nit).
- **Shared types stay reachable.** `src/index.ts` still exports the same type
  names (`MockApproval`, `MockApprovalRule`, `MockAuditEntry`, `MockRoutine`,
  `MockRun`, `MockTool`, `MockToolVersion`, `MockAiMemory`, me/people/message/seed),
  now re-exported from the domain seeds instead of `data/`.

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The move:** one folder per domain under `packages/mock-backend/src/domains/`, with `seed.ts`, `state.ts`, `routes.ts` and `index.ts` each. `src/domains/index.ts` is the only list, one line per domain in alphabetical order.
- **Behaviour:** none changed. The before/after diff of every route the four Reports exercised is empty.
- **Size:** 1,111 lines added and 617 removed (per-domain boilerplate), with no file over 205, and only the package changed.
- **Check:** the gate passed.

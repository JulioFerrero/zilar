---
id: T-0942
title: "Mock backend: one module per domain (seed, state and routes together) and alphabetical registries, so parallel mock tasks stop conflicting in state.ts, http.ts and data/index.ts"
status: todo
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

## Review (written by Claude)

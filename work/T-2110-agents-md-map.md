---
id: T-2110
title: "AGENTS.md: point new readers at docs/ARCHITECTURE.md, say that boundaries are validated with Effect Schema (no file imports zod any more), and name the shared client-core API modules — docs only"
status: merged
milestone: M5
branch: task/T-2110-agents-md-map
model: deepseek/deepseek-flash
effort: default
estimate: 10 min
---

# T-2110: AGENTS.md points at the architecture map

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: make the codebase easier for other AIs and humans. The lead wrote `docs/ARCHITECTURE.md`, a map of where things live. `AGENTS.md` is the first file every worker reads, and two of its lines are out of date.

### Facts (read by the lead on 2026-10-19 at `c0af99b3b`)
- **`AGENTS.md:13`** says: "The full design is in `docs/PROJECT_PLAN.md`. Read the sections your task links to, not the whole thing."
- **`AGENTS.md:41`** says: "Validate data at boundaries (network, files, env vars) with `zod`."
  - `git grep -l "from 'zod'" -- apps packages` prints nothing: the code validates with Effect `Schema`.

### Steps
1. **After line 13**, add one sentence: "Where each piece of code lives, and how a request flows from the contract to both apps, is in `docs/ARCHITECTURE.md`. Read it before your first change."
2. **Replace line 41** with: "Validate data at boundaries (network, files, env vars) with Effect `Schema`. HTTP shapes live once in `packages/api-contract`, and app calls go through the shared `packages/client-core/src/<area>-api.ts` modules, never through a second hand-written client."
3. **Change nothing else.**

### Allowed files
- `AGENTS.md`
- `work/T-2110-agents-md-map.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- Exactly those two edits, and the gate passes.

---

## Report (written by the worker when done)

### What I did

- Added the architecture-map sentence after the `docs/PROJECT_PLAN.md` line in `AGENTS.md`, pointing new readers at `docs/ARCHITECTURE.md` before their first change.
- Replaced the `zod` line in the Coding rules with the Effect `Schema` sentence naming `packages/api-contract` and the shared `packages/client-core/src/<area>-api.ts` modules.
- Checked the referenced paths exist: `docs/ARCHITECTURE.md`, `packages/api-contract/package.json`, and `packages/client-core/src/*-api.ts` (`ais`, `chats`, `groups`, `stickers`, `topics`).
- Changed nothing else; no tests were needed for a docs-only change.

### Checks run

- `pnpm install --frozen-lockfile`: done in 23s (installed workspace dependencies, no tracked file changes).
- `pnpm gate`: `GATE PASS` — 2 changed files against main; `PASS install (frozen) (4.2s)`, `PASS format (3.7s)`, `PASS lint (3.9s)`, `PASS typecheck (2.3s)`, `SKIP effect (no source files changed)`, `SKIP build @zilar/server (no server, package or manifest change)`, scope: every changed file is inside the Allowed files, migration/images/size/comments checks passed.

### Notes for the lead

- `pnpm gate` reported exactly the two allowed files changed: `AGENTS.md` and `work/T-2110-agents-md-map.md`.

## Review (written by Claude)

Approved; the pre-review was clean. Exactly the two `AGENTS.md` edits in the spec: a pointer to `docs/ARCHITECTURE.md`, and Effect `Schema` in place of zod, with the shared client modules named.

---
id: T-1119
title: "Size split: apps/server/src/search/routes.ts (531) — snippet/stanza helpers to search/snippet.ts and the SQL builders to search/archive-query.ts, moved unchanged and re-exported"
status: merged
milestone: M5
branch: task/T-1119-split-search-routes
model: auto
effort: default
depends_on: [T-1116]
estimate: 0.1 day
---

# T-1119: Split `search/routes.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is 400 lines per source file (2026-10-10); the plan is `docs/audit/size-plan.md` #66. `apps/server/src/search/routes.ts` has 531 lines (read by the lead).

**Snippet and stanza helpers:**
- `SEARCH_MIN_FUZZY_QUERY_CHARS` (`:64`), `START_SEL` and `STOP_SEL` (`:66-67`), `headlineToSnippet` (`:72`);
- `timestampToIso` (`:98`), `senderNameFor` (`:103`), `stanzaFrom` (`:123`), `chatJidFor` (`:129`);
- `tagAttribute` (`:510`), `correctionTarget` (`:517`), `retractTarget` (`:526`).

**SQL builders:**
- `ArchiveQueryInput` (`:133`), `ArchiveEditRow` (`:142`);
- `buildArchiveQuery` (`:161`), `buildArchiveEditsQuery` (`:202`), `buildFuzzyCandidatesQuery` (`:233`), `exactInCodeMarks` (`:264`).

**What stays:** the constants and types at `:26-63`, `SearchResult` (`:285`) and `runSearchEffect` (`:295`).

**Importers:** many files import `./routes` or `../search/routes` (for example `apps/server/src/search/api.ts`, `apps/server/src/push/candidates.ts`, `apps/server/src/agents/memory/indexer.ts`, `apps/server/src/gifs/api.ts`).

### What to build
1. **A new `apps/server/src/search/snippet.ts`** holds the snippet and stanza helpers above, **moved byte-for-byte** with their imports.
2. **A new `apps/server/src/search/archive-query.ts`** holds the SQL builders above, moved byte-for-byte. Non-exported helpers that another file now needs become exported.
3. **`routes.ts`** imports what `runSearchEffect` needs, and **re-exports every name it exported before** (`export { … } from './snippet'` and `'./archive-query'`), so no importer changes.
4. **No behaviour change**, and no file outside these three changes.
5. **Line counts:** each file stays at most 400 lines. Paste `wc -l` in the Report.
6. **Tests** (the message pipeline): run `ls apps/server/src/search/` to check for nearby tests. If there are none, say so; the gate covers typecheck.

### Read first
`AGENTS.md`, and `apps/server/src/search/routes.ts`.

### Allowed files
`apps/server/src/search/routes.ts`, `apps/server/src/search/snippet.ts`, `apps/server/src/search/archive-query.ts`, `work/T-1119-split-search-routes.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- Every file is at most 400 lines.
- `git diff main --stat` lists only the three files and the task file.

---

## Report (written by the worker when done)

### What I did
- Added `apps/server/src/search/snippet.ts` (95 lines) with the snippet/stanza
  helpers moved byte-for-byte from `routes.ts`: `SEARCH_MIN_FUZZY_QUERY_CHARS`,
  `START_SEL`/`STOP_SEL`, `headlineToSnippet`, `timestampToIso`, `senderNameFor`,
  `stanzaFrom`, `chatJidFor`, `tagAttribute`, `correctionTarget`, `retractTarget`.
  `timestampToIso`, `senderNameFor` and `chatJidFor` were non-exported in
  `routes.ts` and are now exported (the spec's rule for helpers another file now
  needs); `tagAttribute` stays private to the file.
- Added `apps/server/src/search/archive-query.ts` (161 lines) with the SQL
  builders moved byte-for-byte: `ArchiveQueryInput`, `ArchiveEditRow`,
  `buildArchiveQuery`, `buildArchiveEditsQuery`, `buildFuzzyCandidatesQuery`, and
  `exactInCodeMarks` (was non-exported, now exported because `runSearchEffect`
  needs it).
- `routes.ts` (303 lines, down from 531) keeps the constants/types at `:26-63`,
  `SearchResult` and `runSearchEffect`, imports the moved helpers, and re-exports
  every name it exported before, so no importer changed:
  `export { SEARCH_MIN_FUZZY_QUERY_CHARS, headlineToSnippet, stanzaFrom,
  correctionTarget, retractTarget } from './snippet'` and
  `export { buildArchiveQuery, buildArchiveEditsQuery,
  buildFuzzyCandidatesQuery, type ArchiveQueryInput, type ArchiveEditRow } from
  './archive-query'`.
- No behaviour change; no file outside the three (plus this task file) changed.
- `buildArchiveQuery` etc. still read `SEARCH_MAX_CANDIDATES` (kept in
  `routes.ts` per the spec), so `archive-query.ts` imports it from `./routes`.
  That is a `routes` ↔ `archive-query` import cycle, safe here because the
  constant is only read inside function bodies at call time (never during module
  evaluation).

### Files changed
- `apps/server/src/search/routes.ts` (modified)
- `apps/server/src/search/snippet.ts` (new)
- `apps/server/src/search/archive-query.ts` (new)
- `work/T-1119-split-search-routes.md` (this file)

### Commands and results
- `pnpm install` — done, `Packages: +1172`, no errors (one pre-existing peer
  warning in `apps/mobile`: `@types/react`).
- `ls apps/server/src/search/` — `api.ts match.ts routes.ts service.ts`. There
  are **no test files** near the change, so there is no single test to run; the
  gate typechecks the package (spec step 6).
- `pnpm exec prettier --check apps/server/src/search/{routes,snippet,archive-query}.ts`
  — `All matched files use Prettier code style!`
- `pnpm gate` — **GATE PASS**. Summary lines:
  - `PASS  install (frozen)  (1.7s)`
  - `PASS  format  (0.7s)`
  - `PASS  lint  (1.2s)`
  - `PASS  typecheck  (3.4s)`
  - `PASS  effect  (0.7s)`
  - `SKIP tests @zilar/server (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
- `wc -l` — `routes.ts 303`, `snippet.ts 95`, `archive-query.ts 161` (all ≤ 400).

### Deviations / notes
- `git diff main --stat` also lists `work/BOARD.md` (3 deletions), but that is
  **not my change**: this branch is behind `main` (`HEAD e0135d2` is an ancestor
  of `main 946d158`, which carries the T-1118/T-1119/T-1120 BOARD rows). `git
  status` shows no BOARD.md edit from me; BOARD.md is not in my Allowed files and
  I did not touch it. The gate confirmed every changed file is inside scope.

### Blocked / needs a decision
- None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 2 nits.**
- **The split:** `search/routes.ts` goes from 531 to 303 lines. `search/snippet.ts` (95) and `search/archive-query.ts` (155) hold the moved helpers. `routes.ts` re-exports every name it exported before (`:290-303`), so no importer changed.
- **The lead's line check:** the lines removed from `routes.ts` that are missing from the new files are only import lines and the declaration lines that gained `export`.
- **Nit 1, the import cycle** (`archive-query` imports `SEARCH_MAX_CANDIDATES` from `routes`, which re-exports `archive-query`): it is safe, because the constant is read only inside the builders (`:53,85,116`), never at load. The lead loaded `routes.ts` with tsx: `buildArchiveQuery` and `headlineToSnippet` are functions and the constant is 5000. A later tidy could move the constant into `archive-query.ts`.
- **Nit 2, accepted:** the Report's line count is off.
- **The gate passed.**

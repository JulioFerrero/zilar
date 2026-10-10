---
id: T-0889
title: "Gate scope check: `a/**/x` also matches files directly in `a/` (zero folders), as in every glob tool"
status: todo
milestone: M5
branch: task/T-0889-scope-glob-zero-folders
model: auto
effort: default
depends_on: []
estimate: 0.1 day
---

# T-0889: `**` matches zero folders in the scope check

## Spec (written by Claude, do not edit)

### Why
`tokenMatcher` in `packages/devtools/src/gate/scope.ts:27-34` turns `**` into `.*` but keeps the slashes around it. So `apps/web/src/**/*.test.tsx` becomes `^apps/web/src/.*/[^/]*\.test\.tsx(/.*)?$`, which needs at least one folder after `src/`.

The 2026-10-09 combined check (`lead batch check`) reported `apps/web/src/App.test.tsx` as out of scope for T-0862, although its spec allowed `apps/web/src/**/*.test.tsx`. In vitest, git pathspecs and standard globs, `**/` matches zero or more folders.

### What to build
1. In `tokenMatcher`, make `/**/` match one slash or a slash, any folders and a slash, so `a/**/b.ts` matches both `a/b.ts` and `a/x/y/b.ts`. A leading `**/` must match from the root or below.
2. Keep the existing behaviour:
   - `a/b/**` matches everything below `a/b`;
   - `a/*.ts` stays in one folder;
   - a bare path matches itself and anything below it.
3. Also escape `?` in `escapeRegex` (line 22), so a literal `?` in a path is not a regex quantifier.
4. Add tests to the existing scope tests in `packages/devtools/src/gate/gate.test.ts`, covering:
   - the zero-folder case (`apps/web/src/**/*.test.tsx` matches `apps/web/src/App.test.tsx` and `apps/web/src/a/b/C.test.tsx`, but not `apps/web/src/App.tsx`);
   - the leading `**/`;
   - the three existing behaviours;
   - a bracket path like `apps/mobile/src/app/chat/[id].tsx`.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), `packages/devtools/src/gate/scope.ts` and its tests in `packages/devtools/src/gate/gate.test.ts`.

### Allowed files
`packages/devtools/src/gate/scope.ts`, `packages/devtools/src/gate/gate.test.ts`, `work/T-0889-scope-glob-zero-folders.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/devtools exec vitest run --reporter=dot src/gate src/lead
pnpm --filter @zilar/devtools typecheck
pnpm exec oxlint <your changed files>
```

### Acceptance
- The Checks pass.
- oxlint and the typecheck are clean.
- Only Allowed files change.

---

## Report (written by the worker when done)

## Review (written by Claude)

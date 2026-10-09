---
id: T-0862
title: "Web code splitting: lazy settings, setup, welcome and login routes"
status: todo
milestone: M5
branch: task/T-0862-web-lazy-routes
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0862: Web code splitting: lazy settings, setup, welcome and login routes

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Finding D-W3 in `docs/audit/simplify-2026-10-09/D-web.md`.
- **One chunk:** `apps/web/src/routes/AppRoutes.tsx:1-31` imports all 22 pages statically, so Vite emits one 1,437 KB chunk (416 KB gzip).
- **What could be split:** the settings-only pages (`PackEditor`, `AiPanel`, `StickersPage`, `IntegrationsPage`, `ToolDetailPanel`, `NotificationsPage`, `MachinesPage`, `ConnectionsPage`, `ApprovalsPage`, `FoldersPage`, `SetupPage`), plus `LoginPage` with better-auth, add up to about 180-220 KB minified.

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Load those route pages with `React.lazy` and a `Suspense` fallback that uses the existing loading pattern (`StateMessage` / `Skeleton`, with `SKELETON_DELAY_MS` if that is how other loading states work). The chat routes stay eager.
2. **Markdown is NOT in scope** (another task touches `MessageBubble`).
3. Tests that render lazy routes may need `findBy` / `waitFor` instead of `getBy`. Change only that kind of line, and list them.
4. Run `pnpm --filter @zilar/web build` before and after, and report the chunk list with sizes (gzip too).

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`apps/web/src/routes/AppRoutes.tsx`, `apps/web/src/routes/*.tsx`, `apps/web/src/**/*.test.tsx`, `apps/web/src/test/**`, `work/T-0862-web-lazy-routes.md`.

This task runs the whole web suite (16 s), because route rendering is used by many tests.

### Checks (wave mode)
```bash
pnpm --filter @zilar/web test --reporter=dot
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/web build
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Every number the spec asks for (sizes, timings, counts) is in the Report, measured.
- Live check for Julio's single test: Settings pages open normally on web (a short loading state the first time is fine).

---

## Report (written by the worker when done)

## Review (written by Claude)

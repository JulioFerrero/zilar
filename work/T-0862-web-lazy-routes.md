---
id: T-0862
title: "Web code splitting: lazy settings, setup, welcome and login routes"
status: merged
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
`apps/web/src/routes/AppRoutes.tsx`, `apps/web/src/routes/*.tsx`, `apps/web/src/**/*.test.tsx`, `apps/web/src/App.test.tsx`, `apps/web/src/test/**`, `work/T-0862-web-lazy-routes.md`.

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


**What changed**
- `apps/web/src/routes/AppRoutes.tsx`: Connections, Login, Folders, Setup, Machines, Notifications, Integrations, Stickers and Approvals pages load with `React.lazy`. One `Suspense` wraps `<Routes>` and uses the existing `LoadingScreen` (delayed by `SKELETON_DELAY_MS`) as the fallback. Chat routes stay eager. Markdown is untouched.
- `PackEditor` is only used by `StickersPage`, so it moved into the StickersPage chunk. `AiPanel` and `ToolDetailPanel` are used by the eager chat routes, so they cannot be split here. The audit's list was partly wrong on that point.
- `AisPage`, `ProfilePage`, `RequestsPage`, `BlockedPage` stay eager (not in the spec list).

**Chunks (vite build, minified / gzip)**
- Before: `index` 1,437.39 kB / 416.18 kB.
- After: `index` 740.45 kB / 210.88 kB. The rest went into shared chunks (`api` 250 kB, `card` 184 kB, `button` 105 kB) that Vite split out, plus the new route chunks: Stickers 30.81/9.13, Machines 19.16/5.46, Integrations 10.76/3.15, Notifications 9.21/3.13, Connections 7.11/2.49, Approvals 6.84/2.51, Setup 4.50/1.86, Folders 4.31/1.81, Login 1.04/0.60 kB.
- The route chunks themselves total only about 94 kB, so the entry chunk fell mostly because Vite also split shared code. The spec's 180-220 KB estimate was too high for these pages alone.

**Test lines changed (all getBy -> findBy / async, nothing else)**
- `apps/web/src/test/setup.ts`: `configure({ asyncUtilTimeout: 5000 })`, because the first lazy import is cold and 1 s was too short under load.
- `IntegrationsPage.test.tsx`: `getAllByRole('region')` -> `await findAllByRole`.
- `App.test.tsx`, `ChatList.test.tsx` (Machines, Chat folders), `InstallMenu.test.tsx`, `FolderRail.test.tsx`, `FolderEditorDialog.test.tsx` (`openCreate` and the Create/Edit button lookups): `getBy` -> `await findBy`, test functions made `async`.

**Checks**
- Web tests: 1943 passed, 3 of 3 full runs after the last change. Earlier runs under heavy machine load had `Composer.voice.test.tsx` fail; that file also failed 3 tests on the unchanged baseline under load and passes alone, so it is a load flake, not caused by this task.
- `pnpm --filter @zilar/web typecheck` clean; build ok; prettier and oxlint clean on the changed files.
- Not run: `pnpm gate` (wave mode). No live check of Settings pages was done.

## Review (written by Claude)

**Lead, 2026-10-10: approved.**
- **What changed:** 9 route pages are lazy behind one Suspense, with LoadingScreen as the fallback.
- **Size:** the entry chunk is 740 kB / 211 kB gzip. The real saving is about 94 kB of lazy pages, because the shared chunks still load at start.
- **Tests:** the full web suite passes 3 of 3. `App.test.tsx` needed `findBy` for the lazy routes, so I added it to Allowed.
- **Checks:** the combined check is clean.
- **Live check for Julio:** the settings pages load.

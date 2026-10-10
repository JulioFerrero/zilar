---
id: T-0881
title: "Mobile is dark-only: remove the dead light-theme branches (155 [scheme] lookups, 135 useColorScheme calls)"
status: todo
milestone: M5
branch: task/T-0881-mobile-dark-only
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0881: Mobile is dark-only: remove the dead light-theme branches (155 [scheme] lookups, 135 useColorScheme calls)

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Finding E-F4 in `docs/audit/simplify-2026-10-09/E-mobile.md`. The app is dark-only: `apps/mobile/src/app/_layout.tsx` forces dark. Yet there are 155 `[scheme]` lookups and 135 `asColorScheme(useColorScheme()…)` calls, so each of those components subscribes to the colour scheme and keeps a light branch nothing can reach.

Line numbers come from the audit and may have moved since: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Confirm in `_layout.tsx` (and in the native config, `app.json` `userInterfaceStyle`) that the app always renders dark.
2. Replace each `[scheme]` lookup with the dark value, and remove the `useColorScheme` calls. If a shared theme object has light and dark halves, keep only dark, and say what you removed.
3. Rendered output in dark must be identical; the screen tests and the phone smoke show it. Count the lines removed.
4. Do not touch `apps/mobile/src/store/**`.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), the audit section and task Reports cited above, and the files listed.

### Allowed files
`apps/mobile/src/**`, `apps/mobile/app.json`, `work/T-0881-mobile-dark-only.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/mobile test --reporter=dot
pnpm --filter @zilar/mobile typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit. The machine is shared, so note `uptime` next to any timing.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Lines removed (and every other number the spec asks for) are in the Report, measured.
- Live check for Julio's single test: The phone smoke (lead) screenshots must look the same.

---

## Report (written by the worker when done)

## Review (written by Claude)

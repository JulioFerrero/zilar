---
id: T-0885
title: "Web store tests share one fakeApi/fakeXmpp harness (159-line copies today)"
status: todo
milestone: M5
branch: task/T-0885-web-store-fakes
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0885: Web store tests share one fakeApi/fakeXmpp harness (159-line copies today)

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Finding F-F5 in `docs/audit/simplify-2026-10-09/F-tests.md`.
- **`fakeApi` copies:** 159 lines in both `apps/web/src/store/realStore.test.tsx:205` and `realStore.forward.test.tsx:130`, and 151 lines in `realStore.media.test.tsx:59`.
- **`fakeXmpp` copies:** 62, 63 and 26 lines.
- **No shared home:** `apps/web/src/test/` holds only `setup.ts` and `renderApp.tsx`.

T-0884 adds `createFakeXmppCore()` in `@zilar/xmpp-core/testing`. If it is already on main when you start, use it; otherwise build the web fake typed against `XmppCore` and leave a one-line TODO to switch.

Line numbers come from the audit and may have moved since: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Add `apps/web/src/test/storeHarness.ts` with a `fakeApi(overrides)` and a typed `fakeXmpp(overrides)`.
2. Migrate the web store tests to them. The test count stays the same, and the assertions are unchanged.
3. Count the test lines removed. Only web store tests change.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), the audit section and task Reports cited above, and the files listed.

### Allowed files
`apps/web/src/test/**`, `apps/web/src/store/**/*.test.ts`, `apps/web/src/store/**/*.test.tsx`, `work/T-0885-web-store-fakes.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/web exec vitest run --reporter=dot src/store
pnpm --filter @zilar/web typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit. The machine is shared, so note `uptime` next to any timing.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Lines removed (and every other number the spec asks for) are in the Report, measured.

---

## Report (written by the worker when done)

## Review (written by Claude)

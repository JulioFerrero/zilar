---
id: T-0885
title: "Web store tests share one fakeApi/fakeXmpp harness (159-line copies today)"
status: merged
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
`apps/web/src/test/**`, `apps/web/src/store/**/*.test.ts`, `apps/web/src/store/**/*.test.tsx`, `apps/web/src/components/MessageBubble.tsx`, `apps/web/src/components/MessageContent.test.tsx`, `apps/web/src/components/MessageList.test.tsx` (lead: carried by the merge of T-0880), `work/T-0885-web-store-fakes.md`.

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

**Lead, 2026-10-10: approved.** `apps/web/src/test/storeHarness.ts` holds the shared `fakeApi` and a typed `fakeXmpp`, and 4 web store test files use them, for about −452 lines. The 222 tests are unchanged. A TODO says to switch to `createFakeXmppCore` (T-0884), which lands in the same wave. The combined wave 4 check passes.

- Added `apps/web/src/test/storeHarness.ts` (`fakeApi(overrides)`, typed `fakeXmpp(overrides: Partial<XmppCore>)`, `FakeXmpp` type; TODO(T-0884) to switch to `createFakeXmppCore`, which is not on main).
- Migrated `realStore.test.tsx`, `realStore.forward.test.tsx`, `realStore.media.test.tsx`, `realStore.topics.test.tsx` (fakeXmpp only, wrapper adds `joined`). `reload.test.tsx` left alone (its fakeApi/fakeXmpp differ: seeded history, no `status`).
- Lines: 703 removed, 251 added (harness 148 + imports/wrappers) = about 452 net, measured with `git diff --shortstat` against the base.
- Tests: `src/store` 222 passed in 17 files, 3 of 3 runs after the last commit (load average 210-230, machine busy). The three audit files: 146 tests before and after. Assertions untouched.
- typecheck and oxlint clean, prettier unchanged.
- Differences between old copies, now unified: media's `fakeApi` had only the DM chat (harness has DM + group) and upload `getUrl` `.../file` (harness `.../voice.m4a`); `realStore.test.tsx` used constant `srv-1` for sendMessage (harness default), forward keeps its `srv-N` counter via a local wrapper. All tests still pass.
- Audit line numbers were right. `pnpm gate` not run (wave mode).

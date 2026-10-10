---
id: T-0884
title: "One createFakeXmppCore() in xmpp-core/testing; mobile store tests use it and shared fakeApi/fakeAppState helpers"
status: todo
milestone: M5
branch: task/T-0884-fake-xmpp-core-mobile-fakes
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0884: One createFakeXmppCore() in xmpp-core/testing; mobile store tests use it and shared fakeApi/fakeAppState helpers

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Findings I-F1 and F-F5 in `docs/audit/simplify-2026-10-09/`.
- **Mobile fake cores:** 11 `fakeCore()` functions in `apps/mobile/src/store/real-store.*.test.ts`, 8 of them byte-identical (md5 equal; for example `real-store.invite-links.test.ts:41-57`). Many return `unknown`, so the typecheck never checks them against the real interface.
- **Other mobile fakes:** about 25 `fakeApi` and 11 `fakeAppState` copies, plus `effects/events.test.ts:35`, `pins.test.ts:34` and `groups.test.ts:31`.
- **Server:** `apps/server/src/agents/gateway.test.ts:74-233` has a 160-line `FakeCore implements XmppCore`.

Line numbers come from the audit and may have moved since: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Add `packages/xmpp-core/src/testing.ts` with `createFakeXmppCore(overrides)`, typed against the real `XmppCore` interface. It records calls, has `emit(event, payload)` and configurable failures. Export it as `@zilar/xmpp-core/testing` (package.json `exports`), and keep it out of the main index.
2. Add `apps/mobile/src/store/test-support.ts` with shared `fakeApi` and `fakeAppState` builders, taking overrides.
3. Migrate the mobile store tests to them. The test count stays the same, and every test passes unchanged in what it asserts.
4. Count the test lines removed. Do not touch the server or web tests in this task.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), the audit section and task Reports cited above, and the files listed.

### Allowed files
`packages/xmpp-core/src/testing.ts`, `packages/xmpp-core/src/testing.test.ts`, `packages/xmpp-core/package.json`, `apps/mobile/src/store/**/*.test.ts`, `apps/mobile/src/store/test-support.ts`, `work/T-0884-fake-xmpp-core-mobile-fakes.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/xmpp-core exec vitest run --reporter=dot
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/store
pnpm --filter @zilar/mobile typecheck
pnpm --filter @zilar/xmpp-core typecheck
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

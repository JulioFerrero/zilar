---
id: T-0884
title: "One createFakeXmppCore() in xmpp-core/testing; mobile store tests use it and shared fakeApi/fakeAppState helpers"
status: merged
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

- Merged `task/T-0857-xmpp-events-streams` first, so the fake is typed against the interface without `events.*`.
- New: `packages/xmpp-core/src/testing.ts` (88 lines; `createFakeXmppCore(overrides)` with `calls`, `emit` and `failures`; reuses `makeEventHub`; exported as `@zilar/xmpp-core/testing`, not in the main index), `testing.test.ts` (4 tests), `apps/mobile/src/store/test-support.ts` (69 lines: `fakeAppState`, `fakeApi(overrides)`, `fakeApiWithMembers`).
- Migrated 14 mobile store test files: the 8 byte-identical `fakeCore()` (channels, general-only, groups-create, invite-links, media, prefs-pins, roles, topics) now use `createFakeXmppCore()` with no `as never` casts; `effects/events|groups|pins.test.ts` fakeCores too; `fakeAppState` in 9 files; the `fakeApi` boilerplate in 14 files.
- Lines in the migrated test files: 607 removed, 136 added (net -471). With the 69-line support file, mobile net is -402. The 88+39 xmpp-core lines are new.
- Tests: mobile `src/store` 315 passed | 1 skipped before and after (3 of 3 runs after the last commit); xmpp-core 249 passed | 4 skipped (245 + 4 new). Both typechecks and oxlint clean. Load average was 100-300 during the runs.
- Behaviour differences: the fake core now also answers `me()` (`me@zilar.test`), `leaveRoom` and `requestUploadSlot`, which the old copies lacked; no test changed an assertion. `events.test.ts` now drives events through `core.emit(...)` instead of a captured handler map, and `prefs-pins` pin test does the same.
- Not migrated (stateful, test-specific fakes that record sent stanzas or history): `fakeXmpp` in `real-store.test.ts`, `forward`, `attachments`, `mentions`, `voice`; `fakeApi`/`fakeAppState` in `real-store.test.ts` (richer, with `setActive/setBackground`), forward, attachments, voice, mentions, roles-mock, others in `src/store` outside this list. `apps/server` gateway FakeCore is out of scope.
- Audit facts: 11 `fakeCore()` copies claimed, I found 8 identical `fakeCore()` plus 3 `effects/*` variants; matches. I did not run `pnpm gate` (wave mode).

## Review (written by Claude)

**Lead, 2026-10-10: approved.** `@zilar/xmpp-core/testing` exports a typed `createFakeXmppCore`, and mobile's `store/test-support.ts` holds the shared `fakeApi` and `fakeAppState`. 14 mobile store test files use them, for a net −402 lines. The test count is unchanged (315). The combined wave 4 check passes.

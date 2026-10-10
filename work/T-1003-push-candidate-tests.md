---
id: T-1003
title: "Push: a few tests for who gets a notification (hidden private topic, muted chat, own message, retraction)"
status: merged
milestone: M5
branch: task/T-1003-push-candidate-tests
model: auto
effort: default
depends_on: [T-1002]
estimate: 0.25 day
---

# T-1003: Tests for push candidates

## Spec (written by Claude, do not edit)

### Why
Julio's rule (2026-10-10) keeps tests only for crucial code, and the message pipeline is part of it. No test covers push notifications: `apps/server/src/push/` has no test file. The checks that decide whether a message notifies are in `resolveCandidate` (`apps/server/src/push/candidates.ts:16`). It is exported, so it can be tested directly against a test database, without the MAM archive.

### What to build
Create one new file, `apps/server/src/push/candidates.test.ts`, with these 5 tests and no more.

**Setup:** copy the way `apps/server/src/roles/roles.test.ts` sets up `createTestContext` (`apps/server/src/test-support.ts:248`), `seedUser` and `seedGroup` (`apps/server/src/test-support/seed.ts:99`).
- `deps` is a `PushServiceDeps` (`apps/server/src/push/service.ts:20`). Use `db` and `config` from the context. `resolveCandidate` never touches `archive`, `cipher`, `sender`, `logger` or `recentlyNotified`, so fill them with stubs.
- `allowed` is a `SearchOwner` (`apps/server/src/search/service.ts:50`), built by hand.
- `row` is an `ArchiveCandidate` (`apps/server/src/push/archive-scan.ts:14`), built by hand. `kind: 'groupchat'` with `owner` = the topic room's bare JID makes a room message.

The 5 tests:
1. **Retraction.** A row whose `xml` contains `urn:xmpp:message-retract:1` gives `{ status: 'skip' }` (`candidates.ts:27-29`).
2. **Own room message.** A room row whose `nick` is the user's own account localpart gives `skip`.
3. **Private topic.** A room row in a private topic that the user cannot see gives `{ status: 'hidden' }` (`candidates.ts:62-64`). A member who can see the topic gets `ok` for the same row.
4. **Group mute.** A topic with no `chat_prefs` row of its own, whose group General room has a `chat_prefs.muted_until` in the future, gives `{ status: 'muted' }` (`isMuted`, `candidates.ts:136`).
5. **Expired mute.** The same setup with `muted_until` in the past gives `{ status: 'ok' }`, with `message.chatJid` = the room JID.

To make a topic private and decide who can see it, read `canSeeTopic` in `apps/server/src/topics/access.ts` and seed the rows it reads.

Do not change any source file. If a test fails because the code is wrong, stop and report it in the Report; do not fix the code.

### Read first
`AGENTS.md`, `apps/server/src/push/candidates.ts`, `apps/server/src/push/service.ts`, `apps/server/src/push/archive-scan.ts:14-23`, `apps/server/src/topics/access.ts` (`canSeeTopic`), `apps/server/src/roles/roles.test.ts` (the setup to copy), and `apps/server/src/test-support/seed.ts`.

### Allowed files
`apps/server/src/push/candidates.test.ts`, `work/T-1003-push-candidate-tests.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run --maxWorkers=2 --reporter=dot src/push/candidates.test.ts
pnpm gate
```

### Acceptance
The Checks pass with 5 tests, and the Report pastes the vitest summary line.

---

## Report (written by the worker when done)

**Status:** done, ready for review.

**What I did.** Added `apps/server/src/push/candidates.test.ts` with exactly the 5 tests from the
spec, all calling the exported `resolveCandidate` against a PGlite test database. No source file was
changed. Setup copies `roles.test.ts`: `createTestContext` from `../test-support`, `seedUser` and
`seedGroup` from `../test-support/seed`. `deps` uses `context.db` and `context.config`, a fixed
`now` (`2026-06-01T12:00:00Z`), and stubs for `archive`, `cipher`, `sender`, `logger` and
`recentlyNotified` (none are read before the verdict). `allowed` is a hand-built `SearchOwner`, and
each `row` is a hand-built `ArchiveCandidate` (`kind: 'groupchat'`, `owner` = the topic room JID).

- **Retraction:** a row whose `xml` contains `urn:xmpp:message-retract:1` gives `skip`.
- **Own room message:** a room row whose `nick` is `localpartFor(userId)` gives `skip`.
- **Private topic:** a private `topics` row with no `topic_members` row for the caller gives
  `hidden`; the same row gives `ok` for a member seeded through `group_members` + `topic_members`
  (`place: 'Team › Hiring'`).
- **Group mute:** a public topic with no own `chat_prefs` row, whose group General room
  (`<group room localpart>@<mucDomain>`) has a future `chat_prefs.muted_until`, gives `muted`.
- **Expired mute:** the same setup with `muted_until` in the past gives `ok`, with
  `message.chatJid` = the room JID.

**Files changed (both inside Allowed files):**
- `apps/server/src/push/candidates.test.ts` (new)
- `work/T-1003-push-candidate-tests.md` (this Report + front-matter status)

**Commands and real results.**

Single test file:
```
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/candidates.test.ts
 Test Files  1 passed (1)
      Tests  5 passed (5)
   Duration  12.97s
```

`pnpm gate` from the repo root (the first run failed the `format` step only; I let Prettier rewrite
the new file, then re-ran):
```
gate: 2 changed file(s) against main
PASS  install (frozen)  (2.1s)
PASS  format  (0.7s)
PASS  lint  (1.1s)
PASS  typecheck  (5.1s)
SKIP effect (no source files changed)
PASS  tests @zilar/server  (6.1s)
scope: every changed file is inside the Allowed files
GATE PASS
```

**Problems / deviations.** None. The spec's 5 tests are all present and no others were added. The
first `pnpm gate` failed only on `format` for the new file; Prettier's fix changed only line
wrapping, so behaviour is unchanged and the re-run passed.

**Open questions.** None.

### Fix round 1

Review point: the private-topic test proved the group-membership gate (`access.ts:143-146`), not the
private-topic check (`access.ts:147-153`), because the only non-member was a user outside the group
entirely. Fixed by adding `outsiderId` to the same `seedGroup` call as a plain group `member`, left
off the topic with no `addTopicMember`, and asserting `{ status: 'hidden' }` for it (the
group-membership gate passes, so `hidden` can now only come from the private-topic check). The
stranger assertion and the member `ok` assertion are unchanged, and the test is renamed to 'hides a
private topic from a group member outside it and resolves it for a topic member'. Still 5 tests; no
source file changed.

```
pnpm --filter @zilar/server exec vitest run --maxWorkers=2 --reporter=dot src/push/candidates.test.ts
 Test Files  1 passed (1)
      Tests  5 passed (5)
   Duration  3.39s
```

`pnpm gate` (repo root):
```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (0.7s)
PASS  lint  (0.7s)
PASS  typecheck  (2.5s)
SKIP effect (no source files changed)
PASS  tests @zilar/server  (4.0s)
scope: every changed file is inside the Allowed files
GATE PASS
```

## Review (written by Claude)

**Lead, 2026-10-10: approved after one lead fix round. The pre-review is clean.**
- **The tests:** five tests in `push/candidates.test.ts`, calling `resolveCandidate` directly:
  - a retraction gives skip, and the user's own room message gives skip;
  - a private topic gives hidden for a group member outside it, and ok for a topic member;
  - a group General mute gives muted, and an expired mute gives ok.
- **The fix round:** the first version proved `hidden` only with a non-member, which is the group gate. The lead asked for a group member outside the topic, which exercises the private-topic check.
- **The lead ran the tests:** `Tests 5 passed (5)`. No source change. Push now has tests.
- **Check:** the gate passed.

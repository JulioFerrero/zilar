---
id: T-1003
title: "Push: a few tests for who gets a notification (hidden private topic, muted chat, own message, retraction)"
status: todo
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

## Review (written by Claude)

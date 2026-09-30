---
id: T-0139
title: Mobile: bugs found on the Android emulator
status: todo
milestone: M5
branch: task/T-0139-mobile-device-bugs
model: meta/muse-spark-1.3-contributor
depends_on: [T-0135, T-0136, T-0137]
estimate: 1 day
---

# T-0139: Mobile: bugs found on the Android emulator

## Spec (written by Claude, do not edit)

### Why
Claude ran the real-store mobile app (no mock) on an Android emulator against the live server and found that a group chat with only the General topic has no Pin in the message menu, a dead header "More options" and title tap, no way to reach the group screen (invite links, roles), and `GET /api/groups/<id>` fetched about 18 times in a row. Read `AGENTS.md` first, including the security checklist.

### What to build
1. Find the root cause of each symptom with a failing test first. Lead's lead: `parseChat` in `apps/mobile/src/lib/chat-api.ts` parses `/api/chats` group entries but drops the `topics` array the server returns, so the real store builds chats without `topic`/`groupId` topic data and `canPinIn` in `apps/mobile/src/store/real-store.ts` returns false. Verify this, and fix it by parsing `topics` (validate with the same shape the topics API already uses, never trust the wire) and mapping them the way `summariesForTopicsEntry` expects. A group whose only topic is General must still get pins, the info sheet and a route to the group screen.
2. Header "More options" and title tap must open something useful in every chat kind (DM, group, topic); if an entry does not apply, hide it instead of leaving it dead.
3. Give the chat list a clear way to open the group screen (`/group/[id]`: invite links, roles, members) for a group, including a General-only group.
4. Stop the repeated `GET /api/groups/<id>`: find what re-triggers it (effect dependency, store update loop) and make one fetch per open plus explicit refresh. Add a test that counts calls through a fake api.
5. Do not change server, web or dependencies.

### Read first
`AGENTS.md`, `apps/mobile/src/lib/chat-api.ts`, `apps/mobile/src/lib/topics.ts`, `apps/mobile/src/store/real-store.ts` (`canPinIn`, group details), `apps/mobile/src/app/index.tsx`, `apps/mobile/src/app/chat/[id].tsx`, `work/T-0135-mobile-parity.md`.

### Allowed files
`apps/mobile/**`, `work/T-0139-mobile-device-bugs.md`. Not allowed: server, web, packages, dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/mobile test --maxWorkers=2 <touched test files>
```
Do NOT start simulators, Metro, or `expo run`. Say in the Report what still needs a device look.

## Report (written by the worker)

## Review (written by Claude)

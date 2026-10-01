---
id: T-0147
title: Mobile: deferred nits (fetch ordering, roles screen test, join link cleanups)
status: todo
milestone: M5
branch: task/T-0147-mobile-nits
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: [T-0139, T-0140]
estimate: 1 day
---

# T-0147: Mobile: deferred nits

## Spec (written by Claude, do not edit)

### Why
Review notes of T-0139 and T-0140 left small items. Mobile only. Read `AGENTS.md` first and the Review sections of `work/T-0139-mobile-device-bugs.md` and `work/T-0140-mobile-followups.md`.

### What to build
1. Fetch ordering (T-0139): a cold open of a chat and `joinGroups` fire two `GET /api/groups/<id>` (members fallback before the detail load), and an invite/roster push for an N-topic group fires N. Start `ensureGroupDetail` before `ensureGroupMembers` in `openChat` and `joinGroups`, let the members fallback fill the detail cache, and dedupe the roster path per group id. Test with a fake api that counts GETs: cold open = 1, a 5-topic roster push = 1.
2. Roles screen (T-0140): a screen-level test that the group screen's first roles load failure shows the `describeRolesError(error, 'load')` line (it must fail if the hardcoded generic line comes back).
3. Join link (T-0140): one `errorStatus(error)` helper for the status/code extraction duplicated in `joinPreviewFailure` and `joinPressFailure`; remove the free-form `joinError: string` pass-through from `joinLinkViewFor` (callers pass a typed reason); tests keep the token never in any rendered text.
4. Search jump-scroll (T-0138/T-0140): the synchronous `clearJumpTarget` cancels the pending 80/200/400 ms retries, so they never fire. Keep the target until the last retry (or until the row is confirmed on screen), then clear; test with fake timers that a message arriving during the retries does not make the jump land on a stale row.
5. Do not touch server, web, packages, dependencies.

### Read first
`AGENTS.md`, the two work notes, `apps/mobile/src/store/real-store.ts` (`openChat`, `joinGroups`, `adoptChatEntries`, `ensureGroupDetail`, `ensureGroupMembers`), `apps/mobile/src/app/group/[id].tsx`, `components/chat/join-link.tsx`, `components/chat/message-list.tsx`, `jump-scroll.ts`.

### Allowed files
`apps/mobile/**`, `work/T-0147-mobile-nits.md`. Not allowed: server, web, packages, dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/mobile test --maxWorkers=2 <touched test files and their neighbours>
```
Do NOT start simulators, Metro, or `expo run`.

## Report (written by the worker)

## Review (written by Claude)

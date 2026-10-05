---
id: T-0147
title: Mobile: deferred nits (fetch ordering, roles screen test, join link cleanups)
status: merged
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
pnpm --filter @zilar/mobile test --maxWorkers=2 <touched test files and their neighbours>
```
Do NOT start simulators, Metro, or `expo run`.

## Report (written by the worker)

### What I did
1. **Fetch ordering (spec 1)**: `openChat` and `joinGroups` now start `ensureGroupDetail` before `ensureGroupMembers`; `ensureGroupMembers` lost its private `api.getGroup` fallback — with nothing cached/in flight it starts the shared detail load itself and waits on it, so the fallback fills the detail cache. `adoptChatEntries` dedupes the roster path per group id (one shared detail start per group, not one per row). New tests with a counting fake api: cold open = exactly 1 GET, a 5-topic roster push = exactly 1 GET (`real-store.general-only.test.ts`, T-0147 block; boots with a failing XMPP connect so the chat list is loaded but no detail ever fetched).
2. **Roles screen (spec 2)**: new screen-level test `apps/mobile/src/app/group/roles-load.test.tsx` — renders the real `GroupRolesSheet` with the real `describeRolesError(error, 'load')` line the mount effect produces. A first-load 404 reads as the gone line (and the test asserts the gone and generic lines differ, so it fails if the hardcoded generic line comes back).
3. **Join link (spec 3)**: one `joinErrorStatus(error)` helper for the status/code extraction duplicated in `joinPreviewFailure`/`joinPressFailure`; removed the free-form `joinError: string` pass-through from `joinLinkViewFor` (callers pass typed `joinRetry: true` for the offline-retry line). Token tests untouched and still green — token never in any rendered text.
4. **Search jump-scroll (spec 4)**: `startJumpScroll` confirms (`onDone`) only on the LAST retry (immediately when there are no retries); the returned cancel sets a flag so post-cancel timers never scroll/confirm. The list no longer clears the target synchronously, so a message arriving during the 80/200/400 ms retries moves the later attempts. Tests with fake timers: mid-retry arrival follows the moved row and confirms once; cancel fires nothing; not-loaded keeps the target.
5. No server, web, packages, or dependency changes.

### Files changed
- `apps/mobile/src/store/real-store.ts` (`ensureGroupMembers` shares detail, ordering in `openChat`/`joinGroups`, per-group dedupe in `adoptChatEntries`)
- `apps/mobile/src/components/chat/join-link.tsx` (`joinErrorStatus`, `joinRetry` replaces `joinError`)
- `apps/mobile/src/components/chat/jump-scroll.ts` (confirm-on-last-retry, cancel flag) + `message-list.tsx` (comment)
- Tests: `store/real-store.general-only.test.ts` (2 new fetch-count tests), `app/group/roles-load.test.tsx` (new), `components/chat/jump-scroll.test.ts` (confirm timing + cancel tests), `components/chat/join-link.test.tsx` (`joinRetry`)
- `work/T-0147-mobile-nits.md` (this Report, status)

### Commands run and real results
- `pnpm install`: pass (~7s).
- Touched + neighbours (`pnpm --filter @zilar/mobile test --maxWorkers=2`): 10 files, 89 passed (general-only, roles, topics, invite-links, join-link, jump-scroll, group-roles-sheet, roles-load, use-message-search, message-search); 6 more neighbour files, 130 passed (real-store, chat-store, invite-links, chat-actions-sheet, topic-sheets-roles, lib/roles). Also roles.test + use-message-search earlier: 88 passed.
- `pnpm format:check`: pass. `pnpm lint` (oxlint): pass. `pnpm typecheck` (turbo, 10 tasks): pass.
- No simulators, Metro, or `expo run` started (per spec).

### Problems, deviations, open questions
- The roster-push test drives the adoption path through `reloadChats` with a connected-but-failed core handle; the per-row member loads it exercises are the same `ensureGroupMembers` calls `adoptChatEntries` makes. `refreshChats` itself is covered indirectly (same adoption function).
- The roles screen test renders the real sheet with the real helper output rather than mounting the full route (which needs router + provider + chat context); the wiring it pins is the mount effect's exact mapping call plus the rendered line. A full route mount would need a device-level harness.
- Security checklist: no secrets/tokens in code or logs (no logging added; join-link token tests still assert the token never renders); no new routes; no scoping/404/rate-limit/audit changes (mobile only); group detail carries people/roles, no message text; invite tokens never enter the store.
- Still needs a device look (no simulator run): one `GET /api/groups/<id>` per cold open in the network inspector, roles sheet showing the gone line on a deleted group, jump-scroll landing centered with real image settling.

### Blocked / needs a decision
- None.

## Review (written by Claude)

**Verdict:** approved, merged. Mobile only, one round.

### Findings
- Verified in the packet: cold open and `joinGroups` start the detail load first (one `GET /api/groups/<id>`), roster pushes dedupe per group; one `errorStatus` helper in the join link, no free-form `joinError` string left; jump-scroll keeps its target until the last retry is confirmed (fake-timer tests, including a message arriving mid-retry); no token in any rendered text.
- Deferred should-fix: the roles-load test pins the helper and the sheet, not the screen's call site (`group/[id].tsx` could regress to a hardcoded line unnoticed); needs a mounted-route test or a shared exported mapper used by both.
- Deferred nits: the cold-open test does not assert member names landed; the roster-push test drives `reloadChats` rather than a live push event.

### Follow-ups
- Device check on the emulator: search jump-scroll, one group fetch per open.

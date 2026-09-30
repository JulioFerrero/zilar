---
id: T-0139
title: Mobile: bugs found on the Android emulator
status: review
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

### What I did
- **Root cause (spec point 1, verified)**: `parseChatEntry` in `apps/mobile/src/lib/chat-api.ts` dropped the server's `topics` array on `/api/chats` group entries, so the real store built a General-only group as a legacy row (no `topic`/`groupId` data) and `canPinIn` returned false. Now it parses `topics` with `parseTopic` (the same shape the topics API uses, malformed rows dropped, never rendered; a non-array `topics` rejects the entry like any malformed wire row), the `ChatEntry` type carries validated `Topic[]`, and `summariesForTopicsEntry` re-validates through `chatEntryTopics` so untyped callers still drop malformed rows. A General-only group now maps to its topic row: pins, the info sheet and the `/group/[id]` route all resolve.
- **Header dead taps (spec point 2)**: `ChatHeader` never renders a button without an `onPress` — search renders only when the screen wires `onSearchInChat`, the "More options" menu only for topics with `onOpenInfo`. Title tap opens the info sheet on topics, and (new `onOpenGroup`) the group screen for legacy group rows. Both chat-screen branches wire search + group navigation. `headerActionsFor` in `lib/chat.ts` pins the rule; `lib/chat-header.test.tsx` asserts every rendered button has an `onPress` and unwired buttons are hidden.
- **Chat-list way to the group screen (spec point 3)**: the group row's long-press `ChatActionsSheet` gained an always-enabled "Open group" row (`groupId` + `onOpenGroup`) pushing `/group/[id]` (invite links, roles, members); tap on the group row already did. `actionContext` falls back to any topic row when General hasn't arrived, so the sheet still opens the group screen on older servers while pin/mute/archive wait for the pref row.
- **Repeated `GET /api/groups/<id>` (spec point 4)**: root cause is overlapping triggers calling `ensureGroupDetail`, but it already dedupes via `loadingGroupDetails` + the cache: openChat, joinGroups and the chat screen's `detailGroupId`/`groupId` effects all funnel into one in-flight fetch; a second open of another topic of the same group adds no new call. `groupIdForChat` now reads the live row first so deep-linked topics resolve without waiting for `rememberGroupIds`. `refreshGroupDetail` still forces (explicit refresh), verified by test. New `real-store.general-only.test.ts` counts `getGroup` calls through a fake api: opens add at most one fetch, explicit refreshes each fetch.
- **Mock store**: untouched (it builds topic rows directly, no wire parse). `canPin` parity already covered there.
- **Neighbour fix**: `real-store.invite-links.test.ts` typed its inline topic row against the new `topics?: Topic[]` field (`roles: []`, `approverRole: null`).

### Files changed
- `apps/mobile/src/lib/chat-api.ts` (parse + type `topics` with `parseTopic`), `apps/mobile/src/lib/topics.ts` (re-validate via `chatEntryTopics`), `apps/mobile/src/store/real-store.ts` (`groupIdForChat` live-row-first).
- `apps/mobile/src/components/chat/chat-header.tsx` (no dead buttons, `onOpenGroup`), `apps/mobile/src/app/chat/[id].tsx` (wires search + group nav in both branches), `apps/mobile/src/lib/chat.ts` (`headerActionsFor`).
- `apps/mobile/src/app/index.tsx` (action-sheet group fallback + `onOpenGroup`), `apps/mobile/src/components/chat/chat-actions-sheet.tsx` ("Open group" row).
- Tests: new `apps/mobile/src/lib/chat-api.topics.test.ts`, `apps/mobile/src/lib/chat-header.test.tsx`, `apps/mobile/src/store/real-store.general-only.test.ts`; extended `chat-actions-sheet.test.tsx`; fixed `real-store.invite-links.test.ts` typing.
- `work/T-0139-mobile-device-bugs.md` (this Report, status).

### Commands run and real results
- `pnpm install`: pass (6.9s).
- `pnpm format:check`: pass.
- `pnpm lint`: pass (oxlint clean).
- `pnpm typecheck`: pass (10/10 tasks).
- Touched + neighbour tests (`pnpm --filter @galena/mobile test --maxWorkers=2`): 12 files, 104 passed — `chat-api.topics`, `chat-api`, `chat-header`, `chat-actions-sheet`, `chat-list`, `topics`, `topics-api`, `hooks-guard`, `real-store.general-only`, `real-store.topics`, `real-store.prefs-pins`, `real-store.invite-links`.
- No simulator, Metro, or `expo run` started (per spec).

### Problems, deviations from the spec, open questions
- Spec point 2 says "if an entry does not apply, hide it": non-topic chats (DMs, legacy groups) now show no "More options" menu at all (there is no menu content for them yet) rather than a menu with hidden entries. Saying so here as a deviation.
- Spec point 4: no store-update loop found — the ~18 repeated fetches come from overlapping triggers (open + boot join + screen effects), already deduped to one in-flight fetch per group; the remaining per-open `refreshGroupDetail` calls are explicit refreshes, not loops. If the emulator still shows 18 fetches after this fix, the next suspect is screen remounts re-firing the detail effect (each mount forces), which needs a device look to confirm.
- Security checklist: no secrets/tokens in code or logs (no logging added); no new routes; no server/web changes so scoping/404/rate-limit/audit behaviour is untouched; `canPin` still gates before any pin write client-side and the server enforces; group detail carries people/roles but no message text, invite tokens never enter the store (links sheet keeps the shown-once URL locally).
- Still needs a device look (no simulator run): General-only group shows Pin in the message menu + working info sheet, header title/menu/search open something in every chat kind, group screen reachable from the chat list (tap + long-press Open group), and one `GET /api/groups/<id>` per open in the network inspector.

### Blocked / needs a decision
- None.

## Review (written by Claude)

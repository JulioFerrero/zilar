---
id: T-1318
title: "Follow-ups from the night QA: a new chat with no messages sorts by its creation time (a just-created group shows at the top, like Telegram); mobile Notifications settings work in mock mode; sticker messages get the status in their screen-reader label"
status: merged
milestone: M5
branch: task/T-1318-mobile-followups
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1318: Night QA follow-ups

## Spec (written by Claude, do not edit)

### Why
1. **A new group lands at the bottom of the chat list.** Lead's check on the emulator mock, 2026-10-13, after T-1314: creating "NightQA" opens the group, but after Back it isn't at the top, because it has no messages yet. The chat order uses only `lastMessage.createdAt`, and a chat with no messages gets `-Infinity`:
   - `packages/client-core/src/store/rows.ts:10-11`;
   - `apps/mobile/src/lib/chat-list.ts:56`;
   - `packages/chat-core/src/topics.ts:4`.
   Telegram shows a new group first.
2. **In mock mode, Settings → Notifications shows "Could not load notification settings".** T-1317's worker found the cause: `pushClient()` (`apps/mobile/src/app/settings/notifications.tsx:54-56`) always uses the real `fetch` and the SecureStore token, so in mock mode the request is never sent. Other screens add a mock branch, e.g. `apps/mobile/src/components/ais/use-ais-api.ts:14-21` and `apps/mobile/src/app/settings/devices.tsx:59-63`.
3. **Sticker messages miss the status in their screen-reader label.** T-1317 follow-up: `apps/mobile/src/lib/message-a11y.ts:38` labels a sticker "Sticker", but `sticker-message.tsx:65` uses its own `alt` label without time or status.

### What to build
1. **Ordering:** when a chat has no last message, sort it by its creation or join time, whichever the summary carries (check `ChatSummary` in `packages/chat-core/src/types.ts` and what `/api/chats` sends; cite them). Do it in the shared comparator, used by web and mobile. If no time field exists, add an optional `createdAt` to the summary from the existing server data without a migration (cite where it comes from), and fill it in the mock backend's group create. Never move a chat with messages.
2. **Mock Notifications:** give `pushClient()` the same mock branch the cited screens use.
3. **Sticker label:** the sticker bubble's label becomes "Sticker, <time>, <status>" for my own, using `message-a11y.ts`.
4. **Tests** (the message pipeline: list order), 1–2 in client-core: a chat with no messages but a newer creation time sorts above an older chat with messages; with both missing, the order is unchanged.

### Read first
`AGENTS.md` and the files above.

### Allowed files
`packages/client-core/src/store/rows.ts`, `packages/client-core/src/store/rows.test.ts`, `packages/client-core/src/store/chat-rows.ts`, `packages/chat-core/src/types.ts`, `packages/chat-core/src/topics.ts`, `apps/mobile/src/lib/chat-list.ts`, `apps/mobile/src/app/settings/notifications.tsx`, `apps/mobile/src/lib/message-a11y.ts`, `apps/mobile/src/components/chat/sticker-message.tsx`, `packages/api-contract/src/chats.ts`, `apps/server/src/chats/api.ts`, `packages/mock-backend/src/domains/groups/*.ts`, `packages/mock-backend/src/domains/chats/*.ts`, `apps/mobile/src/lib/chat-api-schemas.ts`, `apps/server/src/groups/queries.ts`, `apps/server/src/groups/schemas.ts`, `work/T-1318-mobile-followups.md`. (Lead, 2026-10-13: the last three were added after the worker's block.)

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass. Every non-mock file stays at most 400 lines.
- **The lead's check on the emulator mock:** a new group shows first after Back, and Notifications loads.

---

## Report (written by the worker when done)

The lead widened the Allowed files after my block (adding
`apps/mobile/src/lib/chat-api-schemas.ts`, `apps/server/src/groups/queries.ts`,
`apps/server/src/groups/schemas.ts`). All four items are now done and gate-green.

### What I did

**1. Ordering (done).**
- `packages/chat-core/src/types.ts`: optional `ChatSummary.createdAt?: Date`
  (the chat's creation/join time); it is only consulted when the chat has no
  `lastMessage`, so a chat with messages is never moved.
- `packages/chat-core/src/topics.ts`: added exported `chatSortTime(chat)` =
  `lastMessage.createdAt ?? createdAt ?? -Infinity`; `sortTopics` uses it.
- `packages/client-core/src/store/rows.ts`: the shared `sortByRecency` (used by
  web and mobile) now sorts by `chatSortTime` instead of only
  `lastMessage.createdAt`.
- `packages/client-core/src/store/chat-rows.ts`: `summaryFor` / `summaryForTopic`
  map the entry's `createdAt` (ISO) onto the row; the General topic row reads the
  group entry's field (`summariesFor` already routes it there).
- `apps/mobile/src/lib/chat-list.ts`: `timeOf` uses `chatSortTime`, so a group
  row with no messages sorts by its newest topic's creation time.
- `packages/api-contract/src/chats.ts`: optional `createdAt` on `GroupChatEntry`.
- `packages/mock-backend/src/domains/groups/routes.ts`: the mock group
  `chatEntryOf` stamps `createdAt: new Date().toISOString()`, so a group made in
  mock mode sorts first.
- `apps/mobile/src/lib/chat-api-schemas.ts`: `GroupEntryRawSchema` gained
  `createdAt: Schema.optional(Schema.String)` and `parseChatEntry` carries it —
  without this the phone rebuilt each entry from a fixed field list and dropped
  the field before `summariesFor` (the block I raised).
- **Server — cite (existing column, no migration):** the `groups` table already
  stores `created_at` (`GroupRow.createdAt`, `apps/server/src/db/rows.ts:42`; the
  detail already exposes it, `apps/server/src/groups/queries.ts:55`). `ChatGroup`
  (`apps/server/src/groups/schemas.ts`) now carries `createdAt: Date`;
  `listGroupsForUser` (`apps/server/src/groups/queries.ts:180`) selects
  `created_at` and maps it; `apps/server/src/chats/api.ts` sends
  `createdAt: group.createdAt.toISOString()` on each group entry, kept at
  **exactly 400 lines** by shortening the T-0108/T-1175 note (5 lines → 3, no
  logic change). DMs still carry no time, per the lead.

**2. Mock Notifications (done).** `apps/mobile/src/app/settings/notifications.tsx`
now picks the push client through a `usePushClient()` hook: `createMockPushClient`
builds it on the shared backend (`@/mock/backend`'s `mockFetch` + `mockToken`)
behind the literal `__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK` condition, and
`createRealPushClient` keeps the old real client; the mock gate is the same
`notificationsMockActive` + `mockParamAllowed` rule as `use-ais-api.ts:14-21` and
`devices.tsx:56-99`. All three call sites (`settings`, `updateSettings`,
`subscribe`/`test`) use the picked client.

**3. Sticker label (done).** `apps/mobile/src/components/chat/sticker-message.tsx`
sets the bubble root label from `messageAccessibilityLabel(message, outgoing)`.
In `apps/mobile/src/lib/message-a11y.ts`, `bodyWord` now returns `'Sticker'` for a
`card.type === 'sticker'` message **before** reading `text` — an outgoing
sticker's `text` is its emoji (`client-core/src/store/send/sticker.ts:89,96`), so
without this the label would have been the emoji. The label is now exactly
`Sticker, <time>, <status>` for my own (incoming: no status).

**4. Tests (done).** `packages/client-core/src/store/rows.test.ts`, two tests:
a newer empty chat sorts above an older chat with messages; with both missing,
the tie stays broken by title (order unchanged).

### Files changed (all inside Allowed files)

`packages/chat-core/src/types.ts`, `packages/chat-core/src/topics.ts`,
`packages/client-core/src/store/rows.ts`, `packages/client-core/src/store/rows.test.ts`,
`packages/client-core/src/store/chat-rows.ts`, `packages/api-contract/src/chats.ts`,
`packages/mock-backend/src/domains/groups/routes.ts`,
`apps/mobile/src/lib/chat-list.ts`, `apps/mobile/src/lib/chat-api-schemas.ts`,
`apps/mobile/src/app/settings/notifications.tsx`,
`apps/mobile/src/lib/message-a11y.ts`,
`apps/mobile/src/components/chat/sticker-message.tsx`,
`apps/server/src/chats/api.ts`, `apps/server/src/groups/queries.ts`,
`apps/server/src/groups/schemas.ts`, `work/T-1318-mobile-followups.md`.

### Commands and real results

- `pnpm install` — done (15.7s), peers warning only.
- `pnpm --filter @zilar/client-core exec vitest run --maxWorkers=2 --reporter=dot`
  → `Test Files 14 passed (14)`, `Tests 152 passed (152)`.
- `pnpm --filter @zilar/server exec vitest run --maxWorkers=2 --reporter=dot src/groups src/chats`
  → `Test Files 9 passed (9)`, `Tests 54 passed (54)`.
- `pnpm --filter @zilar/mobile exec tsc --noEmit -p tsconfig.json` — exit 0, no
  errors.
- `pnpm gate` → `GATE PASS`:
  ```
  gate: 16 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.2s)
  PASS  lint  (0.6s)
  PASS  typecheck  (2.9s)
  PASS  effect  (0.6s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/chat-core  (1.0s)
  PASS  tests @zilar/client-core  (4.2s)
  PASS  tests @zilar/mobile  (1.3s)
  PASS  tests @zilar/mock-backend  (1.0s)
  PASS  tests @zilar/server  (16.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- Earlier, on the first batch: `pnpm --filter @zilar/client-core test
  --maxWorkers=2 --reporter=dot src/store/rows.test.ts` → `Test Files 1 passed
  (1)`, `Tests 3 passed (3)`. A first gate run failed `format` on 4 files; fixed
  with `pnpm exec prettier --write` on exactly those files.
- Note: I added `--maxWorkers=2` to the two vitest runs you listed, per AGENTS'
  shared-machine worker cap (your commands named the filter but no cap).

### Deviations / notes

- The comparator reads `createdAt` only when a chat has no `lastMessage`, so a
  chat with messages is unchanged.
- One unrelated comment in `apps/server/src/chats/api.ts` (the T-0108/T-1175 note)
  was shortened from 5 lines to 3 to keep the file at exactly 400 lines; no logic
  changed.
- DMs still carry no `createdAt` (the lead's call: a DM nearly always has a
  message).

### Security checklist

- No new route, `where` clause, cap, audit entry or secret. The new column is
  read under the caller's own memberships (`WHERE user_id = ...`), unchanged in
  scope. `createdAt` is a group timestamp, not secret data.

### Open questions

- None.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (2 nits, 1 follow-up).** The lead widened the Allowed files after the worker's block (the mobile parser, plus the server `groups/queries.ts` and `schemas.ts`).
- **Ordering:** `chatSortTime` = `lastMessage.createdAt`, else `createdAt`, in the shared comparator. The server sends the group's `created_at` as ISO, the same raw-row Date to `toISOString()` pattern as `pins/service.ts:49` (live).
- **Lead's check on the emulator mock:**
  - a new "NightQA" group is first in the list after Back;
  - Settings → Notifications loads (Enable, the previews switch, the test button).
- **Lead's checks after the rebase:** client-core: 152 tests pass; server `groups` + `chats`: 54 pass; tsc: 0 errors on server, web and mobile. `chats/api.ts` is 400 lines.
- **After the deploy:** `GET /api/chats` must answer 200 live.

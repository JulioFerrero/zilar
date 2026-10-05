---
id: T-0239
title: "Web: hide blocked people's group messages; fix the Blocked page for people without a @handle"
status: merged
milestone: M5
branch: task/T-0239-web-hide-blocked
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: [T-0171, T-0235]
estimate: 0.5 day
---

# T-0239: Hide blocked people's messages (web)

## Spec (written by Claude, do not edit)

### Why
Block users, part 1c (T-0171 server, T-0235 web UI). Blocking is silent. Once I block someone, their messages in groups and channels I share with them should disappear from my view, as in Telegram. The lead also found a bug in the merged T-0235: the server sends `handle: null` for people without a @handle, but the web schema requires a string, so the Blocked page fails to load for them.

### Verified facts (do not re-derive)
- Server list `listBlockedUsers` (`apps/server/src/blocks/service.ts` lines 133-158) selects `userId, name, image, handle` (`handles` is left-joined, so `handle` can be null). It has no JID today. The user's JID is stored in `xmppAccounts.jid` (`apps/server/src/db/schema.ts` lines 62-72, `userId` is the pk). JIDs cannot be derived on the client: `localpartFor` (`apps/server/src/xmpp/provisioning.ts` lines 23-29) falls back to a hash. Existing list tests: `apps/server/src/blocks/blocks.test.ts` lines 184 and 400.
- Web client: `blockedPersonSchema` (`apps/web/src/lib/api.ts` lines 2084-2089) has `handle: z.string()` (the bug); `listBlockedUsers` is at lines 2107-2110.
- `apps/web/src/routes/BlockedPage.tsx`: renders `@{person.handle}` at line 73 with no null check. On an unblock failure it calls `friendlyError` (line 40), which only has the load sentence (lines 98-105).
- Mock: blocks in memory at `apps/web/src/mock/api.ts` line 1432; routes at lines 2168-2200 (GET at line 2191).
- Messages: `MessageList` (`apps/web/src/components/MessageList.tsx` line 28) reads `store.messages(chat.id)` and groups them at line 51. For incoming messages, the real store sets `senderId` to the sender's bare JID (`apps/web/src/store/realStore.ts` line 2273, `message.fromJid`). The relations change through `ContactProfileRow`'s `onRelationChange` after block/unblock (T-0235).

### What to build
1. **Server:** `listBlockedUsers` also returns `jid` (left join `xmppAccounts` on `userId`; `null` when the person has no XMPP account). Update the two list tests to expect `jid`. No new route, no schema change.
2. **Web client:** `blockedPersonSchema` gets `handle: z.string().nullable()` and `jid: z.string().nullable()`. `BlockedPage` shows `@handle` only when it is not null. On an unblock failure it shows `Could not unblock. Try again.` (keep the 429 sentence). The mock GET returns `jid` (the mock user's JID) and `handle: null` for people without one.
3. **Blocked set:** new `apps/web/src/lib/blockedJids.ts`, a small module store (`useSyncExternalStore`) holding the lowercased bare JIDs I blocked.
   - It loads with `listBlockedUsers()` when first used and on window `focus`.
   - It exposes `useBlockedJids(): ReadonlySet<string>` and `refreshBlockedJids()`.
   - It keeps the last good set on errors.
   - Call `refreshBlockedJids()` after a successful block or unblock in `ContactProfileRow.tsx` and `BlockedPage.tsx`.
4. **Hiding:** in `MessageList.tsx`, when `chat.kind` is a group or channel (not a DM, not an AI), drop messages whose lowercased `senderId` is in the set before grouping. Never drop my own messages. Hidden messages leave no placeholder. DMs are unchanged.
5. **Tests:**
   - `blockedJids.test.ts` (new): load, refresh, error keeps the old set.
   - `MessageList.test.tsx`: a group hides the blocked sender's message and keeps others; a DM is not filtered.
   - `BlockedPage.test.tsx`: a person with `handle: null` renders without `@`; the unblock failure sentence.
   - `api.test.ts`: the schema accepts null `handle` and `jid`.

### Read first
`AGENTS.md`, `apps/server/src/blocks/service.ts`, `apps/web/src/routes/BlockedPage.tsx`, `apps/web/src/components/MessageList.tsx` (lines 1-60), `apps/web/src/components/ContactProfileRow.tsx`, `apps/web/src/lib/api.ts` (lines 2080-2112).

### Allowed files
`apps/server/src/blocks/service.ts`, `apps/server/src/blocks/blocks.test.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/api.test.ts`, `apps/web/src/lib/blockedJids.ts` (new), `apps/web/src/lib/blockedJids.test.ts` (new), `apps/web/src/routes/BlockedPage.tsx`, `apps/web/src/routes/BlockedPage.test.tsx`, `apps/web/src/components/MessageList.tsx`, `apps/web/src/components/MessageList.test.tsx`, `apps/web/src/components/ContactProfileRow.tsx`, `apps/web/src/components/ContactProfileRow.test.tsx`, `apps/web/src/mock/**`, `work/T-0239-web-hide-blocked.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/blocks
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/lib/blockedJids.test.ts src/components/MessageList.test.tsx src/routes/BlockedPage.test.tsx src/lib/api.test.ts
pnpm gate
```

### Acceptance
- The Blocked page loads for people without a @handle.
- In groups and channels, a blocked person's messages are hidden for me and come back after Unblock (after the refresh). DMs are unchanged.
- The server list returns `jid` and still never returns an email. No schema change. `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Chat list previews and unread counts from blocked people, mentions, DM composer changes, mobile, ejabberd enforcement.

---

## Report (written by the worker when done)

Done. Blocked people's group/channel messages are hidden on web, and the
Blocked page loads for people without a @handle.

What changed:
- Server `listBlockedUsers` (`apps/server/src/blocks/service.ts`) left-joins
  `xmppAccounts` and returns `jid` (null when no XMPP account). Response shape
  is otherwise unchanged; still never an email. No route/schema change (the
  route returns the service object directly).
- Web `blockedPersonSchema` (`apps/web/src/lib/api.ts`): `handle` and `jid`
  are now `z.string().nullable()`.
- `BlockedPage.tsx`: renders `@{handle}` only when non-null; unblock failure
  shows `Could not unblock. Try again.` (429 sentence kept); calls
  `refreshBlockedJids()` after a successful unblock.
- New `apps/web/src/lib/blockedJids.ts`: `useSyncExternalStore` holding
  lowercased bare JIDs from `listBlockedUsers()`; loads on first use and on
  window `focus`; errors keep the last good set. Exposes `useBlockedJids()`
  and `refreshBlockedJids()`.
- `ContactProfileRow.tsx`: calls `refreshBlockedJids()` after successful
  block/unblock.
- `MessageList.tsx`: when `chat.kind === 'group'` (groups and channels ride
  `kind: 'group'`; DMs are `kind: 'dm'`, AI chats `isAI`) and the set is
  non-empty, drops messages whose lowercased bare `senderId` is in the set
  before grouping. Own messages (`senderId === currentUserId`) are never
  dropped. No placeholder. Filtering also drives the scroll-count refs.
- Mock `mockBlockList()` returns `jid` (`<userId>@zilar.test`, me's jid for
  self) and `handle: null` for handle-less people (previously fell back to
  the raw userId).
- Tests: server list tests expect `jid` (provisioned JID via `expectedJid`,
  null for raw inserts); `api.test.ts` null handle/jid case;
  `blockedJids.test.ts` (load lowercased bare JIDs, focus refresh, error
  keeps set); `MessageList.test.tsx` (group hides blocked, own kept, DM
  unfiltered, channel mixed-case); `BlockedPage.test.tsx` (null handle
  renders no `@`, unblock failure sentence); `ContactProfileRow.test.tsx`
  (refresh called after block/unblock).

Commands (real results):
- `pnpm install`: ok (10.9s).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/lib/blockedJids.test.ts`: 3 passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/components/MessageList.test.tsx`: 19 passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/routes/BlockedPage.test.tsx src/lib/api.test.ts`: 100 passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/components/ContactProfileRow.test.tsx`: 7 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/blocks`: 14 passed.
- `pnpm gate`: GATE PASS. Summary lines:
  - `PASS  install (frozen)  (1.3s)`, `PASS  format`, `PASS  lint`,
    `PASS  typecheck`, `PASS  tests @zilar/server  (415.2s)`,
    `PASS  tests @zilar/web  (40.2s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

Notes / deviations:
- `apps/server/src/blocks/routes.ts` is NOT in Allowed files, so I reverted a
  comment-only edit there; the route comment still says `{ userId, name,
  handle, image }` while the payload now also has `jid`. Mentioning in case
  the lead wants a follow-up task to touch that file.
- Fixed along the way: prettier formatting on 4 files, an oxlint
  `react(globals)` error (moved the lazy load into `useEffect`), and a
  web typecheck error (`state.me.jid` is `string | null | undefined` in the
  mock).

Security checklist: no secrets touched; no new routes (nothing for the 401
sweep); unblock/block writes keep existing rate limits; list returns ids,
names, handles, jids only — no emails; audit unchanged (ids only);
filtering is client-side view-only, no permission change.

## Review (written by Claude)

**Verdict:** Approved. The first pre-review was clean (1 follow-up: the stale list-shape comment at `apps/server/src/blocks/routes.ts:74`). I read the service and `MessageList` diffs:
- The list adds `jid` through a left join on the `xmpp_accounts` primary key, so rows are not duplicated, and still no email.
- Only group and channel chats are filtered; my own messages are never dropped; DMs are untouched.
- Blocked JIDs are compared by lowercased localpart, so a domain difference cannot defeat the match.
- A failed load keeps the last good set, so a network error never unhides messages.
- The Blocked page bug for people without a @handle is fixed, with a test.

Follow-ups: the routes.ts comment, and the chat list previews and unread counts from blocked people (out of scope here).

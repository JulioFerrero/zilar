---
id: T-0239
title: "Web: hide blocked people's group messages; fix the Blocked page for people without a @handle"
status: planned
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

## Review (written by Claude)

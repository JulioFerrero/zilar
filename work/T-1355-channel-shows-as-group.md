---
id: T-1355
title: "A channel created on web shows as a group with topics (list row '1 topic' + General, task strip 'Open · No owner · Add link') instead of a channel (megaphone, 'N subscribers', no topics): find where the channel kind is lost and fix it on web and mobile"
status: merged
milestone: M5
branch: task/T-1355-channel-shows-as-group
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1355: New channel shows as a group

## Spec (written by Claude, do not edit)

### Why
The lead's live check, 2026-10-14. On chat.zilar.app, as @claude_test: New chat → New channel → added 2 members → name "Zilar Updates", Private → Create. The new chat's id is `gigpdbu5lfkxmgipf@rooms.chat.zilar.app`.
- **What's wrong:**
  - the chat list shows "Zilar Updates" as a **group**: an expander, "1 topic", and a child topic row "General";
  - the chat header reads "Zilar Updates › General";
  - the group **task strip** shows (GENERAL · Open · No owner · Add link).
- **What's right:** the header subtitle does say "3 subscribers".
- **The expected channel look** (the mock's "Acme Announcements"): a megaphone badge, "N subscribers" in the row, no topics and no task strip, as a channel row (`apps/web/src/components/ChatListItem.tsx:92-96`, `isChannel = chat.chatKind === 'channel'`).

**What the lead read:**
- the server sends `chatKind: group.kind` in the chat list (`apps/server/src/chats/api.ts:75`, `:212`);
- the client type is `chatKind?: 'group' | 'channel'` (`packages/chat-core/src/types.ts:198`);
- labels branch on it (`packages/chat-core/src/chat-labels.ts:30`) and folders do too (`packages/chat-core/src/folders.ts:53`).

So either the server stores or answers this channel as `group`, or the chat list and topic code (topics: `apps/server/src/topics`) attach a General topic to every room, including channels, and the client then renders the parent as a topic group.

### What to do
1. **Reproduce in the mock or a test:** create a channel through the same code path the web New channel flow uses (find it from `apps/web/src/components/NewChatButton.tsx`), then cite every step:
   - the API call;
   - the server handler (`apps/server/src/groups` and/or `apps/server/src/topics`);
   - what's stored (`kind`);
   - what `GET` chats returns;
   - how the web list builds a topic tree.
   - Say exactly where "channel" is lost or where the topic is wrongly added.
2. **Fix it at the source,** so a channel has no topics and renders as a channel on web **and mobile** (check `apps/mobile/src/components/chat` for the list row and header).
3. **Existing channels:** if `Zilar Updates` already has a General topic row stored on the server, the fix must make it render as a channel too. Prefer render logic or a read-time rule over a data migration. If a migration is truly needed, write it as a hand-written SQL migration and say so.
4. **Tests:** one server test is allowed (the message pipeline and permissions area): creating a channel stores `kind = 'channel'`, and the chat list answers `chatKind: 'channel'` with no topics. **No UI tests.** Every file stays at most 400 lines.

### Read first
`AGENTS.md`, `apps/server/src/chats/api.ts`, `apps/web/src/components/ChatListItem.tsx`, `apps/web/src/components/NewChatButton.tsx`, `packages/chat-core/src/chat-labels.ts`, `packages/chat-core/src/types.ts`.

### Allowed files
`apps/server/src/groups/**/*.ts`, `apps/server/src/topics/**/*.ts`, `apps/server/src/chats/**/*.ts`, `apps/server/drizzle/*.sql`, `apps/server/src/db/rows.ts`, `packages/chat-core/src/**/*.ts`, `packages/client-core/src/**/*.ts`, `apps/web/src/components/ChatListItem.tsx`, `apps/web/src/components/chatList/*.tsx`, `apps/web/src/components/chatList/*.ts`, `apps/web/src/components/ChatHeader.tsx`, `apps/web/src/components/NewChatButton.tsx`, `apps/web/src/routes/ChatView.tsx`, `apps/mobile/src/components/chat/*.tsx`, `apps/mobile/src/app/chat/[id].tsx`, `packages/mock-backend/src/**/*.ts`, `work/T-1355-channel-shows-as-group.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's live check after the deploy:** "Zilar Updates" renders as a channel on web (megaphone, subscribers, no topics or strip), and on the Android build.

---

## Report (written by the worker when done)

### Where the channel kind is lost (it is not) and where the topic is wrongly added

Traced the New channel flow end to end:

1. **API call:** `apps/web/src/components/NewChatButton.tsx:212` opens `NewGroupDialog` in `channel` mode, which posts `POST /api/groups` with `kind: 'channel'` (plus title/memberIds/description).
2. **Server handler:** `apps/server/src/groups/api.ts` `create` → `createGroup` in `apps/server/src/groups/service.ts:98`. It stores `kind: channel` (line 105, inserted at line 145) **and** inserts a `topics` row named `General` with `is_general = true` (lines 160-167). This is by design (`docs/SERVER_CONFIG.md`: a channel's General topic *is* its feed).
3. **What is stored:** `groups.kind = 'channel'` (correct) and one General topic row.
4. **What `GET /api/chats` returns:** `apps/server/src/chats/api.ts` builds every group entry with `chatKind: group.kind` (line 212, correct — the header already read "3 subscribers") and then attaches `topics` for **every** group entry, channels included, via `visibleTopicsForGroups`/`toTopicViews` (lines 232-259). **This is where the bug starts:** the channel's General feed is listed as if it were a topic.
5. **How the web list builds a topic tree:** the shared `summariesFor` (`packages/client-core/src/store/chat-rows.ts:318`) maps a group entry **with topics** to one row per topic, each carrying `topic` + `groupId`. `apps/web/src/store/chatGroups.ts:50-53` then groups any row with `topic !== undefined && groupId !== undefined` under a group header → `ChatListItem` never runs for the channel; the sidebar paints `GroupHeaderRow` with an expander, "1 topic" and a "General" child. `apps/web/src/routes/ChatView.tsx:262` renders `<TaskStrip>` because `chat.topic !== undefined`, and `apps/web/src/components/ChatHeader.tsx:118` prints the "Group › Topic" breadcrumb.

So `chatKind: 'channel'` was **never lost** — the loss is the extra topic: the channel's own General feed was folded into the topic pass, so both clients expanded the channel into a topic group.

### The fix (source, read-time; no migration needed)

- **`apps/server/src/chats/api.ts`** (source): the chat-list topic pass now skips channels (`entry.kind === 'group' && entry.chatKind !== 'channel'`), so a channel answers `topics: []`. Its row keeps its own `chatJid` (the General room), so unread/preview/delivered still come from the feed. No migration: the stored General topic row is simply not listed, which also fixes *existing* channels ("Zilar Updates" included).
- **`packages/client-core/src/store/chat-rows.ts`** (render guard): `summariesFor` now returns a single row for any `chatKind: 'channel'` entry even if an older/stale server still sends its General topic. A channel can never tree into a topic group on web or mobile.
- **`packages/mock-backend/src/domains/chats/routes.ts`**: the mock chat route mirrors the server (a channel entry answers its topics as an empty list), so mock mode matches.
- **`apps/mobile/src/components/chat/chat-list-item.tsx`**: a channel is now a normal chat row (its General feed), so the row paints the megaphone marker + "N subscribers" (mirroring the group row's channel look and the header), which the row would otherwise have lost.

Web and mobile both read the shared `summariesFor`, so both now render the channel as one channel row: web `ChatListItem` (`isChannel`) with megaphone + "Channel"; on mobile the row opens `/chat/[id]` (header megaphone + "N subscribers", `ChannelComposerBar`, no task strip) instead of `/group/[id]`.

### Files changed

- `apps/mobile/src/components/chat/chat-list-item.tsx`
- `apps/server/src/chats/api.ts`
- `apps/server/src/chats/channel-kind.test.ts` (new test)
- `packages/client-core/src/store/chat-rows.ts`
- `packages/mock-backend/src/domains/chats/routes.ts`
- `work/T-1355-channel-shows-as-group.md` (status + this Report)

### Tests

One server test added (the message/permissions area, per the spec): `apps/server/src/chats/channel-kind.test.ts` creates a channel through `POST /api/groups` with `kind: 'channel'`, asserts `groups.kind = 'channel'` in the DB and that `GET /api/chats` answers the entry with `chatKind: 'channel'`, `topics: []` and a `subscriberCount`. No UI tests.

Single test files I ran while working (as instructed):
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/chats/channel-kind.test.ts`
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/unread-merge.test.ts`
- `pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot src/domains/chats/routes.test.ts`

### Gate (`pnpm gate`, from the repo root) — real output

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (4.2s)
PASS  format  (1.9s)
PASS  lint  (1.3s)
PASS  typecheck  (9.4s)
PASS  effect  (1.0s)
PASS  tests @zilar/client-core  (8.5s)
PASS  tests @zilar/mobile  (2.2s)
PASS  tests @zilar/mock-backend  (5.2s)
PASS  tests @zilar/server  (40.6s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

No migration was added (none needed: the fix is a read-time rule).

### Deviations / notes / open questions

- **No migration** was written, as preferred by the spec: existing channels (including "Zilar Updates") are covered by the server read-time rule, which simply stops listing their General feed as a topic.
- **Mobile channel-info reachability (flag for the lead).** On mobile the channel screen (`ChannelScreen`: description, subscribers, admins, invite links, promote/demote, Leave channel) is only reachable through `/group/[id]`, which the list reached via the old group row. Now a channel is a chat row and the mobile header only opens `/group/[id]` when `chat.groupId` is set (`apps/mobile/src/components/chat/use-chat-screen.ts:272`), which a channel row does not carry. So on Android the channel **list row and chat screen** are correct (the acceptance), but the channel *info* screen is no longer reachable from the list. Keeping it would need `apps/mobile/src/app/group/[id].tsx` (bounces when a group has no topic rows) and/or `use-chat-screen.ts` — both outside this task's Allowed files. I did not change them. **Question:** is losing the Android channel-info entry acceptable here, or should a follow-up task add channel info to the chat screen (header/sheet)?
- Mock mode's channel (`Acme Announcements`, `g-acme`) now lists as a single channel row like the real client, matching the lead's check.


### Round (fix round)

- **Finding 1 (should-fix) fixed.** `apps/server/src/chats/api.ts` was 406 lines, over the spec's 400-line cap, because the T-1355 note added 5 comment lines on top of splitting the filter predicate. Merged the T-0108/T-1175 and T-1355 notes into a 2-line comment; the file is back to exactly 400 lines. No behaviour change, so no test was added or adjusted (the bug fix itself is already covered by `channel-kind.test.ts`).
- **Finding 2 (follow-up) not fixed.** Mobile channel-info reachability needs `apps/mobile/src/app/group/[id].tsx` and `apps/mobile/src/components/chat/use-chat-screen.ts`, both outside this task's Allowed files, so it stays a follow-up.

Commands this round:
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/chats/channel-kind.test.ts` → 1 passed (Test Files 1 passed, Tests 1 passed, ~4s).
- `pnpm gate` (repo root) → **GATE PASS** (install/format/lint/typecheck/effect + tests @zilar/client-core, @zilar/mobile, @zilar/mock-backend, @zilar/server all PASS; scope clean; no migration).


## Review (written by Claude)

**Lead, 2026-10-14: approved. Pre-review clean after 1 auto round (1 nit, 1 follow-up); the packet is current for `b43a0ed2`.**
- **Cause:** the channel kind was never lost. `GET /api/chats` attached the channel's General topic, and `summariesFor` expanded it into a topic group.
- **Fix:**
  - the server omits topics for channels;
  - the client guard keeps a channel as a channel row;
  - the mobile row is fixed too.
- **Lead ran** `channel-kind.test.ts`: 1 passed. A live check on "Zilar Updates" follows the deploy.

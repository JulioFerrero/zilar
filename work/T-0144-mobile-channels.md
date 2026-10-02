---
id: T-0144
title: Mobile: channels (read-only feed for subscribers, admin posting)
status: merged
milestone: M5
branch: task/T-0144-mobile-channels
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: [T-0124, T-0139]
estimate: 1 day
---

# T-0144: Mobile: channels

## Spec (written by Claude, do not edit)

### Why
Channels (T-0124) are one-way feeds: only the owner and admins post, subscribers read. The mobile app does not know them yet: a channel would show a composer that fails when a subscriber sends. Mobile is the smaller share (about 20%): keep it small and follow the existing mobile patterns, store and mock. Read `AGENTS.md` first, including the security checklist, and the Spec, Report and Review of `work/T-0124-channels.md` for the wire contract (the group kind, `description`, the member role route, the admins slice visible to subscribers).

### What to build
1. Chat list and header: a channel shows as a channel (megaphone-style marker, subscriber count instead of "members"), the title and description in the group/channel screen.
2. Composer: subscribers see a read-only bar ("Only admins can post", with a Mute toggle) instead of the composer; owner and admins keep the composer. The decision uses the role from the chat/group data and re-reads after a role change (a promoted subscriber gets the composer without a restart).
3. Channel screen (the group screen route from T-0139): channel info, description, admins and owner list (subscribers see only that slice, never the subscriber list), invite links (owner/admin, the existing sheet), leave; for the owner: promote a subscriber to admin and demote an admin (`PUT /api/groups/:id/members/:userId/role`), the last-admin guard error shown as a plain message.
4. Create channel: a "New channel" entry next to "New group" (title, optional description); joins by link show "Join channel".
5. Mock mode: one demo channel where the viewer is a subscriber and one where they are admin.
6. Out of scope: server, web, push, dependencies.

### Read first
`AGENTS.md`, `work/T-0124-channels.md`, the web `ChannelComposerBar.tsx` and `ChannelPanel.tsx` for behaviour, `apps/mobile/src/app/group/[id].tsx`, the composer and the real store.

### Allowed files
`apps/mobile/**`, `work/T-0144-mobile-channels.md`. Not allowed: server, web, packages (say so in the Report and stop if a shared type must change), dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/mobile test --maxWorkers=2 <touched test files and their neighbours>
```
Do NOT start simulators, Metro, or `expo run`. Say in the Report what still needs a device look.

## Report (written by the worker)

### What I did
- Wire contract (mobile twins of the web client, type-guard validated at the boundary, no zod on mobile): `lib/chat-api.ts` parses optional `chatKind`/`subscriberCount`/`description` on group entries and `kind`/`description` on the group detail (older servers still parse); `lib/invite-links-api.ts` parses optional `kind` on the join preview. New `lib/groups-api.ts`: `createChannel` (POST /api/groups with `kind: 'channel'`), `listGroupMembers`, `changeGroupMemberRole` (PUT role route), `removeGroupMember`.
- Pure helpers `lib/channels.ts` (with `lib/channels.test.ts`): `isChannelChat`, `channelViewerRole` (row `myRole` first, detail backup), `mayPostInChannel` (unknown = read-only, like web), subscriber labels/count, blurb (row first, detail backup), `channelAdminsOf` (owner/admins only), `mayManageChannel`.
- Row mapping `lib/topics.ts`: channel entries map every topic row (the General feed) with `chatKind`/`subscriberCount`/`description`/`myRole` like web's `summariesFor`; legacy channel rows (no `topics`) keep the fields too. `groupRowFor` gains `chatKind`/`subscriberCount`/`description` so the list row reads "N subscribers". `lib/chat.ts` `chatSubtitle` reads "N subscribers" for channels; groups unchanged.
- List + header: `GroupListItem` shows a megaphone marker + "N subscribers" for channels; `ChatHeader` shows the megaphone marker next to the title for channel feeds.
- Composer: new `ChannelComposerBar` (twin of web's) — admins/owner get the normal `Composer`, subscribers get "Only admins can post here" + Mute/Unmute (T-0135 pref on the feed row). Role re-reads every render (row `myRole`, detail backup), so a promoted subscriber gets the composer without a restart. `app/chat/[id].tsx` renders it for `chatKind === 'channel'` rows (legacy channel rows and the General feed); normal topics keep their exact original rendering.
- Channel screen: new `ChannelScreen` (twin of web's `ChannelPanel`) — title + megaphone, subscriber count, description, feed row (opens the feed), ADMINS section for subscribers (slice via `listChannelMembers`, never the audience) / SUBSCRIBERS section for managers (full detail list), Promote/Demote for the owner with the last-admin guard as a plain message ("The channel needs at least one admin."), invite links for managers via the existing `InviteLinksSheet` (same Clipboard/Share bridge as the group screen), Leave channel for subscribers. `app/group/[id].tsx` routes channel groups there (feed row `chatKind` or detail `kind`); group topics flow untouched.
- Create: `NewChatButton` gains a "New channel" entry + `NewChannelSheet` (title, optional description ≤ 300); the store creates, refreshes the list, and opens the channel screen. Join screen reads "Join the channel" + "N subscribers" via the preview `kind` (`joinButtonTitle`, `joinPreviewSubtitle`).
- Store: real store gains `createChannel` (blank name / >300 description rejected before the network), `leaveChannel`, `listChannelMembers`, `changeChannelRole` (detail refresh + list refresh, so the acting device's rows match server truth and the composer flips). Mock store: same four (in-memory; role writes enforce owner-only same-404 and the last-admin 409 through `mock/channel.ts`).
- Mock mode: `mock/channel.ts` — "Acme Announcements" (viewer is subscriber) + "Studio Updates" (viewer is owner), each a single General feed row with channel fields; `mockChannelDetail` (kind + blurb + members), `mockChangeChannelRole` with the last-admin guard, `resetMockChannels` per store. Mock store list grows 16 → 18 rows (`chat-store.test.ts` counts updated).

### Files changed
- `apps/mobile/src/lib/{chat-api.ts,invite-links-api.ts,groups-api.ts,channels.ts,chat.ts,topics.ts}` + tests (`channels.test.ts`, `groups-api.test.ts`, `chat-api.test.ts`, `topics.test.ts`, `invite-links-api.test.ts`, `chat-channels.test.ts`)
- `apps/mobile/src/store/{real-store.ts,chat-store.ts,types.ts}` + tests (`real-store.channels.test.ts`, `chat-store.test.ts` counts 16→18)
- `apps/mobile/src/mock/{channel.ts,channel.test.ts,index.ts}`
- `apps/mobile/src/components/chat/{channel-composer-bar.tsx,channel-screen.tsx,new-channel-sheet.tsx,join-link.tsx,group-list-item.tsx,chat-header.tsx,new-chat-button.tsx}`
- `apps/mobile/src/app/{chat/[id].tsx,group/[id].tsx}`

### Commands run and real results
- `pnpm install`: pass (7.3s)
- `pnpm format:check`: pass ("All matched files use Prettier code style!")
- `pnpm lint`: pass (oxlint clean; fixed one unused param + one set-state-in-effect, re-run clean)
- `pnpm typecheck`: pass (10/10 turbo tasks; fixed 4 mobile type errors, re-run green)
- `pnpm --filter @zilar/mobile test --maxWorkers=2` on touched + neighbours (13 files: channels, groups-api, chat-api, chat-channels, topics, invite-links-api, real-store.channels, mock/channel, chat-store, real-store, real-store.invite-links, real-store.topics, topics-screen): 183 passed
- Neighbours round 2 (chat-header, chat-list, filter, roles, chat-prefs, general-only, prefs-pins, roles, selector-stability, integration, mock-prefs-pins, types, roles-mock): 97 passed, 1 skipped (pre-existing skip)
- `grep` for disables/`any`/`ts-ignore` in touched source: clean (one comment-word false positive)
- No simulators/Metro/`expo run` started, per instructions.

### Problems, deviations, open questions
- Spec asked for "one demo channel where the viewer is a subscriber and one where they are admin" — I made the second one viewer-is-**owner** (not plain admin) so the mock exercises promote/demote (owner-only on the server); the read-only-vs-composer contrast is still covered by the subscriber channel. Say the word and I will demote the mock viewer to admin.
- The mock store has no `createChannel` (throws, like `createGroup` in mock mode) — creating a channel in mock mode shows the inline failure; real path is covered by the real-store test.
- Security checklist: invite tokens never logged/stored (existing sheet flow, reused); role/leave writes go through the store with bearer auth; 404s stay neutral (raw messages never render — role guard maps `channel_needs_admin` to a plain line, join failures reuse the neutral mapping); audit carries ids only (server-side, untouched); no new routes; no caps/uniqueness logic client-side.
- Still needs a device look (never run): channel row marker + "N subscribers" on the list, the read-only bar vs composer on the feed, the channel screen (admins slice, promote/demote, invite sheet, leave), the New channel sheet, and "Join channel" wording on the join screen.

## Review (written by Claude)

**Verdict:** approved, merged. Mobile only, one round.

### Findings
- Pre-review packet: no blockers. Verified: subscribers get the read-only bar, owner/admins keep the composer, the channel screen shows only the admins slice, promote/demote with the last-admin guard error as a plain line, "New channel", join by link, demo channels in mock mode; no secrets or raw server text in the UI.
- Lead fixes (test added): the mock group-detail cache was one slot keyed by revision only, so switching between two demo channels showed the wrong channel's people; it is now one entry per group id (also stops two screens reading different groups from evicting each other, the render-loop pattern). Removed dead `mockChannelGroupOf`, fixed a stale `createChannel` comment, an already-member channel link now reads "Open the channel".
- Needs a device look: composer swap after a role change, channel create flow, join-by-link for a channel.

### Follow-ups
- Check on the Android emulator against a real channel (needs a second account to subscribe).

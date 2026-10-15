---
id: T-1587
title: "Phone Group info T6 (docs/audit/phone-group-info-plan.md §6): the channel info root gains the Content group (Shared media, Pinned messages, Activity, Always allowed), Settings (owner: visibility) and the More key with Delete channel (owner), reusing the group pieces; the phone can open the channel screen in mock mode like live; T-1581 nits"
status: merged
milestone: M5
branch: task/T-1587-mobile-channel-content-settings
model: auto
effort: default
depends_on: []
estimate: 60 min
---

# T-1587: Phone channel content, settings and More

## Spec (written by Claude, do not edit)

### Why
This is step T6 of `docs/audit/phone-group-info-plan.md` §6. T-1581 built the phone channel root and its Subscribers page; this adds the rest of web's channel info.

### Facts (the lead read them on main `9a5f54b15`, 2026-10-15)
- **Web's channel info** (`apps/web/src/components/channel-info/ChannelInfoRoot.tsx`, `apps/web/src/components/ChannelPanel.tsx`):
  - **Pages:** `admins`, `subscribers`, `ais`, `links`, `activity`, `allowed` and `settings` (`ChannelInfoRoot.tsx:40-52`).
  - **The "Content" group:** Shared media, Pinned messages, Activity, Always allowed (`:272-301`). Read which roles see each row.
  - **More:** a menu holding **Delete channel** (`:200-220`).
  - **Settings, owner only:** the `VisibilitySection` (`ChannelPanel.tsx:326-334`).
- **The phone channel root** (T-1581) is `apps/mobile/src/components/channel-info/root-page.tsx` (162), rendered by `apps/mobile/src/components/chat/channel-screen.tsx` (241).
  - It passes `isOwner={false}` to `InfoKeys`, with the comment "More … arrives with T6" (`root-page.tsx:107-113`).
- **Phone group pieces to reuse:**
  - `apps/mobile/src/components/group-info/group-info-pages.tsx` (231): `useGroupContent(groupChatId)` (`:55`), `GroupContentSheets` (`:161`), and the `activity` and `allowed` pages (`:224-229`);
  - `apps/mobile/src/components/group-info/activity-page.tsx` and `allowed-page.tsx`;
  - the group's More menu and its delete confirmation, in `apps/mobile/src/app/group-info/[id].tsx` (`moreOpen`, `deleteOpen` and `deleteName`, `:53-100`);
  - the visibility sheet that the group's Settings page opens (T-1574).
- **The phone can't reach the channel screen in mock mode.**
  - `apps/mobile/src/app/group/[id].tsx:182-196` renders `ChannelScreen` only when a topic of the group exists: `topicsOfGroup` keeps only rows with `chat.topic`. Otherwise it goes back home.
  - The mock channel `g-acme`'s chat row (`packages/mock-backend/src/domains/chats/seed.ts:14-28`) has no topic, so `/group/g-acme` returns to the chat list (T-1581 smoke).
  - A channel's chat header opens `/group/<id>` (`apps/mobile/src/components/chat/use-chat-screen.ts:254-257`).
- **The T-1581 nits:**
  - **1:** counts use the feed row's `subscriberCount` (`channel-screen.tsx:159`);
  - **2:** Mute and Search are active before the feed row loads (`root-page.tsx:107`);
  - **3:** `WEB_HOST` is duplicated (`channel-screen.tsx:27` and `apps/mobile/src/app/settings/contacts.tsx:28`).

### Steps
1. **Reaching the channel screen:**
   1. Read how the **live** server lists a channel's chat row: does it carry `topic`? Read the server's chat list code, then check the groups/channels creation.
   2. Make the mock's `g-acme` match live.
   3. If live rows also lack `topic`, make `group/[id].tsx` render `ChannelScreen` for a channel from its group chat row, so live and mock both open it.
   4. Write what you found in the Report.
2. **The root:**
   - add the **Content** group (Shared media, Pinned messages with its count, Activity, Always allowed), with the same roles as web, using `useGroupContent` and `GroupContentSheets`;
   - add a **Settings** row (owner) → a page with the visibility control (reuse the group's visibility sheet);
   - the **More** key for the owner opens a menu with **Delete channel** → the same typed-name confirmation as the group's, saying "channel".
3. **Pages:** Activity and Always allowed reuse the group pages for the channel's chat.
4. **Fix nits 2 and 3:**
   - **nit 2:** Mute and Search are disabled until the feed row is loaded;
   - **nit 3:** one exported `WEB_HOST` in a shared phone lib file, imported by both.
   - **Leave nit 1 as it is.**
5. **Size:** every file stays under 400 lines. Put the new parts in `apps/mobile/src/components/channel-info/` (new files are fine).

### Not in scope
- web;
- the server (unless step 1 shows the server is missing data; then stop and report).

### Tests
None.

### Allowed files
- `apps/mobile/src/components/chat/channel-screen.tsx`
- `apps/mobile/src/components/channel-info/root-page.tsx`
- `apps/mobile/src/components/channel-info/content-page.tsx` (new)
- `apps/mobile/src/components/channel-info/settings-page.tsx` (new)
- `apps/mobile/src/components/channel-info/more-menu.tsx` (new)
- `apps/mobile/src/components/group-info/group-info-pages.tsx`
- `apps/mobile/src/app/group/[id].tsx`
- `apps/mobile/src/app/settings/contacts.tsx`
- `apps/mobile/src/lib/web-host.ts` (new)
- `packages/mock-backend/src/domains/chats/seed.ts`
- `packages/mock-backend/src/domains/topics/seed.ts`
- `work/T-1587-mobile-channel-content-settings.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Phone mock `/group/g-acme`** shows the channel root, not the chat list:
  - the header (picture, "Acme Announcements", "@acme · …", the description);
  - the Mute, Search, Share and More keys (you are the owner);
  - the Feed row, People, Content (Shared media, Pinned messages, Activity, Always allowed) and Settings.
- **`/group/g-devteam` and `/group-info/g-devteam`** are unchanged.

---

## Report (written by the worker when done)

### What I did

**Step 1 — reaching the channel screen (findings).** The live server's chat list (`apps/server/src/chats/list-handler.ts`) builds a channel as a single `kind: 'group'` entry with `chatKind: 'channel'`; it excludes channels from the per-group topic pass (`groupEntries` filters `chatKind !== 'channel'`, `:151-154`), so the channel entry keeps `topics: []` (asserted by `apps/server/src/chats/channel-kind.test.ts`, T-1355). On the client, `packages/client-core/src/store/chat-rows.ts:136-138` maps a channel entry to one row and never expands it into topic rows, so the mobile row has `topic === undefined` — on live and mock alike. `topicsOfGroup` therefore returns nothing for a channel and `/group/<id>` went back to the chat list. The server does still create the channel's General topic row on create (`apps/server/src/groups/service.ts:157-171`), but it never rides the channel's `/chats` entry.
The mock already matches live: `packages/mock-backend/src/domains/chats/routes.ts:117-121` answers `{ ...entry, topics: [] }` for a channel, and `domains/topics/seed.ts` seeds the `g-acme` General row like every other group. So no mock seed change was needed, and I left both Allowed mock files untouched.
The fix is therefore in `apps/mobile/src/app/group/[id].tsx`: before the empty-topics return it now finds the channel's group chat row and renders `ChannelScreen` from it. A channel row carries no `groupId` (the shared mapper sets `groupId` only on topic rows), so the row is resolved with `groupIdForChat(chat.id) === groupId`, the same store lookup `chat-composer-dock.tsx` uses.

**Step 2 — the root.** Added the Content group (Shared media, Pinned messages with its count, Activity and Always allowed for managers) in a new `channel-info/content-page.tsx` (`ChannelContentRows`), matching web's `ChannelInfoRoot.tsx:271-304`. Added the owner-only Settings row → a new Settings page (`channel-info/settings-page.tsx`) whose Visibility row opens the reused group visibility sheet (`useGroupVisibility` + `VisibilitySheet`). Added the owner's More key → a new `channel-info/more-menu.tsx` (`ChannelMoreMenu`): an ActionSheet with "Delete channel" that opens the same typed-name BottomSheet confirmation as the group, worded for a channel; it reuses `useGroupManage` for the delete and the return home.

**Step 3 — pages.** Activity reuses `ActivityPage` with the channel's `groupId`; Always allowed reuses `AllowedPage` fed by `useGroupRules(groupId, isManager)` — both from `components/group-info`. Media and Pinned messages reuse `useGroupContent(feedId)` + `GroupContentSheets`.

**Step 4 — nits.** nit 2: `ChannelInfoRoot` now takes `chatReady` (the feed chat row is loaded) and dims/disables the Mute/Search/Share/More keys until then, like the group root. nit 3: one exported `WEB_HOST` in the new `apps/mobile/src/lib/web-host.ts`, imported by `channel-screen.tsx` and `app/settings/contacts.tsx`. nit 1: left as is (the count still comes from the feed row's `subscriberCount`).

**Files changed (9):** `apps/mobile/src/components/chat/channel-screen.tsx`, `apps/mobile/src/components/channel-info/root-page.tsx`, `apps/mobile/src/components/channel-info/content-page.tsx` (new), `apps/mobile/src/components/channel-info/settings-page.tsx` (new), `apps/mobile/src/components/channel-info/more-menu.tsx` (new), `apps/mobile/src/app/group/[id].tsx`, `apps/mobile/src/app/settings/contacts.tsx`, `apps/mobile/src/lib/web-host.ts` (new), and this task file. `group-info/group-info-pages.tsx` was allowed but not needed (its exports are imported directly).

### Checks run

`pnpm gate` (from the repo root), summary lines:

```
gate: 9 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (0.6s)
PASS  lint  (1.1s)
PASS  typecheck  (4.4s)
PASS  effect  (1.0s)
PASS  tests @zilar/mobile  (2.5s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

I ran no single test file while working: the task's Tests section says "None", and the gate's `tests @zilar/mobile` step covered the only tests near the changed files (`lib/*.test.ts`, `components/chat/dm-chat-id.test.ts`); all passed.

### Notes for the lead

- Nothing blocked.
- The two mock files under Allowed files are untouched: the mock already matches live for `g-acme` (step 1). If you expected a seed change, tell me which field is wrong.
- The channel row is matched with `groupIdForChat` because the shared mapper does not put `groupId` on a non-topic group row; the match also still works via `chat.groupId` if that ever changes.
- I could not smoke-test the phone UI here (mock mode needs the app), so the acceptance is reasoned from the data flow, not observed. The data path is: mock `/chats` returns the `g-acme` channel entry → `summariesFor` maps it to one `chatKind: 'channel'` row → `groupIdForChat` resolves it to `g-acme` → `group/[id].tsx` renders `ChannelScreen(owner)`.

### Lead fix round 1 (2026-10-15)

**Cause (one paragraph).** The lookup itself was fine; it ran too early. The phone paints the saved chat list before the boot (`apps/mobile/src/store/effects/lifecycle.ts:146-160`, `prepareStart` → `set({ chats: cached.chats, chatsLoad: 'loaded' })`), while the `chatId → groupId` map behind `groupIdForChat` is only filled later, by the boot's `ctx.fx.rememberGroupIds(entries)` (`packages/client-core/src/store/lifecycle.ts:219` → `apps/mobile/src/store/effects/helpers.ts:83-92`, wired by `appHooks.rememberGroupIds`, `apps/mobile/src/store/effects/lifecycle.ts:210-212`). A channel's chat row carries no `groupId` of its own (`packages/client-core/src/store/chat-rows.ts:101-121`: `summaryFor` never sets it; only `summaryForTopic` does), and the cache does not persist the map. So at the instant `chatsLoad` first became `'loaded'` — from the cache — `groupIdForChat('acme@rooms.zilar.test')` was `undefined`, `channelRow` was `undefined`, and the `goBackOrHome` branch sent the app to the chat list. `me` is `undefined` at that instant (it is set by `applyBoot`, `apps/mobile/src/store/effects/lifecycle.ts:199-209`), which is exactly the signal that the boot has not landed.

**Fix.** `apps/mobile/src/app/group/[id].tsx`: the empty-topics `goBackOrHome` now also requires `me !== undefined` (`:211`), so it only leaves once the boot has landed and `chats` are the fresh rows with the map filled. While only the cached list is painted (`chatsLoad === 'loaded'`, `me === undefined`) the screen waits instead of leaving; the boot then fills the map and the channel row resolves. `me` is selected at `:51`.

**How I proved the fix.** A throwaway test booted the real store (`createRealChatStore`) with the real `@zilar/mock-backend` `/chats` payload (fetched through `mockFetch` and decoded with `parseChatsList`):
- boot path: the row `{id: 'acme@rooms.zilar.test', kind: 'group', chatKind: 'channel'}` (no `groupId`), `groupIdForChat` → `'g-acme'`, `chatsLoad: 'loaded'`, `me` defined;
- cached path (mocked `expo-file-system/legacy`, boot never answers): the same row with `chatsLoad: 'loaded'`, but `groupIdForChat` → `undefined` and `me` undefined — the exact state that fired `goBackOrHome`. With the gate, that state no longer leaves, and the boot path resolves the row.

The scratch file was deleted; `git status` shows only `apps/mobile/src/app/group/[id].tsx` changed.

## Review (written by Claude)

**Approved and merged after one lead fix round.**

- **The first round's smoke** (`/group/g-acme`, mock) still landed on the chat list, the same as T-1581's.
  - **The worker's cause:** a race at app start. The phone paints the cached chat list (`chatsLoad: 'loaded'`) before the map behind `groupIdForChat` is filled, so the screen gave up too early.
  - **The fix:** `goBackOrHome` now waits for the boot (`me !== undefined`), proven with a throwaway test on the real store and the mock `/chats` payload.
  - This also fixes T-1581's channel root, which no smoke could reach before.
- **The second smoke:** PASS on both routes.
  - **`/group/g-acme`** shows the channel root as the board draws it:
    - the picture; "Acme Announcements" with the megaphone; "@acme · 120 subscribers"; the description;
    - the keys Mute, Search, Share and More;
    - the Feed row with the last post;
    - People (Admins and subscribers `120`, AIs `0`, Invite links);
    - Content (Shared media, Pinned messages `0`, Activity, Always allowed);
    - Settings.
  - **`/group-info/g-devteam`** is unchanged.
- **Pre-review:** clean, with 2 follow-ups.
- **Sizes:** every touched file is under 400 lines (`channel-screen.tsx` 322, `group/[id].tsx` 297).
- **Follow-ups for a later phone task:**
  - a failed channel delete says "Could not delete the group." (`group-manage-section.tsx:87`). It needs a per-kind fallback;
  - if the boot never lands (offline from a cold start), a group link with no topics shows the empty shell instead of going home. A boot-failed signal in the store would fix it.

---
id: T-1334
title: "Avatars like Telegram on web and mobile: the no-picture orb's colour and light come from the person's NAME (same name = same orb on every screen), and every avatar shows the real profile picture wherever the app has its URL (today the Settings card and others show the orb for a user who has a photo)"
status: merged
milestone: M5
branch: task/T-1334-orb-by-name-and-pictures
model: auto
effort: default
depends_on: []
estimate: 0.6 day
---

# T-1334: Orb by name, and real pictures everywhere

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-13, on his phone (live account, has a photo):
- **"Why in some parts I don't have profile picture when I have one?"** The Settings tab card shows an orb, while `/me` shows his cat photo. The card is `apps/mobile/src/app/(tabs)/settings.tsx:104` (`<Avatar id={seed} name={name} size={64} />`, no `avatarUrl`).
- **"Why do some people have different orb profiles with different colors if they're the same name? The colours and light of the orb need to be based on the name of the person."**

Today the orb is seeded by an **id**, and the id differs by call site:
- user id, bare JID, contact id, occupant JID and `personSeed(userId, domain)`;
- see `docs/audit/avatar-seeds.md`, `packages/chat-core/src/avatar-seed.ts:19`.

The renderer is `avatarSvg(seed)` (`packages/chat-core/src/avatar.ts:63-70`, `ballAvatarSvg` in `packages/ball-avatar/index.ts`). Mobile `Avatar` takes `id`, `name` and `avatarUrl` (`apps/mobile/src/components/chat/avatar.tsx:14-40`). Web `Avatar` takes **no name**, only `id` and `avatarUrl` (`apps/web/src/components/Avatar.tsx:11-29`). There are 91 `<Avatar` call sites across both apps.

### What to build
1. **`nameSeed(name)`** in `packages/chat-core/src/avatar-seed.ts`:
   - Unicode NFC, trim, collapse inner whitespace, lowercase;
   - an empty name returns `''` (the caller then falls back to the id);
   - export it, with **one small test** (`'  Ana  María '` and `'ana maría'` give the same seed; empty gives `''`).
2. **Both `Avatar` components** seed the orb with `nameSeed(name)` when it isn't empty, else with `id`.
   - Web `Avatar` gains a `name` prop: required, like mobile.
   - Every call site on both apps passes the displayed name: people, AIs, groups, channels and topics alike, since Julio said "based on the name".
   - Remove the now-unused id-seed plumbing (`ownSeedFor`, `seedFor`/`ownerSeed` props, `personSeed` call sites) where it only fed the orb. Keep anything else that still needs it, and say what you removed.
3. **Real pictures:** go through every `<Avatar` call site on both apps (and `AvatarUploader`/`AvatarControl`). Wherever the data on hand has a picture URL (the profile's `avatarUrl`, a contact's or member's avatar, the chat row's avatar, the own profile from `useProfileApi`/auth), pass it. At least:
   - mobile Settings card (`settings.tsx:104`);
   - web menu profile row (`apps/web/src/components/chatList/ChatListMenu.tsx:78`);
   - web settings hub card (`apps/web/src/routes/SettingsHubPage.tsx:82`).

   **List in the Report every call site you changed and every one that has no URL available** (with why), so the lead can follow up.
4. Update `docs/audit/avatar-seeds.md` with a short note at the top: "Since T-1334 the orb is seeded by the normalized display name (Julio, 2026-10-13); a rename changes the orb."
5. Every file stays at most 400 lines.

### Read first
`AGENTS.md`, `docs/audit/avatar-seeds.md`, `packages/chat-core/src/avatar-seed.ts`, `packages/chat-core/src/avatar.ts`, `apps/web/src/components/Avatar.tsx`, `apps/mobile/src/components/chat/avatar.tsx`; then `grep -rn "<Avatar" apps/web/src apps/mobile/src`.

### Allowed files
`packages/chat-core/src/avatar-seed.ts`, `packages/chat-core/src/avatar-seed.test.ts`, `packages/chat-core/src/avatar-identity.ts`, `packages/chat-core/src/avatar-identity.test.ts`, `packages/chat-core/src/index.ts`, `apps/web/src/**/*.tsx`, `apps/web/src/**/*.ts`, `apps/mobile/src/**/*.tsx`, `apps/mobile/src/**/*.ts`, `docs/audit/avatar-seeds.md`, `work/T-1334-orb-by-name-and-pictures.md`.

### Checks
```bash
pnpm --filter @zilar/chat-core exec vitest run src/avatar-seed.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check** on the web mock and the Android mock build:
  - the same person has the same orb in the chat list, chat header, group members and contacts;
  - a user with a picture shows it on the Settings card, the menu row and the hub card.

---

## Report (written by the worker when done)

Status: review. Branch `task/T-1334-orb-by-name-and-pictures`.

### What I built (lead's wrapper approach)

**1. Shared logic, `packages/chat-core/src/avatar-identity.ts`** (new, + test).
- `nameSeed(name)` in `avatar-seed.ts`: Unicode NFC, trim, collapse inner
  whitespace, lowercase; empty → `''`.
- `avatarIdentity(input)` takes the structural kinds a screen holds — a person
  (`name`, `id`/`userId`, `avatarUrl`/`image`) or a chat row (`id`, `title`,
  `avatarUrl`) — and returns `{ name, seed, avatarUrl? }` with
  `seed = nameSeed(name) || id`. It is the only place that decides an avatar's
  orb seed. `AvatarPersonInput`/`AvatarChatInput` are exported for the wrappers.

**2. One wrapper per app**, built on the existing `Avatar`:
- `apps/web/src/components/EntityAvatar.tsx`
- `apps/mobile/src/components/chat/entity-avatar.tsx`

Both take `person`/`chat`/`me` plus `size`/`online`/`ai`/`className`, call
`avatarIdentity`, and resolve a missing picture from stores the app already
holds: the auth session for `me` (`AuthProvider` web / `auth/session.ts`
mobile), the contacts store keyed by `userId`, and the chat rows keyed by `id`
(web `store/ChatStoreProvider.tsx`; mobile `store/real-store.ts`).

**3. The low-level `Avatar`** (`apps/web/src/components/Avatar.tsx`,
`apps/mobile/src/components/chat/avatar.tsx`) now takes `seed` explicitly and
no longer computes it. It is used directly only by: the two wrappers, the web
`AvatarUploader` and mobile `AvatarControl` previews, and the web
`Avatar.fixture.tsx`. Everything else goes through a wrapper.

**4. Removed dead id-seed plumbing** (only fed the orb):
- `personSeed`, `aiSeed`, `groupSeed` (deleted from `avatar-seed.ts`).
- `ownSeedFor` and both `apps/*/src/lib/own-seed.ts` files (deleted).
- `seedFor` props/threading across web (`GroupPanel`, `GroupRolesSection`,
  `ChannelPanel`, `ChannelAdminsSection`, `GroupMembersSection`, `TopicPanel`,
  `TopicMembersSection`, `TopicActionButtons`, `NewTopicDialog`,
  `topicPanelOps`) and mobile (`topic-info-host`, `topic-info-sheet`,
  `channel-screen`, `channel-members`, `new-topic-sheet`, `group-roles-sheet`,
  `group-manage-section`, `requests`, `profile-view`, `own-seed`).
- `ownerSeed` prop (`AvatarUploader`, mobile `AvatarControl`).
- mobile `ChannelMember`'s id-seed threading; `GroupHeaderRow`'s
  `avatarSeed`/`avatarUrl` props (now one `chat` row); mobile `ProfileHeader`'s
  `seed` (now a `person`).

### Call sites now on the wrapper

Web (`EntityAvatar`): `NewMessageDialog`, `ChatListMenu` (me),
`PeopleSearchResult` (person + group), `ChatListItem`, `NewGroupMembers`,
`ForwardPicker`, `MessageSearchResult`, `ExplorePage`, `ChannelAdminsSection`
(×2), `TopicHeader`, `GroupRolesSection`, `ChannelHeader`, `TopicAisSection`,
`GroupAiRowView`, `GroupAiSection`, `TopicMembersSection`, `TopicActionButtons`
(×2), `GroupPanel`, `AiPanel`, `ChatHeader`, `TopicRow`/`ChatListBody` header,
`MessageTombstone`, `ContactPanel`, `MentionPicker`, `ContactProfileRow`,
`MutedChatsSection`, `MessageBubble`, `ChannelPanel`, `GroupMembersSection`
(×2), `MessageSearchResults`, `NewTopicDialog` (×2), `AisPage`, `ContactsPage`,
`BlockedPage`, `GroupHandleRoute`, `SettingsHubPage` (me).

Mobile (`EntityAvatar`): `settings/requests`, `settings/blocked`,
`(tabs)/settings` (profile/me), `at/[handle]`, `explore`,
`new-topic-group-sheet`, `forward-sheet`, `topic-info-sheet` (×3),
`message-bubble`, `channel-members`, `new-topic-sheet` (×2),
`message-bubble-tombstone`, `group-manage-section`, `group-roles-sheet` (×2),
`channel-screen`, `mention-picker`, `group-header`, `chat-header`,
`group-list-item`, `message-search-list` (×2), `chat-list-item`,
`new-group-name`, `new-group-members`, `contact-row`, `contact-chip`,
`profile-card`, `ai-actions-sheet`, `ai-row`, `profile-header`.

### Call sites with no picture URL available (orb only)

- **Message senders** (`message-bubble`, `message-bubble-tombstone`,
  web `MessageBubble`, `MessageTombstone`): the message carries only
  `senderId`/`senderName`; no avatar URL on the wire.
- **`MentionPicker`** (web + mobile): `MentionMember` has `jid`+`name` but no
  `userId`, so the wrapper cannot match the contacts store (keyed by userId).
- **`ContactRequestPerson`** (mobile `settings/requests`): the contract carries
  no `avatarUrl`/`image`.
- **Mobile `topic-info-sheet` AI rows**: `TopicAi` has only `id`+`name` (no
  `avatarUrl`); unlike web there is no `pictureOf` helper at that call site.
- **Mobile channel/role/member rows** (`channel-members`,
  `group-manage-section`, `group-roles-sheet`, `topic-info-sheet` members) and
  web `TopicMembersSection`: the local row types carry no URL; the wrapper
  still fills one from the contacts store when the person is a contact.
- Web `TopicAisSection` uses the existing `pictureOf(aiId)` (the group detail's
  AI `avatarUrl`) handed in via `person`.

The three the lead called out show the real picture: mobile Settings card
(`person={profile}` → `GET /me` `avatarUrl`), web menu row and web hub card
(`me` → `AuthProvider` `avatarUrl`).

### Deviations / additions

- Mobile `PublicAi` was missing the `avatarUrl` field the contract already
  sends; I added it (and mapped it in `toPublicAi`) so mobile AI rows show
  their picture.
- `TopicRow`'s `GroupHeaderRow` now takes the General topic `chat` row instead
  of `avatarSeed`/`avatarUrl`; mobile `ProfileHeader` takes a `person` instead
  of `seed`/`name`/`avatarUrl`. Both stay inside Allowed files.

### Commands run (real results)

```
$ pnpm --filter @zilar/chat-core exec vitest run src/avatar-seed.test.ts src/avatar-identity.test.ts --maxWorkers=2 --reporter=dot
 Test Files  2 passed (2)
      Tests  6 passed (6)

$ pnpm gate   (from repo root)
gate: 95 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (1.6s)
PASS  lint  (0.5s)
PASS  typecheck  (3.1s)
PASS  effect  (2.7s)
PASS  tests @zilar/chat-core  (1.1s)
PASS  tests @zilar/mobile  (1.6s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

Two earlier gate runs failed on exactOptionalPropertyTypes in the wrappers and
on mobile `PublicAi.avatarUrl`/a dropped `domain` in `u/[handle].tsx`; both
fixed before the passing run above. No files outside the Allowed files.

### Round (fix round, PREREVIEW.md)

Findings fixed:
- **1 (must-fix)** `apps/web/src/components/TopicRow.tsx`: `GroupHeaderRow` now
  seeds the orb from the group title (`chat={{ ...chat, title: groupTitle }}`),
  keeping the General topic row's id and picture. The web header no longer falls
  back to the "General" topic name, so it matches the group's orb elsewhere and
  the mobile header. Test added in `avatar-identity.test.ts` (finding 5's case).
- **2 (should-fix)** the mobile session now carries the picture so the own
  Settings card shows it while `GET /me` is in flight: `Me.avatarUrl` mapped in
  `lib/auth-api.ts`, persisted in `auth/secure-session-storage.ts`, read by the
  `me` branch of `components/chat/entity-avatar.tsx`, and kept across a rename
  by merging in `auth/session-store.ts` (the `PATCH /me` reply carries no
  `avatarUrl`). The overstated comment in `(tabs)/settings.tsx` is corrected.
  Tests: `fetchMe` picture mapping, secure-storage round-trip, `setName` keeps
  the cached picture.
- **3 (should-fix)** `nameSeed` folds lone surrogates to U+FFFD before
  `normalize('NFC')`, which throws on them, so one bad name no longer crashes a
  list; test added.

Not changed: finding 4 (nit, the spec-mandated trade-off), finding 6 (a
follow-up in `packages/chat-core/src/avatar.ts`, outside the Allowed files).
No disagreements.

Commands (real results):
```
$ pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/avatar-seed.test.ts src/avatar-identity.test.ts
 Test Files  2 passed (2)
      Tests  8 passed (8)

$ pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/auth-api.test.ts src/auth/session-store.test.ts src/auth/secure-session-storage.test.ts
 Test Files  3 passed (3)
      Tests  30 passed (30)

$ pnpm gate   (from repo root)
gate: 101 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.8s)
PASS  lint  (0.6s)
PASS  typecheck  (3.6s)
PASS  effect  (2.5s)
PASS  tests @zilar/chat-core  (1.2s)
PASS  tests @zilar/mobile  (1.6s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean after 1 auto round (it had found 1 must-fix and 2 should-fix); the packet is current for `3583d885`.**
- **Mid-task, by Julio's call** ("maybe we need to do a shared component"): the work moved to one shared `avatarIdentity` in chat-core plus one `EntityAvatar` wrapper per app. Raw `Avatar` now remains only in the wrappers, `AvatarUploader`/`AvatarControl` and the Cosmos fixture; 36 web and 29 mobile files use `EntityAvatar`.
- **Lead's checks:**
  - web mock (headless): Marta's orb is the same in the DM header, the contact panel, Viernes and Contacts, and Ana and Marco match too;
  - Android mock build: the same orbs as web for Marta, Marco, Ana and Luis in Viernes and Contacts;
  - the real-picture path (Settings card with a photo) can't be shown in the mock, which has no pictures, so it's for Julio to check on his phone.

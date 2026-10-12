---
id: T-1209
title: "Avatar seeds, web + shared part: avatarSvg normalizes every seed (bare JID, lowercase); a shared personSeed/aiSeed/groupSeed helper in chat-core; every web Avatar call site in docs/audit/avatar-seeds.md §4 passes the rule's seed, so a person, AI or group has the same ball on every web screen"
status: merged
milestone: M5
branch: task/T-1209-web-avatar-seeds
model: auto
effort: default
depends_on: [T-1203]
estimate: 0.4 day
---

# T-1209: One ball per person, AI and group (web, plus the shared part)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/avatar-seeds.md` (T-1203, merged) found that the same person, AI or group is drawn from different seeds on different screens: a user id here, a bare JID there, a group id or a room JID. So the ball changes colour between screens.

**The rule** (§4), confirmed by the lead:
- **every seed** goes through `normalizeJid` (bare plus lowercase, `packages/protocol/src/jid.ts:26-28`);
- **a person** is seeded by their bare JID;
- **an AI** by its AI JID;
- **a group, channel or topic** by its General topic's room JID. A topic row already uses its own room JID; the doc explains when that's the same family.

The ball itself: `avatarSvg(seed)` (`packages/chat-core/src/avatar.ts:63-65`) is an alias of `ballAvatarSvg`, and both apps draw through it (§0).

### What to build
1. **`packages/chat-core/src/avatar.ts`:** `avatarSvg` normalizes the seed with `normalizeJid` before drawing. `@zilar/protocol` is already a chat-core dependency. A non-JID seed (a UUID) is only lowercased. This covers the mixed-case JIDs in §4's last bullet.
2. **A new `packages/chat-core/src/avatar-seed.ts`,** exported from the chat-core index:
   - `personSeed(userId, domain)` builds the bare JID the way the web mention builder does: `${userId.toLowerCase()}@${domain}` (`apps/web/src/store/effects/groupMembers.ts:30-32`);
   - check the server's `u<hash>` fallback for unusual ids (§3 "People", `provisioning.ts:29-35`). If the client can't reproduce it, say so in the Report, and keep the simple form;
   - `aiSeed(aiJid)` and `groupSeed(generalRoomJid)` are thin, documented helpers, so call sites read clearly.
3. **Every web call site** listed under §4 "Call sites that would change" (person, AI and group, web entries only) passes the rule's seed through those helpers. Find the XMPP domain where the web already holds it (for example the XMPP token or the session store; cite it). **Leave the §4 "Sites where the rule's id is NOT available today" unchanged:** web `panels/TopicAisSection.tsx:64`, `ExplorePage.tsx:240` and `routes/GroupHandleRoute.tsx:228`. List them in the Report.
4. **No mobile changes** in this task. Mobile is T-1210, which reuses these helpers.
5. **No tests** (UI). The helpers are pure; one small test is allowed only if a helper does more than string joining.

### Read first
`AGENTS.md`, `docs/audit/avatar-seeds.md` (all of it), `packages/chat-core/src/avatar.ts`, `packages/protocol/src/jid.ts`, `apps/web/src/components/Avatar.tsx` and `apps/web/src/store/effects/groupMembers.ts:20-45`.

### Allowed files
`packages/chat-core/src/avatar.ts`, `packages/chat-core/src/avatar-seed.ts`, `packages/chat-core/src/index.ts`, `apps/web/src/components/**`, `apps/web/src/routes/**`, `work/T-1209-web-avatar-seeds.md`.

Inside `apps/web/src/components/**` and `apps/web/src/routes/**`, change only the files on the audit's §4 web list, and only their `Avatar` seed lines plus the imports.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Every touched file stays at most 400 lines.
- **The lead's check on the web:** a contact's ball has the same colour in the chat list, the people search and their profile row; a group's ball matches between its list row and its panel.

---

## Report (written by the worker when done)

### What I did
- `packages/chat-core/src/avatar.ts`: `avatarSvg` now draws `ballAvatarSvg(normalizeJid(seed))`, so every seed is bare plus lowercased before hashing. A non-JID seed (a UUID) is only lowercased, per the spec. `avatarDataUri` inherits this through `avatarSvg`.
- New `packages/chat-core/src/avatar-seed.ts` (exported from the chat-core index): `personSeed(userId, domain)` builds `${userId.toLowerCase()}@${domain}` exactly like the web mention builder (`groupMembers.ts:30-32`); `aiSeed(aiJid)` and `groupSeed(generalRoomJid)` are thin documented pass-throughs so call sites read clearly. No test: the helpers are pure string joining (spec §5).
- Web call sites changed to pass the rule's seed (Allowed files only, seed lines plus imports):
  - Person (bare JID): `NewMessageDialog` and `NewGroupDialog` contact rows now use `contact.jid` (was `contact.userId`); `GroupMembersSection` add-picker now uses `contact.jid`; `ContactProfileRow` and `PeopleSearchResult` person rows use the store contact's `jid`, falling back to `personSeed(userId, domain)` where the domain comes from my own JID (`s.me?.jid`, i.e. the XMPP token's JID surfaced via `GET /api/me`'s `jid`); the member lists in `GroupMembersSection`, `TopicMembersSection` (via new `seedFor` prop), `GroupRolesSection` (via new `seedFor` prop), `ChannelAdminsSection` (via new `seedFor` prop), `NewTopicDialog`, and `TopicActionButtons.AddMemberButton` (via new `seed` prop) derive `personSeed(userId, domain)` with the domain from my own JID; `BlockedPage` uses `person.jid` when non-null, else the user id.
  - AI (AI JID): `AisPage` now uses `ai.jid` (was `ai.id`); `AiPanel` header now uses `ai?.jid ?? chat.id` (was `ai?.id ?? chat.id`, and the fallback `chat.id` already IS the AI JID for an AI DM); `AiPictureSection` passes `ownerSeed={ai.jid}` to the uploader.
  - Group (General room JID): `GroupHeaderRow` takes a new `avatarSeed` prop; `ChatListBody` computes it inline as `(topics.find(isGeneral) ?? topics[0])?.id ?? groupId`; `GroupPanel` header uses the General room JID resolved from the painted chats (else the open row id); `GroupPictureSection` takes a new optional `generalRoomJid` prop and passes `ownerSeed={generalRoomJid ?? chatId}`; `AvatarUploader` takes a new optional `ownerSeed` prop (Seed ?? ownerId) so the call sites above can pass the rule's seed while the upload `ownerId` stays unchanged.
- Left unchanged, as the spec orders (§4 "Sites where the rule's id is NOT available today"): web `panels/TopicAisSection.tsx:64` (only `TopicAi.id` in scope; JID needs the group detail or a server change), `ExplorePage.tsx:240` (only the group id + handle; General room JID needs the group's topics), `routes/GroupHandleRoute.tsx:228` (same). `PeopleSearchResult` group row (`entry.id`) is also unchanged — same cold-directory reason. Untouched-but-in-scope sites already pass the rule's seed: `ChatListItem`, `ChatHeader`, `MessageBubble`, `MentionPicker`, `GroupPanel` topic rows, `MessageSearchResult(s)`, `ForwardPicker`, `TopicHeader`, `ChannelHeader`, `TopicActionButtons` AI picker, `GroupAiRowView`, `GroupAiSection`, `NewTopicDialog` AI rows, `ChannelPanel` AI rows.
- `u<hash>` fallback: the client cannot reproduce it. The server's `localpartFor` (`apps/server/src/xmpp/provisioning.ts:29-35`) falls back to `u` + 20 base32 chars of `sha256(userId)` for ids that stay invalid after lowercasing — sha256 + base32 are not available to the web client in this task's scope, and no web helper mirrors them. So `personSeed` keeps the simple form; everywhere the real bare JID is on hand (DM chat id, `Contact.jid`, `BlockedPerson.jid`) the call sites use it, which matches the DM `chat.id` whenever both sides use the same domain. Documented in `avatar-seed.ts`.

### XMPP domain source
The domain is read from my own JID in the store (`s.me?.jid`), which the lifecycle fills from `GET /api/me` (`AuthMe.jid`, contract `auth.ts:54`) and the XMPP token (`XmppToken.domain`, contract `xmpp.ts:14`). This is the same domain the web mention builder uses (`domainOf(mine)` from `ctx.k.myJid()`, `groupMembers.ts:84-88`).

### Files changed (26, all inside Allowed files)
`packages/chat-core/src/avatar.ts`, `packages/chat-core/src/avatar-seed.ts` (new), `packages/chat-core/src/index.ts`, `apps/web/src/components/AvatarUploader.tsx`, `ChannelPanel.tsx`, `ContactProfileRow.tsx`, `GroupMembersSection.tsx`, `GroupPanel.tsx`, `NewGroupDialog.tsx`, `NewMessageDialog.tsx`, `NewTopicDialog.tsx`, `PeopleSearchResult.tsx`, `TopicPanel.tsx`, `TopicRow.tsx`, `ais/AiPanel.tsx`, `ais/AiPictureSection.tsx`, `chatList/ChatListBody.tsx`, `panels/ChannelAdminsSection.tsx`, `panels/GroupPictureSection.tsx`, `panels/GroupRolesSection.tsx`, `panels/TopicActionButtons.tsx`, `panels/TopicMembersSection.tsx`, `panels/topicPanelOps.ts`, `apps/web/src/routes/AisPage.tsx`, `apps/web/src/routes/BlockedPage.tsx`, `work/T-1209-web-avatar-seeds.md`.

### Commands and real results
- `pnpm install`: done (10.6s).
- `pnpm --filter @zilar/chat-core exec tsc --noEmit`: pass, no output.
- `pnpm exec tsc --noEmit` (apps/web): pass, no output.
- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot`: 5 files, 62 tests passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store/realStore.send.test.tsx`: 2 failed / 8 passed — `sends text and links the echo without duplicating it` and `forwards a sent message into another chat`. Verified pre-existing: the same 2 failures occur with my changes stashed (clean tree), so they are not caused by this task.
- `pnpm gate` (final): GATE PASS — `gate: 26 changed file(s) against main / PASS install (frozen) / PASS format / PASS lint / PASS typecheck / PASS effect / PASS tests @zilar/chat-core / SKIP tests @zilar/web (no nearby test files) / scope: every changed file is inside the Allowed files / migration: every added migration continues from the base / GATE PASS`. (An earlier gate run that picked up `realStore.send.test.tsx` as a nearby test failed on the 2 pre-existing failures above; the final gate run skips web tests.)
- Every touched file is at most 400 lines (checked: TopicRow 345, GroupPanel 349, AvatarUploader 272, avatar-seed 37).

### Problems / deviations
- First gate run flagged `apps/web/src/store/chatGroups.ts` and `packages/chat-core/src/topics.ts` as outside Allowed files (I had added a `ChatGroup.avatarSeed` field and a `generalRoomJid` helper there). I reverted both files and compute the General seed inline in the allowed call sites instead (`ChatListBody`, `GroupPanel`). Final gate: scope clean.
- `AvatarUploader` needed a small `ownerSeed?` prop (seed line + import scope is "Avatar seed lines plus the imports", and the uploader is on the §4 web list for all three kinds) because the upload `ownerId` must stay the raw id while the ball uses the rule's seed. Same pattern for `GroupPictureSection.generalRoomJid?`, `TopicMembersSection.seedFor`, `GroupRolesSection.seedFor`, `ChannelAdminsSection.seedFor`, `TopicActionButtons.AddMemberButton seed`.

### Open questions
- None blocking. Note for T-1210 (mobile): the same `personSeed`/`aiSeed`/`groupSeed` helpers are exported from `@zilar/chat-core` and ready to reuse; the `u<hash>` caveat above applies there too.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 3 nits and 1 follow-up.**
- **chat-core:**
  - `avatarSvg` runs every seed through `normalizeJid`;
  - the new `avatar-seed.ts` has `personSeed(userId, domain)` (the web mention builder's form), `aiSeed` and `groupSeed`.
  - The server's `u<hash>` fallback can't be reproduced on the client, so callers prefer a real JID when they have one.
- **Web:** 22 component and route files on the audit's §4 list now pass the rule's seed. The documented gap sites are unchanged.
- **The follow-up:** the own-profile `AvatarUploader` in `ProfileSettingsSection.tsx` still uses the user id. It's outside the §4 list; it goes with the mobile task.
- **Still to do:** the lead's check on the mock build, and T-1210 for mobile.

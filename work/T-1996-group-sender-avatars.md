---
id: T-1996
title: "Group chats show each sender's real picture (AIs and non-contacts too), not the name-seeded ball — web and phone"
status: merged
milestone: M5
branch: task/T-1996-group-sender-avatars
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-1996: Real sender pictures in group chats

## Spec (written by Claude, do not edit)

### Why
On 2026-10-18 Julio sent two screenshots from his Android phone. In "My AIs", his AI "Deepseek" has the blue ball he chose. In the topic "cards test", the same AI's messages show a purple ball, and the header's people stack shows the blue one. His words: "Why the profile picture blob is not the same as the one I set myself".

A group message's avatar only looks up the sender in **my contacts**. AIs, and members who are not my contacts, fall back to the ball seeded from their name. The fix covers web and phone (parity rule).

### Facts (read by the lead on 2026-10-18)
- **The bubbles.** Each bubble passes only the sender's id and name:
  - phone: `apps/mobile/src/components/chat/message-bubble.tsx:299-305` renders `<EntityAvatar person={{ id: message.senderId, name: message.senderName }} size={34} />`;
  - web: `apps/web/src/components/MessageBubble.tsx:213` does the same.
- **The lookup.** `EntityAvatar` resolves a `person`'s picture as `person.avatarUrl ?? person.image ?? contact?.avatarUrl`, where `contact` comes from the store's `contacts` (phone `apps/mobile/src/components/chat/entity-avatar.tsx:53-58`, web `apps/web/src/components/EntityAvatar.tsx:53-58`).
- **The sender id.** For a group message, `senderId` is the sender's resolved bare JID (`packages/client-core/src/store/ledger-incoming.ts:131`: `message.outgoing ? meId : message.fromJid`).
- **Where the real pictures already are.**
  - A topic chat's `chat.topic.ais` is `TopicInfoAi[]`, with `id`, `name`, `avatarUrl?` and `jid?` (`packages/chat-core/src/types.ts:146-152`). The phone header already uses `ai.avatarUrl` (`apps/mobile/src/components/chat/chat-header.tsx:139-143`).
  - The group detail (`state.groupDetail(groupId)`, `chat-header.tsx:107-108`) has `members` with `userId`, `name` and `avatarUrl`. `memberPerson` in `apps/mobile/src/components/chat/topic-people-line.tsx:35-49` maps a member id to `{ id, name, avatarUrl }`.
  - Read the contract types to find how a member maps to a JID (the member's `jid` field, or the JID built from the user id). Use whatever the existing code uses; grep for how the people panel or the mention list match a member to a JID.

### Steps
1. **A shared resolver.** Add a small pure helper in `packages/client-core` (a new file, for example `src/store/sender-avatar.ts`): `senderAvatarUrl(senderJid, topicAis, groupMembers)`. It compares bare JIDs in lower case and returns the matching AI's `avatarUrl`, else the matching member's `avatarUrl`, else `undefined`. Export it from the package barrel the way nearby helpers are exported.
2. **Phone.** In `message-bubble.tsx`, read the chat's topic AIs and the group detail through narrow store selectors (no whole-array subscriptions). Pass the result as `person.avatarUrl` to `EntityAvatar` (it already prefers `person.avatarUrl`).
3. **Web.** Do the same in `MessageBubble.tsx` with the web store.
4. **Don't change anything else.**
   - The name-seeded ball stays the fallback when no picture is known.
   - No tests (UI).
   - Every file stays at or under 400 lines.

### Allowed files
- `packages/client-core/src/store/sender-avatar.ts`
- `packages/client-core/src/index.ts`
- `packages/client-core/src/store/index.ts`
- `apps/mobile/src/components/chat/message-bubble.tsx`
- `apps/web/src/components/MessageBubble.tsx`
- `work/T-1996-group-sender-avatars.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The lead checks in the web mock and in a phone smoke that an AI's messages in a group topic show the same picture as its row in My AIs.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- Added `packages/client-core/src/store/sender-avatar.ts`: `senderAvatarUrl(senderJid, topicAis, groupMembers)` compares bare JIDs (lower cased, resource stripped) and returns the matching topic AI's `avatarUrl`, else the matching group member's `avatarUrl`, else `undefined`. Members whose `userId` is a localpart take the sender's domain, the same JID the mention list builds; a `userId` that already carries a domain is used as is.
- Exported it from `packages/client-core/src/store/index.ts` in its own marked T-1996 section. The root `src/index.ts` was left alone because no store helper is exported there today; both apps import the `@zilar/client-core/store` barrel that already carries the nearby helpers.
- Phone (`apps/mobile/src/components/chat/message-bubble.tsx`): the incoming group bubble now reads `chat.topic?.ais` and the group detail's `members` through one store selector that returns a string (stable under the store's `Object.is` check) and passes it as `person.avatarUrl` to `EntityAvatar`. The group id comes from `chat.groupId`, else `state.groupIdForChat(message.chatId)`.
- Web (`apps/web/src/components/MessageBubble.tsx`): same via `useChatSelector` on `s.groupInfos[chat.id]?.members` plus `chat.topic?.ais`, passed as `person.avatarUrl`.
- Nothing else changed: the name-seeded ball remains the fallback, no tests (UI), all changed files at or under 400 lines (web is 399).

### Checks run

- `pnpm install`: done (all 17 workspace projects, no errors).
- No single test files were run: the change is UI wiring plus a pure lookup, and the spec asks for no tests.
- `pnpm gate` from the repo root (run again after the Report edits; same result):
  ```
  PASS  install (frozen)  (14.0s)
  PASS  format  (22.2s)
  PASS  lint  (9.1s)
  PASS  typecheck  (7.4s)
  PASS  effect  (6.9s)
  PASS  tests @zilar/client-core  (25.3s)
  PASS  tests @zilar/mobile  (3.1s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- An AI is matched only through the topic row's `ais` (`TopicInfoAi.jid`), as the spec says. On a server whose topic rows carry no `jid` (older servers), an AI bubble keeps the name-seeded ball.
- On web the group detail is the chat-keyed `groupInfos[chat.id]` the store already fills from the group GET; on phone it is `state.groupDetail(groupId)`. Neither triggers a load, so the bubble picks up the real picture as soon as the detail is cached.


## Review (written by Claude)

Approved.
- **What changed.** `senderAvatarUrl` matches the sender's bare JID against the topic's AIs (`jid`) and then the group's members. Both apps pass the result as `person.avatarUrl`, and the phone uses a narrow string selector.
- **Mock check.** The web mock (Dev team › Checkout) renders with no errors. Its AIs have no uploaded picture, so the visible check is done on live: Julio's "Deepseek" in "ai test › cards test" should show the blue ball from My AIs.
- **Nit.** A sender's domain is used to build member JIDs. That only matters with federation, which is off.

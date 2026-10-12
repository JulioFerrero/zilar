---
id: T-1192
title: "MUX-11/12/15: mobile shows people's and groups' profile photos (ball as fallback) in chat rows, the chat header and bubbles; tapping a DM header opens the person's profile; the chat header shows 'Connecting…' / 'Waiting for network…' while not online"
status: merged
milestone: M5
branch: task/T-1192-mobile-avatars-header
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1192: Photos, a DM header tap, and the connection state in chat

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mobile-ux-audit.md` MUX-11, MUX-12 and MUX-15 (P2, confirmed by code).
- **MUX-12, nobody's photo shows:** `apps/mobile/src/components/chat/avatar.tsx:18-46` always draws `avatarSvg(id)` and takes no image URL. So users who upload a photo never see anyone else's. `ChatSummary.avatarUrl` exists (`packages/chat-core/src/types.ts:140`), and `avatarImageSource(url, apiUrl, token)` (`apps/mobile/src/components/settings/profile-logic.ts:151`) builds an `expo-image` source with the bearer only for the API origin.
- **MUX-11, the DM header does nothing:** the title is pressable only for topics and groups (`apps/mobile/src/components/chat/chat-header.tsx:99-117`). The DM title is inert. The profile screen `apps/mobile/src/app/u/[handle].tsx` exists, with block and unblock.
- **MUX-15, no connection state inside a chat:** `connectionLabel` (`apps/mobile/src/lib/connection.ts:7-16`) is only shown in the chat list. The header subtitle is `chatSubtitle` (`chat-header.tsx:53`).

### What to build
1. **`avatar.tsx`:**
   - an optional `avatarUrl` prop. When set, render `expo-image` with `avatarImageSource(avatarUrl, API_URL, token)`, in the same circle, with the ball SVG behind it as the placeholder and on error;
   - get the token the way the profile avatar code does (`apps/mobile/src/components/settings/use-profile-avatar.ts`; cite it);
   - keep the online dot.
2. **Pass `avatarUrl={chat.avatarUrl}`** where chats render an avatar: `chat-list-item.tsx` (the `Avatar` call) and `chat-header.tsx:98`. For bubbles, `message-bubble.tsx` around line 244: pass the sender's avatar when the bubble already knows it; if not, leave bubbles as they are and say so.
3. **MUX-11:** for a DM (not AI, not a topic, not a group), the header title opens that person's profile at `/u/[handle]`. Find the handle: the contacts store (by user id or JID) or a lookup the app already has. If no handle is known, keep the title inert.
4. **MUX-15:** in `chat-header.tsx`, read the connection status from the store, the same field `chat-list.tsx` uses. When `connectionLabel(status)` isn't undefined, show it as the subtitle instead of `chatSubtitle` and typing.
5. **No tests** (UI).

### Read first
`AGENTS.md`, `docs/audit/mobile-ux-audit.md` (MUX-11, MUX-12, MUX-15), `apps/mobile/src/components/chat/avatar.tsx`, `apps/mobile/src/components/chat/chat-header.tsx`, `apps/mobile/src/components/chat/chat-list-item.tsx`, `apps/mobile/src/components/chat/message-bubble.tsx:230-260`, `apps/mobile/src/components/settings/profile-logic.ts:140-175`, `apps/mobile/src/components/settings/use-profile-avatar.ts`, `apps/mobile/src/lib/connection.ts` and `apps/mobile/src/components/chat/chat-list.tsx:55-75`.

### Allowed files
`apps/mobile/src/components/chat/avatar.tsx`, `apps/mobile/src/components/chat/chat-header.tsx`, `apps/mobile/src/components/chat/chat-list-item.tsx`, `apps/mobile/src/components/chat/message-bubble.tsx`, `work/T-1192-mobile-avatars-header.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Every touched file stays at most 400 lines (`message-bubble.tsx` is 381).
- **The lead's check on the emulator against production:**
  - a contact with a photo shows it in the list and the header;
  - tapping the DM header opens the profile;
  - airplane mode shows "Waiting for network…" in the chat header.

---

## Report (written by the worker when done)

### What I did

**MUX-12, photos everywhere in chat rows and the header.**
- `apps/mobile/src/components/chat/avatar.tsx`: added an optional `avatarUrl` prop. When it is set and the token is loaded, an `expo-image` `Image` renders on top of the ball SVG inside the same circle (`contentFit="cover"`), and the ball stays behind as the placeholder. On `onError` the picture is dropped and the ball returns. The failed state stores the failed url, not a flag, so a fresh `avatarUrl` clears it (the `profile-view.tsx` pattern). The online dot is unchanged.
  - Token: read with `getSessionToken()` (`@/lib/session-token`) into state, the way `use-profile-avatar.ts` does (its `token` state is the cited source), but with the per-component fiber + interrupt the chat media loaders use (`sticker-message.tsx`, `attachment-video.tsx`), so a late read or an unmount never reaches a stale avatar. `avatarImageSource(url, API_URL, token)` builds the source and puts the bearer on the API origin only.
  - The picture waits for the token because a relative `/api/avatars/<id>` path needs the bearer; the ball shows until then.
- `chat-list-item.tsx`: `Avatar` now gets `avatarUrl={chat.avatarUrl}`.
- `chat-header.tsx`: `Avatar` now gets `avatarUrl={chat.avatarUrl}`.

**MUX-11, tapping a DM header opens the person's profile.**
- `chat-header.tsx`: for a DM (`chat.kind === 'dm' && !chat.isAI`; topics and groups keep their existing branches) the title becomes a `Pressable` that does `router.push({ pathname: '/u/[handle]', params: { handle } })`. The handle comes from the contacts store (`state.contacts`): the server builds a DM's `chatJid` as `contact.jid` (`apps/server/src/chats/api.ts:107`), so the lookup matches `contact.jid === chat.id` first, then the normalized `userId`. No handle known (contact absent, AI DM, hash-fallback id) → the title stays inert, as the spec asks.

**MUX-15, connection state in the chat header.**
- `chat-header.tsx`: reads `state.status` (the same store field `(tabs)/index.tsx` / `chat-list.tsx` use) and applies `connectionLabel(status)`. When it is not `undefined`, it replaces both the subtitle and the typing hint (`connection ?? (writing ? 'writing…' : (typing ?? chatSubtitle(...)))`).

**Bubbles (MUX-12): left unchanged.** `message-bubble.tsx:244` renders the group sender's avatar from `message.senderId` / `message.senderName`. `UiMessage` carries no sender avatar (`packages/chat-core/src/types.ts:55`) and group members (the store's `MentionMember`) carry no `avatarUrl`, so the bubble does not know the sender's photo. Per the spec I left it as it is. I did not add a contacts-store lookup here (a group sender is not necessarily a contact); say the word if you want that.

### Files changed
- `apps/mobile/src/components/chat/avatar.tsx`
- `apps/mobile/src/components/chat/chat-header.tsx`
- `apps/mobile/src/components/chat/chat-list-item.tsx`
- `work/T-1192-mobile-avatars-header.md`
- `apps/mobile/src/components/chat/message-bubble.tsx` — **not changed** (see above).

### Commands and real results
- `pnpm install` — done (17.4s).
- `pnpm exec prettier --check ...` on the three touched `.tsx` files — 2 needed formatting; fixed with `prettier --write` on those two (avatar, chat-header). (Ran only format on my own files, before the gate.)
- `pnpm gate` (from the repo root) — **GATE PASS**, summary lines:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.0s)
  PASS  lint  (1.2s)
  PASS  typecheck  (2.8s)
  PASS  effect  (0.6s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
No single test file was run: there are no tests in `apps/mobile/src/components/chat/`, and the task says UI gets no tests.

### Line counts (<= 400)
`avatar.tsx` ~105, `chat-header.tsx` ~175, `chat-list-item.tsx` ~154.

### Deviations / notes
- The picture only renders once the token resolves. For a relative `/api/avatars/<id>` url that is required; a foreign absolute url would also wait for the token (harmless for chat avatars, which the server always serves relative). A token read that returns `undefined` leaves the ball.
- I did not verify this on a device/emulator against production (no run available to me); the three acceptance checks are the lead's emulator smoke.

### Open questions
None.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 2 nits.**
- **`Avatar`** takes an optional `avatarUrl`: an `expo-image` drawn over the ball, with the bearer only once the token resolves; the ball stays as the placeholder and on error.
- **Passed in** the chat list row and the header. Bubbles are unchanged: `UiMessage` has no sender avatar.
- **DM header:** the title opens `/u/[handle]` when a handle is known.
- **Header subtitle:** shows `connectionLabel(status)` while not online.
- **Still to do:** the emulator check with the APK.

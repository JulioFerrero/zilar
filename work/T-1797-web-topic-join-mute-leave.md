---
id: T-1797
title: "Topic people W9 (web): a public topic you are not in shows its recent messages read-only (GET /topics/:id/preview) with a 'Join <topic>' key instead of the composer; the topic panel gains the board's Mute switch and Leave topic rows"
status: merged
milestone: M5
branch: task/T-1797-web-topic-join-mute-leave
model: auto
effort: default
depends_on: [T-1786]
estimate: 50 min
---

# T-1797: Web Join preview, Mute and Leave

## Spec (written by Claude, do not edit)

### Why
This is W9 of `docs/plan/topic-people.md` (`:667-671`, §2.6 and §2.7). A group member who opens a public topic they haven't joined should:
- see its recent messages, read-only;
- see a **Join {topic}** key where the composer is (`docs/design/mockups/topic-people/PhoneJoin.dc.html`: the normal chat with the messages, and one "Join Marketing" key at the bottom).

The topic panel gets the board's bottom group: a **Mute** switch row and a red **Leave topic** row (`docs/design/mockups/topic-people/WebTopic.dc.html:113-124`).

### Facts (read by the lead on 2026-10-17)
- **Joined:** `isTopicJoined(topic, userId)` in `packages/chat-core/src/topics.ts:57-62` is `isGeneral || memberIds.includes(userId)`. `apps/web/src/components/group-info/TopicsSection.tsx:289-294` uses it to split Your and Other topics.
- **Joining:** the store already has `joinTopic(chatId)` (`apps/web/src/store/groupStoreTypes.ts:60`, from T-1786), and `TopicsSection.tsx:232` calls it.
- **The preview route** (T-1774, live): the contract is `packages/api-contract/src/topics.ts:258-279` plus the endpoint `preview` at `:330`. `GET /api/topics/:id/preview` returns `{ messages: [{ id, at, nick, body, payload? }] }`, oldest first. It answers 404 for private or joined topics and non-members.
- **The web API pattern:** `apps/web/src/lib/api/topics.ts:113-115` (`callApi((client) => client.topics.join({ params: { id } }))`). There's no preview client yet.
- **The chat view:**
  - `apps/web/src/routes/ChatView.tsx` (354 lines) renders `<MessageList key={chat.id} …>` at `:261`;
  - then, at `:269-287`: the selection bar, `ChannelComposerBar` for channels, or `AiStatusLine` + `Composer`.
  - `apps/web/src/components/ChannelComposerBar.tsx` (74 lines) is the pattern for a bar that replaces the composer.
- **Mute:**
  - `ChannelComposerBar.tsx:33`: `storeApi.getState().setMuted(chat.id, chat.muted ? null : 'forever')`;
  - `ChatSummary.muted` is at `packages/chat-core/src/types.ts:202`.
- **The topic panel:**
  - `apps/web/src/components/TopicPanel.tsx` is 354 lines, so **don't grow it by more than ~10 lines**; put the new rows in a new file.
  - Leave already exists: `leaveState` and `runLeave` come from `useTopicPanelOps` (`apps/web/src/components/panels/topicPanelOps.ts`), and `TopicMembersSection` gets `onLeave` (`TopicPanel.tsx:221-233`).
  - The server lets anyone leave a public non-General topic themselves and refuses General with 400 (`apps/server/src/topics/members.ts:235-243`).
  - `apps/web/src/components/ConfirmDialog.tsx` (62 lines) is the confirm.

### Steps
1. **`getTopicPreview(id)`** in `apps/web/src/lib/api/topics.ts`, through `callApi` → `client.topics.preview`.
2. **A new `apps/web/src/components/topic/TopicJoinView.tsx`,** used by `ChatView.tsx` when `chat.topic` is public, not General, and `!isTopicJoined(chat.topic, me)`.
   - It replaces both the `MessageList` and the composer branch.
   - It loads the preview once per topic and draws the messages read-only, oldest at the top: sender name, body (keep line breaks; a payload message shows its `body` text) and time (HH:MM). Use the look of the chat's incoming bubbles.
   - Then a bottom bar like `ChannelComposerBar` with one light key, **Join {topic title}**, which calls `joinTopic(chat.id)`. It shows a busy state, and an inline error line on failure.
   - Once joined, `isTopicJoined` turns true and the normal view takes over.
   - States: an empty preview shows "No messages yet"; a failed load shows a one-line error with Retry.
   - `ChatView.tsx` grows only by the branch, at most about 12 lines.
3. **A new `apps/web/src/components/topic/TopicMuteLeave.tsx`,** rendered at the bottom of `TopicPanel.tsx` (board `WebTopic.dc.html:113-124`):
   - a row with a bell icon tile, "Mute" and a D24 switch (`role="switch"`, `aria-label="Mute {title}"`) that calls `setMuted(chat.id, chat.muted ? null : 'forever')`;
   - a red "Leave topic" row with the log-out icon, hidden for General. It opens `ConfirmDialog` ("Leave {title}?" — for a private topic, add "Someone will have to add you back.") and then calls the panel's existing `runLeave`.
   - Remove the old Leave entry point in `TopicMembersSection` only if it's the same action, so Leave appears once in the panel.
4. **No tests** (UI). Keep every file at most 400 lines.

### Allowed files
- `apps/web/src/lib/api/topics.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/routes/ChatView.tsx`
- `apps/web/src/components/topic/TopicJoinView.tsx`
- `apps/web/src/components/topic/TopicMuteLeave.tsx`
- `apps/web/src/components/TopicPanel.tsx`
- `apps/web/src/components/panels/TopicMembersSection.tsx`
- `work/T-1797-web-topic-join-mute-leave.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- A public topic you haven't joined shows its recent messages read-only and a Join key.
- Joining switches to the normal chat.
- The topic panel has the Mute switch and one Leave topic row (none on General), with a confirm.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **Preview client (step 1).** `getTopicPreview(id)` in `apps/web/src/lib/api/topics.ts`
  calls `client.topics.preview` through `callApi` and returns the `messages` array
  (`TopicPreviewMessage[]`, oldest first as the server sends it).
- **Join preview (step 2).** New `apps/web/src/components/topic/TopicJoinView.tsx`:
  - loads the preview once per topic with `useQuery` (Retry re-runs it);
  - draws the messages as the chat's incoming bubbles (`bubble-in`, 14 px radius,
    sender name in `senderColor(nick)`, body with `whitespace-pre-wrap`, `HH:MM`
    from `formatTime`, oldest at the top, payload messages show their `body`);
  - states: inline loading, empty preview shows "No messages yet", a failed load
    shows one line and a Retry key;
  - the composer is replaced by a bottom bar matching `ChannelComposerBar` with
    one light primary key, `Join {chat.title}`. It calls the existing
    `storeApi.getState().joinTopic(chat.id)` through `useAction`/`fromApi`, shows
    "Joining…" while busy, and a one-line inline error on failure. Once the store
    repaints the row, `isTopicJoined` turns true and the normal chat returns.
  - `ChatView.tsx` computes `joinPreview` (public, not General, viewer not in
    `memberIds`) and renders `TopicJoinView` instead of `MessageList` and the
    composer branch. The header, panels and pinned banner stay.
- **Mute and Leave (step 3).** New `apps/web/src/components/topic/TopicMuteLeave.tsx`,
  rendered at the bottom of `TopicPanel`:
  - a bell tile row, "Mute", and the existing `Switch` (24 px, `role="switch"`,
    `aria-label="Mute {title}"`) calling
    `setMuted(chat.id, chat.muted ? null : 'forever')`; busy disables it and a
    failure shows an inline line;
  - a red "Leave topic" row with the `LogOut` icon, hidden on General and when
    the viewer is not in the topic (`isTopicJoined`). It opens `ConfirmDialog`
    with the board's copy (`PhoneLeave.dc.html`), title `Leave {title}?`, public
    body "You stop getting its messages. You can join again from {group}.",
    private body "Someone in it has to add you back.", then calls the panel's
    existing `runLeave`. While it runs the row is non-interactive and reads
    "Leaving…".
  - The old Leave key in `TopicMembersSection` was the same `runLeave` action, so
    it was removed (and its `iAmMember`/`leaving`/`onLeave` props), leaving one
    Leave row in the panel.
- Changed files: `apps/web/src/lib/api.ts`, `apps/web/src/lib/api/topics.ts`,
  `apps/web/src/routes/ChatView.tsx`,
  `apps/web/src/components/topic/TopicJoinView.tsx`,
  `apps/web/src/components/topic/TopicMuteLeave.tsx`,
  `apps/web/src/components/TopicPanel.tsx`,
  `apps/web/src/components/panels/TopicMembersSection.tsx`,
  `work/T-1797-web-topic-join-mute-leave.md`.
- **Fix round (4 items).** (1) The Leave row now hides unless `isTopicJoined`;
  (2) `TopicPanel` passes `isWaiting(leaveState)` and the row disables with
  "Leaving…"; (3) the confirm copy matches `PhoneLeave.dc.html` and uses the
  panel's `groupTitle`; (4) `getTopicPreview` is re-exported from the `lib/api`
  barrel and `TopicJoinView` imports it from `@/lib/api`.
- **Fix round 2.** `TopicJoinView` is keyed by `chat.id` in `ChatView`, so moving
  from one unjoined topic to another starts with a fresh, empty preview instead
  of briefly showing the previous topic's messages.

### Checks run

No unit tests were added: the spec says UI only. I ran no single-file tests; the
gate ran the web package's nearest tests.

`pnpm gate` (from the repo root), exit 0:

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.5s)
PASS  lint  (0.7s)
PASS  typecheck  (3.2s)
PASS  effect  (0.6s)
PASS  tests @zilar/web  (3.3s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

(The first run before the Report edit also ended in `GATE PASS`, same steps.)

### Notes for the lead

- `ChatView.tsx` went from 354 to 369 lines (+15): +2 imports, +8 lines for the
  `joinPreview` branch including its comment, and the wrapper around the existing
  message list/composer. Slightly above the "about 12" guidance; nothing outside
  the branch was touched.
- The preview bubble omits the avatar (the web mock's messages have none); it
  keeps the incoming bubble surface, sender name, body and time as the spec asks.
- The Leave row shows for a joined, non-General topic. On a public topic the
  viewer only reaches the panel after joining, so it is the normal case.
- `getTopicPreview` is exported from `lib/api/topics.ts` and re-exported from the
  `lib/api` barrel; `TopicJoinView` imports it from `@/lib/api`.

## Review (written by Claude)

Merged on code review. Checked on 2026-10-17:
- The packet matches HEAD `4528a8625`, after two lead rounds.
- **`ChatView`** swaps the list and the composer for `TopicJoinView key={chat.id}` on a public, non-General, not-joined topic. `currentUserId` and `memberIds` are both user ids (`lifecycle.ts:148`).
- **The panel:**
  - one Mute switch;
  - one Leave row, hidden on General and when not joined, showing "Leaving…" while busy, with the board's confirm texts;
  - `getTopicPreview` comes from the barrel.
- **Follow-up (NOW.md):** draw card rows as cards in the preview, as the phone does (T-1798).
- **Live check:** after the flip (T-1802), on a public topic Julio hasn't joined.


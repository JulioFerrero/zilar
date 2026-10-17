---
id: T-1798
title: "Topic people W10 (phone): a public topic you are not in shows its recent messages read-only (GET /topics/:id/preview) with a 'Join <topic>' key instead of the composer; the In this topic sheet gains the board's Mute switch and a Leave topic row with a confirm sheet (public and private)"
status: merged
milestone: M5
branch: task/T-1798-phone-topic-join-mute-leave
model: auto
effort: default
depends_on: [T-1789]
estimate: 50 min
---

# T-1798: Phone Join preview, Mute and Leave

## Spec (written by Claude, do not edit)

### Why
This is W10 of `docs/plan/topic-people.md` (`:672-676`), the phone twin of T-1797 (web). The boards are in `docs/design/mockups/topic-people/`:
- **`PhoneJoin.dc.html`:** a public topic you're not in shows its messages, with one "Join Marketing" key where the composer is.
- **`PhonePeople.dc.html:90-100`:** the bottom group of the In this topic sheet, with a 34 px bell tile, "Mute" and a 46×28 switch, then a red "Leave topic" row.
- **`PhoneLeave.dc.html`:** the confirm.
  - Public: "Leave Financial?" / "You stop getting its messages. You can join again from ai test." / Cancel and Leave.
  - Private: "Leave Design? Someone in it has to add you back."

### Facts (read by the lead on 2026-10-17)
- **Joined:** `isTopicJoined(topic, userId)` is in `packages/chat-core/src/topics.ts:57-62`. The store has `joinTopic(chatId)` (`apps/mobile/src/store/types-groups.ts:97`, `store/effects/group-actions.ts:123-125`).
- **The API port:** `apps/mobile/src/lib/topics-api.ts` (257 lines). The `TopicsApi` interface is at `:111` (`joinTopic` at `:120`), and the production client is at `:205-257` (`joinTopic` at `:233`). No other file implements `TopicsApi`.
- **The preview route** (live): `GET /api/topics/:id/preview` → `{ messages: [{ id, at, nick, body, payload? }] }`, oldest first. The contract is `packages/api-contract/src/topics.ts:258-279` plus the endpoint `preview` at `:330`.
- **The chat screen:** `apps/mobile/src/app/chat/[id].tsx` (189 lines). The topic branch renders `<ChatThread screen={screen} chat={chat} />` and `<ChatComposerDock … />` inside a `KeyboardAvoidingView` (`:103-110` and `:142-148`).
- **Leave today:** `apps/mobile/src/components/chat/topic-info-host.tsx:55-63`, `onLeave` → `removeTopicMember(chat.id, screen.myUserId)`. The sheet shows a ghost "Leave" button only for a private topic (`apps/mobile/src/components/chat/topic-info-sheet.tsx:318-328`). The sheet is 345 lines, so **put the new rows in a new file**. The server lets anyone leave a public non-General topic themselves (`apps/server/src/topics/members.ts:235-243`).
- **Mute:** `apps/mobile/src/components/chat/chat-actions-host.tsx:43-54` calls `saveChatPref(chatId, { mutedUntil: mutedUntilFor(duration, new Date()) })` and `saveChatPref(chatId, { mutedUntil: null })`; `saveChatPref` comes from `use-chat-actions.ts:146`.

### Steps
1. **`topicPreview(id)`:** add it to `TopicsApi` and the production client (`runApi(client.topics.preview({ params: { id } }))`).
2. **A new `apps/mobile/src/components/chat/topic-join-view.tsx`,** used by `[id].tsx` in place of `ChatThread` and `ChatComposerDock` when the topic is public, not General, and not joined.
   - It loads the preview and draws the messages read-only, oldest first, in the incoming bubble look: name, body and HH:MM.
   - At the bottom it shows one full-width light key, "Join {title}" (40 px, 12 px radius, as on the board), which calls `joinTopic(chat.id)`. It shows a busy state, and an inline error on failure.
   - It also has an empty state and a load error with Retry.
3. **A new `apps/mobile/src/components/chat/topic-mute-leave.tsx`,** the board's bottom group, rendered at the end of the In this topic sheet:
   - **Mute** with a switch: on is `mutedUntil: mutedUntilFor('forever', …)`, using the id the mute menu uses for "always"; off is `null`.
   - **Leave topic** in red, hidden for General, shown for public and private topics. It opens a new `apps/mobile/src/components/chat/leave-topic-sheet.tsx` with the board's texts per visibility, Cancel and a red Leave. Leave calls the host's existing `onLeave`.
   - Remove the old private-only ghost Leave button from `topic-info-sheet.tsx:318-328`, so Leave appears once.
4. **No tests** (UI). Keep every file at most 400 lines.

### Allowed files
- `apps/mobile/src/lib/topics-api.ts`
- `apps/mobile/src/app/chat/[id].tsx`
- `apps/mobile/src/components/chat/topic-join-view.tsx`
- `apps/mobile/src/components/chat/topic-mute-leave.tsx`
- `apps/mobile/src/components/chat/leave-topic-sheet.tsx`
- `apps/mobile/src/components/chat/topic-info-sheet.tsx`
- `apps/mobile/src/components/chat/topic-info-host.tsx`
- `work/T-1798-phone-topic-join-mute-leave.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- On the phone, a public topic you haven't joined shows its recent messages read-only and a Join key; joining switches to the normal chat.
- The In this topic sheet has the Mute switch and one Leave topic row (none on General), with the board's confirm texts.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

**Join preview (step 1 and 2)**
- `apps/mobile/src/lib/topics-api.ts`: added `topicPreview(id)` to `TopicsApi` and the production client (`runApi(client.topics.preview({ params: { id } })).then(({ messages }) => messages)`), and re-exported the contract's `TopicPreviewMessage` type.
- `apps/mobile/src/components/chat/topic-join-view.tsx` (new): loads `GET /api/topics/:id/preview` on mount and draws the messages oldest first in the incoming bubble look (name in `senderColor`, body, HH:MM), with avatars. Empty state, load error with Retry, and a footer with the full-width `Join {title}` light key (h-10, 12 px radius). Joining runs the store's `joinTopic(chat.id)`, shows "Joining…" and an inline fixed-sentence error.
- `apps/mobile/src/app/chat/[id].tsx`: the topic branch renders `TopicJoinView` instead of `ChatThread` + `ChatComposerDock` when the topic is public, not General and not joined. The condition also requires a known caller id, so a member never sees a wrong Join key while `me` loads.

**Mute and Leave (step 3)**
- `apps/mobile/src/components/chat/topic-mute-leave.tsx` (new): the board's bottom group — the 34 px bell tile with "Mute" and a 46×28 switch (on writes `mutedUntilFor('forever', new Date())`, off writes `null`, through `setChatPref`), then the red "Leave topic" row. The group is hidden on General and when the caller is not in the topic.
- `apps/mobile/src/components/chat/leave-topic-sheet.tsx` (new): the `PhoneLeave.dc.html` confirm in a `BottomSheet`. Public shows "You stop getting its messages. You can join again from {group}."; private shows "Someone in it has to add you back." Red Leave and Cancel, busy state.
- `apps/mobile/src/components/chat/topic-info-sheet.tsx`: renders `TopicMuteLeave` after the done row, removed the old private-only ghost Leave button (and the now-unused `isMember` prop), and changed `onLeave` to `onAskLeave` for the confirm.
- `apps/mobile/src/components/chat/topic-info-host.tsx`: owns `confirmingLeave`, closes the info sheet before presenting the leave sheet (the Add-sheet pattern, one native sheet at a time), and the existing `onLeave` now also closes the confirm on success; its failure text shows in the leave sheet.

No tests were added (UI-only, per the spec). Every file is under 400 lines.

### Checks run

- `pnpm install`: done, no errors (`Done in 17.8s`).
- `pnpm gate` (final run):
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (0.6s)
  PASS  lint  (0.7s)
  PASS  typecheck  (1.0s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/mobile  (2.1s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- Single test files: none. The task adds/changes no test files and the spec says UI gets no tests; the gate ran the mobile package's nearest tests anyway.
- I did not run a device/simulator smoke; the acceptance items above are verified against the code and the gate, not visually on a phone.

### Notes for the lead

- The join view builds its own production topics client (`createTopicsApi(getSessionToken, undefined, API_URL)`) because the store exposes topic actions but not its `topics` port. In `?mock=` mode the mock backend has no preview route, so that screen would show its load error with Retry; a real server is needed to see the preview. If you want mock coverage, the store would need to expose the port (outside this task's Allowed files).
- `TopicMuteLeave` also hides when `isTopicJoined` is false (e.g. the info sheet opened from the Join view), so a non-member never sees a Leave action that would fail. This is stricter than "hidden for General" but matches the board's In-this-topic sheet.
- Leaving a public topic uses the existing `removeTopicMember(chat.id, myUserId)` path, unchanged; the server already allows it.

### Round 2 (fix round)

Fixed the three should-fix findings from `PREREVIEW.md`; nits 4, 5 and 7 were left alone.

1. **Finding 2 — stale preview from the previous topic.** `topic-join-view.tsx` now tags every preview state with the `chat.id` it belongs to. A state tagged with another topic renders as `loading`, so an in-flight response for topic A can no longer paint A's messages under topic B's title even if it lands before the effect cleanup runs. Retry re-tags the state with the current topic.
2. **Finding 3 — payload rows rendered as blank bubbles.** The preview now validates the opaque `payload` against `PayloadSchema` and renders `PayloadCard` for the card types the thread draws (`isRenderedCard`: progress, approval.request, question, blocks), instead of always printing `item.body`. A row with an empty body and a non-card payload renders no text line rather than an empty paragraph; rows with a body and no rendered card are unchanged.
3. **Finding 6 — the mute switch lied under an inherited group mute.** The switch still reads the effective `chat.muted`, but the component now also reads the group's General row from the store. When the mute comes from the General row (`chat.muted` and the group General muted), the switch is disabled and shows a fixed line, "Muted for the whole group." — clearing the topic's own row cannot lift an inherited mute, so the control no longer accepts a write that would leave it ON. With the group unmuted the switch works exactly as before (`mutedUntilFor('forever')` on, `null` off).

**Tests:** none added. These three fixes are UI (React Native views), the spec's step 4 says "No tests (UI)", and the task's Allowed files contain no test path; AGENTS.md says UI code gets no tests and fixes outside the allowed scope are not permitted. No test file was changed.

**Checks:** `pnpm gate` from the repo root, final run after `prettier --write` on the two touched components:

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.1s)
PASS  lint  (0.9s)
PASS  typecheck  (3.2s)
PASS  effect  (0.5s)
PASS  tests @zilar/mobile  (2.5s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

Single test files run: none (no test changes; the gate ran the mobile package's nearest tests). The first gate run failed only on Prettier for `topic-join-view.tsx`; I ran Prettier on that file and re-ran the gate, which passed. No device smoke was run, same as round 1.

Commits: `T-1798: fix finding 2 - tag preview state with its topic id`, `T-1798: fix finding 3 - render payload cards in the join preview`, `T-1798: fix finding 6 - lock the mute switch under an inherited group mute` (plus a formatting-only commit for the state type).

### Round 3 (verification after the resumed session)

The session that started round 2 was interrupted by a quota error after it had committed the fixes. I re-read `PREREVIEW.md` and the two touched components, confirmed findings 2, 3 and 6 are the committed changes described above, and re-ran the gate on the clean tree.

- Findings fixed: 2 (stale cross-topic preview), 3 (payload rows rendered as cards), 6 (mute switch under an inherited group mute). No must-fix findings existed.
- Tests added: none, for the same reasons as round 2: the spec says "No tests (UI)", `AGENTS.md` says UI code gets no tests, and no test path is in the Allowed files.
- `pnpm gate` (repo root, clean tree):
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.8s)
  PASS  typecheck  (0.8s)
  PASS  effect  (0.4s)
  PASS  tests @zilar/mobile  (1.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- Single test files run: none (no test files changed).

### Round 4 (lead fix round, 2026-10-17)

Two changes, one commit each, as directed by the lead. Finding 6 was left as it is, per the lead.

1. **Finding 2 — stale preview on a topic switch.** `apps/mobile/src/app/chat/[id].tsx` now renders `<TopicJoinView key={chat.id} … />`, so a different topic remounts the view with fresh state. `topic-join-view.tsx` drops the old state-tagging reset and keeps the mounted topic id in a `useRef`; a preview result is applied only when it belongs to that id, so an in-flight response for the previous topic is ignored.
2. **Finding 3 — card rows.** The preview still validates `item.payload` against the protocol's `PayloadSchema` (the object counterpart of `decodePayload`) and only renders `isRenderedCard` types with `<PayloadCard>`. A `blocks` card now receives the HH:MM element as its footer instead of drawing a second time row below it. A row with an empty `body` and no drawable card is skipped instead of rendering a name/time-only bubble.

No tests added: the spec says "No tests (UI)", `AGENTS.md` says UI code gets no tests, and no test path is in the Allowed files.

`pnpm gate` from the repo root after Prettier on `topic-join-view.tsx`:

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (1.3s)
PASS  lint  (0.7s)
PASS  typecheck  (3.0s)
PASS  effect  (0.7s)
PASS  tests @zilar/mobile  (2.3s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

Single test files run: none (no test files changed). Commits: `T-1798: fix finding 2 - remount the join view per topic`, `T-1798: fix finding 3 - footer blocks cards and skip empty rows`.

### Disagreements

None. All three should-fix findings were real; nothing was skipped. Finding 6 remains in place by the lead's decision.

## Review (written by Claude)

Merged on code review. Checked on 2026-10-17:
- The packet matches HEAD `8dc3c2df0`, after 2 autopilot rounds and one lead round.
- **`topic-join-view.tsx`:**
  - remounts per topic (`key={chat.id}`) and guards the result by topic id;
  - draws card rows with `PayloadCard` and skips empty rows;
  - shows the Join key with busy and error states.
- **`topic-mute-leave.tsx`:**
  - Mute and Leave appear only for a member, never on General;
  - an inherited group mute locks the switch.
- **`leave-topic-sheet.tsx`** carries the board's texts.
- **Nit left:** a progress card in the preview sits in a bubble with a time row, unlike the thread.
- **The emulator check of the Join view** (mock "Dev team › Ideas", from T-1801) is still to do.


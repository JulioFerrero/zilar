---
id: T-1302
title: "Mobile batch 4: notification channels per chat kind with grouping per chat (MUX-23); double-tap a bubble to react with the first quick reaction (MUX-21, the double-tap part); the profile tab fallback uses an icon instead of '?' (MUX-33)"
status: merged
milestone: M5
branch: task/T-1302-mobile-notify-react
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1302: Mobile batch 4

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mobile-ux-audit.md`:
- **MUX-23** (P3, `:125`):
  - one notification channel, "Messages" (`apps/mobile/src/lib/push/native.ts`);
  - notifications post with no grouping (`apps/mobile/src/lib/push/background.ts`).
  - Telegram has separate channels for private chats, groups and channels.
- **MUX-21** (P3, `:127`): there's no double-tap to react on a bubble (`apps/mobile/src/components/chat/message-bubble.tsx`). The anchored-menu part of this finding is **out of scope**.
- **MUX-33** (P3, `:117`): the profile tab shows a literal "?" as its fallback (`apps/mobile/src/components/nav/floating-tab-bar.tsx`).

**First recheck each finding on main.** For any already fixed, say so with `file:line` and skip it.

### What to build
1. **MUX-23:**
   - **channels:** three Android channels, "Direct messages", "Groups" and "Channels", created where "Messages" is today. The existing channel id keeps working, or is migrated: say which;
   - **routing:** each notification posts on the channel for its chat kind, read from the push payload (cite the field). If the payload has no chat kind, use "Direct messages" for DMs and "Groups" otherwise, and list in the Report what the server would need to send;
   - **grouping:** group notifications per chat (Android `groupKey` / iOS `threadIdentifier`, whichever `expo-notifications` exposes; cite it).
   - **Out of scope:** inline reply.
2. **MUX-21:**
   - a double-tap on a bubble adds the first quick reaction (`QUICK_REACTIONS[0]` in `packages/chat-core/src/reactions.ts`), or removes it if I already reacted with it;
   - use `react-native-gesture-handler`'s `Gesture.Tap().numberOfTaps(2)` composed with the existing long-press so the long-press still opens the menu, with a Light haptic;
   - disabled for messages that can't be reacted to yet (no wire id; use the selector T-1287 adds if it's merged, otherwise the existing checks).
3. **MUX-33:** the "?" fallback becomes the lucide `UserRound` icon.
4. **No tests** (UI). Keep every file at most 400 lines.

### Read first
`AGENTS.md`, `docs/audit/mobile-ux-audit.md` (`:117-127`), `apps/mobile/src/lib/push/native.ts`, `apps/mobile/src/lib/push/background.ts`, `apps/mobile/src/components/chat/message-bubble.tsx` and `apps/mobile/src/components/nav/floating-tab-bar.tsx`.

### Allowed files
`apps/mobile/src/lib/push/*.ts`, `apps/mobile/src/components/chat/*.tsx`, `apps/mobile/src/components/chat/*.ts`, `apps/mobile/src/components/nav/floating-tab-bar.tsx`, `work/T-1302-mobile-notify-react.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the emulator:**
  - a double-tap on Marta's message adds 👍 (or the first quick reaction), and a long-press still opens the menu;
  - Settings → Apps → Zilar → Notifications lists the three channels.

---

## Report (written by the worker when done)

### Recheck of each finding on main (before the change)
- **MUX-23** still present: one channel `messages` (`apps/mobile/src/lib/push/native.ts:22-23`, created at `:187-190`) and posts with no group (`apps/mobile/src/lib/push/background.ts:26`, `:85-90`).
- **MUX-21** still present: the bubble's only gesture is `Pressable onLongPress` (`apps/mobile/src/components/chat/message-bubble.tsx:278-286`); no `numberOfTaps`/double-tap anywhere in `components/chat/`.
- **MUX-33** still present: literal `?` fallback (`apps/mobile/src/components/nav/floating-tab-bar.tsx:96`).

### What I did
**MUX-23 — channels + routing (grouping not possible, see deviations).**
- New `apps/mobile/src/lib/push/channels.ts`: the three channels `direct-messages`/"Direct messages", `groups`/"Groups", `channels`/"Channels", plus `channelForWake` and `parseChatKind`.
- `native.ts` creates the three channels (HIGH importance) before the permission prompt, then deletes the one legacy `messages` channel (`deleteNotificationChannelAsync`, best effort). **Migration choice: the old id is deleted, not kept.** Android channels are additive, so keeping `messages` would leave four in Settings; nothing user-side was configured on the single old channel, so deleting it loses nothing. The three new ids are what `background.ts` posts on.
- `background.ts` reads the kind from the wake payload field **`chatKind`** (`WakePayload.chatKind`, values `dm`|`group`|`channel`, parsed from the FCM data JSON) and posts on that channel; the test wake posts on the default channel.
- The server does **not** send the field today: `buildNativeWakePayload` (`apps/server/src/push/payload.ts:90-98`) emits only `{ chatId, messageId?, serverId }` (type `FcmWakeData`, `apps/server/src/push/fcm.ts:10-14`). Fallback when absent: **"Groups"**. See "What the server would need to send".
- Inline reply: out of scope, not touched.

**MUX-21 — double-tap to react.**
- New `apps/mobile/src/components/chat/bubble-gesture.tsx`: `BubbleGesture` wraps the bubble and adds `Gesture.Tap().numberOfTaps(2)` (`runOnJS`), calling the bubble's `onReact` with `QUICK_REACTIONS[0]` and a Light haptic. The core `react` toggles, so a second double-tap removes it. The gesture sits beside the bubble's existing long-press, so the long-press still opens the menu; it is disabled for a message with no wire id (a live draft, or still `sending`/`failed`) and in select mode.
- `message-bubble.tsx` wraps its bubble container with `BubbleGesture` (covers text, big-emoji and sticker bubbles). The file is exactly 400 lines.

**MUX-33 — profile tab fallback.** The `?` `Text` became the lucide `UserRound` icon at the same 20 px/`ICON` colour as the other tabs (`floating-tab-bar.tsx`).

### Deviations / limitations (honest)
1. **Grouping (MUX-23) is not implemented: `expo-notifications` (\(57.0.22\)) exposes neither `groupKey` (Android) nor a settable `threadIdentifier` (iOS) on the scheduling input.**
   - `NotificationContentInput` (the `scheduleNotificationAsync` content type) has no `threadIdentifier`: `apps/mobile/node_modules/expo-notifications/build/Notifications.types.d.ts:496-585`; `threadIdentifier` exists only on the read type `NotificationContent` (`:436`).
   - iOS would not apply it anyway: `NotificationContentRecord.toUNMutableNotificationContent()` never assigns `content.threadIdentifier` (`apps/mobile/node_modules/expo-notifications/ios/.../NotificationRecords.swift:338-389`).
   - The Android module has no notification `setGroup`: no `groupKey`/`setGroup` in `apps/mobile/node_modules/expo-notifications/android/`.
   So per-chat grouping needs a newer `expo-notifications` or a native config-plugin change; I did not fake it with a shared identifier (that replaces, not groups).
2. **The DM half of the routing fallback cannot be honoured client-side.** With no `chatKind` the client cannot tell a DM peer JID from a room JID: both are `local@domain`, and the room domain is server config (`XMPP_MUC_DOMAIN`, `apps/server/src/xmpp/config.ts:48`, default `rooms.zilar.localhost`), which the headless wake task does not have. The fallback therefore sends every kind-less wake to **"Groups"**; only an explicit `chatKind: 'dm'` reaches "Direct messages". I did not guess a JID heuristic.

### What the server would need to send
Add `chatKind: 'dm' | 'group' | 'channel'` to the FCM data in `buildNativeWakePayload` (`apps/server/src/push/payload.ts`) and `FcmWakeData` (`apps/server/src/push/fcm.ts`). The resolver already knows the kind: `resolveGroupCandidate` runs for rooms (`apps/server/src/push/candidates.ts:68-119`, `chatKind: 'channel'` when the group is a channel) and `resolveDmCandidate` for DMs (`:121-148`). The field name in the wake JSON must be `chatKind` and the values the three above. (The `push.preview` response would not need it: the wake carries it.)

### Commands run (real results)
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/push/background.test.ts src/lib/push/native.test.ts` → **2 files passed, 11 tests passed**.
- `pnpm gate` (from the repo root) summary lines:
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (6.5s)
  PASS  format  (2.6s)
  PASS  lint  (2.4s)
  PASS  typecheck  (1.8s)
  PASS  effect  (2.7s)
  PASS  tests @zilar/mobile  (5.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  `pnpm gate` ends with **GATE PASS** and no files outside the Allowed files.

### Files changed
`apps/mobile/src/lib/push/channels.ts` (new), `apps/mobile/src/lib/push/native.ts`, `apps/mobile/src/lib/push/background.ts`, `apps/mobile/src/lib/push/native.test.ts`, `apps/mobile/src/lib/push/background.test.ts`, `apps/mobile/src/components/chat/bubble-gesture.tsx` (new), `apps/mobile/src/components/chat/message-bubble.tsx`, `apps/mobile/src/components/nav/floating-tab-bar.tsx`, `work/T-1302-mobile-notify-react.md`.

### Open questions
- None blocking. The two deviations above are the calls I made on architecture; if the lead wants real per-chat grouping or the DM fallback, both need a server/native change outside this task's Allowed files.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (3 nits, 2 follow-ups).**
- **Lead's check on the emulator mock** (the smoke passes on retry; the first build failed, which happens):
  - a double-tap on Marta's "Great, let me know…" adds 👍 1;
  - a long-press still opens the menu (Reply, Copy text).
- **Channels:** created in `registerNativePush`, which doesn't run in mock mode, so I verified them in code (`native.ts:183-198`: the three channels are created and the legacy `messages` channel is deleted).
- **Follow-ups:**
  - the server sends no `chatKind` yet, so every wake posts on "Groups" → T-1303 (server adds `chatKind` to the push payload);
  - per-chat grouping needs an `expo-notifications` upgrade or native code; noted for later.
- **Lead's checks after the rebase:** mobile tsc: 0 errors. `message-bubble.tsx` is exactly 400 lines.

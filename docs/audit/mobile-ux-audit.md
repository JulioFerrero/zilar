# Mobile UX audit: how the Android app feels and flows

Date: 2026-10-11. Scope: `apps/mobile` (Expo SDK 57, expo-router, RN gesture-handler/reanimated) read against a Telegram-Android baseline. Code only, no device. Each item says **confirmed by code** or **suspected (check on device: …)**. Line numbers are from `main` at `54d08c1a6`.

Severity: P1 blocks or confuses a common flow, P2 friction users notice, P3 polish. Paths are repo-relative; `m/` = `apps/mobile/src/`, `cc/` = `packages/client-core/src/`.

## 1. Summary: top 15

| Id | Sev | What the user feels |
| --- | --- | --- |
| MUX-1 | P1 | Reading older messages is impossible: loading an older page, or any message arriving, yanks the list to the bottom. |
| MUX-2 | P1 | Opening a chat renders the whole loaded history at once and then scrolls five times; visible jump and slow open on long chats. |
| MUX-3 | P1 | A text message that failed to send shows the same clock as "sending" and has no Retry; the user never learns it failed. |
| MUX-4 | P1 | Typed text is lost when leaving a chat (no per-chat drafts). |
| MUX-5 | P1 | There is no Sign out anywhere in the app. |
| MUX-6 | P1 | After opening a chat from a notification or App Link on a cold start, the header back button does nothing and hardware back leaves the app. |
| MUX-7 | P1 | Opening the keyboard hides the latest messages behind it; the list is not re-pinned to the bottom. |
| MUX-8 | P2 | No jump-to-bottom button with an unread count. |
| MUX-9 | P2 | Scrolling the chat does not dismiss the keyboard, and the first tap on a message only closes the keyboard. |
| MUX-10 | P2 | Chat rows have no swipe actions (archive, mute, pin, read); everything is behind long-press. |
| MUX-11 | P2 | Tapping a DM or group header does nothing: no profile, no info, no mute/search menu. |
| MUX-12 | P2 | Contacts' profile photos never appear in chat rows or headers, only the ball avatar. |
| MUX-13 | P2 | Image viewer: laggy pinch (React state per frame), no pan when zoomed, no swipe-down to close, no swiping between photos, no save/share. |
| MUX-14 | P2 | Voice recording: no lock for hands-free, no haptics, a short press is discarded silently with no hint. |
| MUX-15 | P2 | Being offline or reconnecting is only shown on the chat list, never inside the chat you are typing in. |

Counts: P1 7, P2 13, P3 13 (33 findings).

## 2. Findings by area

### Scrolling and the message list

**MUX-1 (P1, confirmed by code). Scroll position is not kept.** `m/components/chat/use-message-list-scroll.ts:62-69` calls `scrollToEnd` whenever `visibleCount` grows, ignoring `atBottomRef`. Two consequences: (a) `m/components/chat/message-list.tsx:247-250` calls `loadOlder` when `contentOffset.y <= 24`, and `cc/store/history.ts:110-138` prepends the older page, so the count grows and the user is thrown to the newest message; (b) any incoming message while reading history does the same. The `FlatList` (`message-list.tsx:213-251`) has no `maintainVisibleContentPosition`. Telegram: prepending keeps the viewport anchored; a new message only scrolls when you are at the bottom, otherwise the jump button gets a badge. Fix: in `use-message-list-scroll.ts` compare the last entry key (not the count) and scroll only when `atBottomRef.current` or the new last message is mine; add `maintainVisibleContentPosition={{ minIndexForVisible: 0 }}` to the list.

**MUX-2 (P1, confirmed by code). Whole history rendered, then scrolled five times.** `message-list.tsx:219` sets `initialNumToRender={Math.max(entries.length, 1)}`; `use-message-list-scroll.ts:46-60` runs `scrollToEnd`/`scrollToIndex` at mount and at 80, 200, 400 and 700 ms. On a chat with a few hundred loaded messages this is a slow first paint and a visible jump. Telegram opens instantly at the bottom. Fix (same task as MUX-1): render the list `inverted` with reversed entries so the bottom is the natural start (no mount scrolls), keep the unread divider via `initialScrollIndex` on the divider index, drop the retry timers (`jump-scroll.ts` already handles search jumps).

**MUX-7 (P1, confirmed by code; check on device: open a chat at the bottom, focus the composer).** `message-list.tsx:236-241` re-pins only in `onContentSizeChange`; the keyboard changes the list's layout, not its content, so the last rows stay behind the keyboard. The `KeyboardAvoidingView` is `behavior="padding"` at `m/app/chat/[id].tsx:109,149,243`. Telegram keeps the last message visible when the keyboard opens. Fix: add `onLayout` to the list that calls `scrollToEnd({ animated: false })` while `atBottomRef.current` (goes away with the inverted list of MUX-2).

**MUX-8 (P2, confirmed by code).** No jump-to-bottom affordance: no `ArrowDown`/`ChevronDown` in `m/components/chat/`. Telegram shows a round button with the unread count as soon as you scroll up. Fix: `m/components/chat/jump-to-bottom.tsx` (new, ~60 lines) fed by `atBottomRef` plus a count of messages arrived since the user left the bottom; mount it in `chat-thread.tsx`.

**Unread divider works**: `message-list.tsx:155-157` fixes the divider index on open; `use-message-list-scroll.ts:51-53` scrolls to it. Date pills (`date-separator.tsx`) and typing indicators (`chat-header.tsx:50-54`, `chat-list-item.tsx:57-58`) work.

### Keyboard and composer

**MUX-9 (P2, confirmed by code).** `message-list.tsx:213-251` sets neither `keyboardDismissMode="interactive"` nor `keyboardShouldPersistTaps="handled"`, so dragging the list keeps the keyboard and the first tap on a bubble or Retry is swallowed. Settings screens already do it right (`m/components/settings/screen-shell.tsx:57-59`). Fix: two props on the list.

**MUX-4 (P1, confirmed by code).** The composer text is local state (`m/components/chat/composer.tsx:93`) and the chat route unmounts on back (`use-chat-screen.ts:96-106` opens/closes the chat); `state.drafts` is the AI draft stream (`m/lib/drafts.ts:1-11`), not user drafts. Telegram keeps a draft per chat and shows "Draft:" in red in the list. Fix: a `composerDrafts: Record<chatId, string>` slice in the store (`m/store/types.ts` + a small `m/store/effects/composer-drafts.ts`), seeded in `composer.tsx` by `chatKey`, previewed in `chat-list-item.tsx:117-121`.

**Works**: multiline growth capped at 8 lines (`composer-input-row.tsx:20-36`), mic/send swap on text (`composer-input-row.tsx:143-165`), reply and edit bars, mention picker, emoji/sticker/GIF sheet replacing the keyboard (`emoji-sheet.tsx:59-66`), sheet padding on Android edge-to-edge (`m/lib/use-keyboard-height.ts:32-39`).

**MUX-30 (P3, confirmed).** Edit mode keeps the `ArrowUp` icon (`composer-input-row.tsx:145-156`); only the a11y label changes. Telegram shows a check. Fix: `Check` icon when `editing`.

**MUX-20 (P2, suspected: check on device with a small phone).** Login, name and handle cards are centered in a `SafeAreaView` with no keyboard avoidance (`m/auth/AuthFlow.tsx:151-159`, `m/auth/NameForm.tsx:62`, `m/app/welcome/handle.tsx:138`); on edge-to-edge Android the keyboard can cover Continue. Fix: wrap the three in `KeyboardAvoidingView behavior="padding"` or a `ScrollView` with `automaticallyAdjustKeyboardInsets`.

### Sending, feedback and errors

**MUX-3 (P1, confirmed by code).** `m/components/chat/ticks.tsx:13-15` draws a clock for both `sending` and `failed`; the text meta (`message-bubble-content.tsx:51-90`) has no failure text ("Not sent" exists only in `BubbleMeta` for voice/cards, `message-bubble-decor.tsx:70-76`); the list exposes retries only for stickers, attachments and voice (`message-list.tsx:37-46`), none for text, and `cc/store/ledger-mutators.ts:98-104` does mark text sends `failed`. Telegram: red exclamation badge, tap → Retry / Delete. Fix: `ticks.tsx` returns a red `CircleAlert` for `failed`; `BubbleInlineMeta` prints "Not sent"; add `retryText(chatId, messageId)` to `cc/store/send.ts` (re-send the stored body) and a "Retry" row at the top of `message-actions-sheet.tsx` when `message.failed`.

**MUX-15 (P2, confirmed by code).** `connectionLabel` (`m/lib/connection.ts:7-16`) is rendered only in the chats list (`chat-list.tsx:65-69`); the chat header subtitle is `chatSubtitle` (`chat-header.tsx:53`). Telegram replaces the title with "Connecting…"/"Waiting for network…". Fix: read `state.status` in `chat-header.tsx` and show the label as the subtitle while not `online`.

**MUX-32 (P3, confirmed).** Errors are `DismissBanner`s stacked between list and composer (`chat-thread.tsx:126-145`), pushing the list up. Telegram uses transient toasts. Fix: one `m/components/ui/toast-host.tsx` (new) with auto-dismiss, used by the thread, pins and media sheets.

**MUX-22 (P3, confirmed).** Haptics exist only for swipe-to-reply (`swipe-to-reply.tsx:43-50`) and long-press (`message-bubble-actions.tsx:37-44`). Nothing on chat-row long-press (`chat-list-item.tsx:73`), reaction pick, send, voice start/cancel. Fix: `m/lib/haptics.ts` (one `tap()` helper, ~20 lines) called at those four points.

**Works**: optimistic bubbles and ticks; upload progress with % and Cancel (`attachment-message.tsx:154-158`, `voice-message.tsx:230-246`); skeletons after 250 ms (`skeleton.tsx:14-32`); pressed states via `active:` classes and `pressStyle`; Retry on failed sticker/attachment/voice; load errors with Retry (`load-error.tsx`).

### Navigation and flows

**MUX-5 (P1, confirmed by code).** `signOut` exists in the auth store (`m/auth/session.ts:56`, `m/auth/session-store.ts:149-163`) but no screen calls it (`rg signOut m/app m/components` → none). The settings hub (`m/app/(tabs)/settings.tsx:179-199`) and the Profile tab have no Sign out row. Fix: a "Sign out" `ListRow` + `ConfirmDialog` at the bottom of the hub, calling `useAuthStore().signOut()` then `router.replace('/login')`.

**MUX-6 (P1, suspected: check on device by tapping a push with the app killed).** `m/lib/push/tap.ts:21-23` pushes `/chat/[id]` on a cold start with no screen below it; `+native-intent.tsx:7` does the same for App Links. The header back is `router.back()` (`m/app/chat/[id].tsx:91`), a no-op with no history, and hardware back exits. Telegram always goes back to the chat list. Fix: a `goBackOrHome(router)` helper in `m/lib/navigation.ts` (`router.canGoBack() ? back() : replace('/')`) used by `chat/[id].tsx`, `group/[id].tsx:217`, `u/[handle].tsx:219`; or `router.replace('/')` then `push` in `tap.ts`.

**MUX-24 (P3, confirmed).** `apps/mobile/app.json:24` sets `predictiveBackGestureEnabled: false`, so Android 14+ users get no predictive back preview. Fix: enable it once MUX-6 is in.

**MUX-11 (P2, confirmed by code).** `chat-header.tsx:99-120` makes the title pressable only for topics (info sheet) and group rows (group screen); for DMs the title is inert and the "More" button renders only for topics (`chat-header.tsx:131-134`; the comment at `:33-37` admits "other chats have no menu yet"). Telegram: tap the header for the profile with mute, search, media, block. Fix: DM title → `router.push('/u/[handle]')` (the handle is on the contact; `u/[handle].tsx` already has block/unblock) and a `More` sheet reusing `chat-actions-sheet.tsx` (pin/mute/archive) for every kind.

**MUX-16 (P2, confirmed).** On a contact's profile, "Message" can fail with "No chat with them yet. Pull to refresh the chats list." (`m/app/u/[handle].tsx:203-213`), asking the user to work around the app. Telegram opens the chat at once. Fix: when the row is missing, call `reloadChats()` and push the chat id anyway; `chat/[id].tsx:31-45` already shows a skeleton while `chatsLoad === 'loading'`.

**MUX-29 (P3, confirmed).** The "+" menu (`new-chat-button.tsx:206-227`) offers channel, group, message, explore, join; a new topic is only reachable from a group screen FAB (`group-topic-list.tsx:102-112`). Fix: add "New topic" that opens a group picker, or leave as is if topics stay group-scoped.

**Works**: OTP sign-in with resend countdown and `textContentType="oneTimeCode"` (`AuthFlow.tsx:63-117`, `OtpInput.tsx:69-72`); invite prefill (`invite/[code].tsx`); name and handle steps with Skip; App Link mapping (`m/lib/web-link.ts:72-93`); notification tap routing while running (`tap.ts:39-50`); hardware back closes every sheet (`onRequestClose` in `action-sheet.tsx:43`, `bottom-sheet.tsx:39`, `emoji-sheet.tsx:102`, `attach-sheet.tsx:79`) and leaves select mode (`selection-bar.tsx:26-31`).

### Chat list

**MUX-10 (P2, confirmed by code).** Rows are plain `Pressable`s with `onLongPress` (`chat-list-item.tsx:67-74`, `chat-rows.tsx:26-41`); the only `Swipeable` in the app is `swipe-to-reply.tsx:53`. Telegram: swipe left for archive/mute/pin/delete, swipe right to read. Fix: wrap `ChatRow` in `ReanimatedSwipeable` with right actions calling the existing `useChatActions` pref writes (`use-chat-actions.ts`), new file `m/components/chat/chat-row-swipe.tsx`.

**MUX-12 (P2, confirmed by code).** `m/components/chat/avatar.tsx:18-30` takes no image URL and always draws `avatarSvg`; the only place a picture loads is the tab bar (`floating-tab-bar.tsx:122-137`). Users who upload a photo (`m/components/settings/use-profile-avatar.ts`) never see anyone else's. Telegram shows photos everywhere. Fix: `Avatar` accepts `avatarUrl` and renders `expo-image` with the ball as fallback (the `avatarImageSource` helper from `profile-logic.ts` already builds the bearer source); pass it from `ChatSummary` in `chat-list-item.tsx:76`, `chat-header.tsx:98`, `message-bubble.tsx:244`.

**Works**: search with `@handle` lookup (`search-header.tsx`), folder chips with counts (`folder-tabs.tsx`), pull-to-refresh (`chat-list.tsx:78-84`), long-press sheet with pin/mute durations/archive (`chat-actions-sheet.tsx`), unread and muted badges (`chat-list-item.tsx:26-45, 88-93`), archived section, typing and "writing…" previews.

**MUX-27 (P3, confirmed).** Empty states are one muted line: chats (`chat-list.tsx:99-103`), messages "No messages yet" (`message-list.tsx:206-209`), topics "No topics found" (`group-topic-list.tsx:75-79`). Telegram adds an illustration and a primary action. Fix: use `StateMessage` with `action` ("New message", "New topic") in the three places.

**MUX-28 (P3, confirmed).** No `refreshControl` on the topics list (`group-topic-list.tsx:63-98`). Fix: same `RefreshControl` pattern as `chat-list.tsx:78-84` wired to `refreshGroupDetail`.

### Media, camera and voice

**MUX-13 (P2, confirmed by code).** `attachment-message.tsx:335-381`: pinch writes `scale` through `setState` on every gesture event (`:350-352`, JS thread, visible lag), there is no pan translation, double-tap only resets to 1x (`:357-363`), the only close is a text button (`:317-325`), one image at a time, no save or share. Telegram: fluid pinch/pan, double-tap zoom in, swipe down to dismiss, swipe between media, save/share/forward. Fix: new `m/components/chat/image-viewer.tsx` (≤200 lines) on `react-native-reanimated` + `Gesture.Pinch/Pan/Tap` with shared values, a vertical pan that dismisses, a Share button via `expo-sharing`; later a pager over the chat's images from `media-sheet` data.

**MUX-14 (P2, confirmed by code).** Hold-to-record works (`voice-recorder.tsx:66-73`, slide-left cancel at `voice-recorder-gesture.ts:7` = 90 px) but: no lock to keep recording hands-free; no haptic on start/cancel; a press under `VOICE_MIN_MS` is "discarded silently" (`voice-recorder-flow.ts:116,131`, `voice-recorder.tsx:69-73`) where Telegram shows "Hold to record, release to send"; the hint uses the text glyph "‹" (`voice-recorder.tsx:256`) instead of an icon; the mic is a `View` with `PanResponder` (`:261-268`) so it has no pressed state. Fix: show a 1.5 s "Hold to record" tooltip on a short press; add `Haptics.impactAsync` at grant/cancel; replace "‹" with `ChevronLeft`; a slide-up lock (≈ -70 px dy) that keeps recording and swaps the row to Stop/Send is a second, larger task.

**Works**: picker with library/camera/file (`attach-sheet.tsx`, `attachment-picker.ts:86-176`), permission copy (`attachment-common.ts:11-18`), preview with size, upload progress, GIF-video inline, voice playback with speed and on-device transcription.

### Accessibility, text size and targets

**MUX-17 (P2, confirmed by code).** Targets under 44 dp: send key 36 dp with no `hitSlop` (`composer-input-row.tsx:144-156`); quick reactions 36 dp (`message-actions-sheet.tsx:84-98`); reaction chips about 22 dp tall (`reaction-chips.tsx:41-52`, `py-0.5`); search clear is a 16 px icon with no `hitSlop` (`search-field.tsx:50-52`); cancel-reply 36 wide (`composer-input-row.tsx:54-63`). `IconButton` is fine (40 dp + `hitSlop={8}`, `icon-button.tsx:28-29`). Fix: `hitSlop={8}` on the send key, clear and cancel-reply; `h-11 w-11` reactions; `py-1` and `hitSlop` on chips.

**MUX-18 (P2, suspected: check on device with font size "Largest").** Fixed heights with `numberOfLines={1}`: rows `h-[76px]` (`chat-list-item.tsx:74`), header `h-16` (`chat-header.tsx:94`), composer min/max 36/132 (`composer-input-row.tsx:20-21`), 10 px meta text; `Text` (`m/components/ui/text.tsx`) sets no `maxFontSizeMultiplier`. Fix: `minHeight` instead of `height` on rows and header; `maxFontSizeMultiplier={1.3}` on meta and badge text only.

**MUX-25 (P3, confirmed).** Message time is 10 px mono (`message-bubble-content.tsx:63,148`, `attachment-body.tsx:107-111`, `message-bubble-decor.tsx:69`) on `#8a8a8a`/`#525252`; Telegram uses about 12 sp. Fix: `text-[11px]`.

**Good**: 717 `accessibilityLabel/Role/Hint` attributes; every `IconButton` requires a label; live regions on skeletons and selection count; `useReducedMotion` honoured in skeletons, carets and key presses. Contrast: `#a1a1a1` and `#8a8a8a` on `#0a0a0a` (`m/global.css:22-33`) pass AA for body text.

### Theming, icons, copy

**MUX-31 (P3, confirmed).** Dark only by decision D24 (`app.json:9`, `m/app/_layout.tsx:66`, `StatusBar style="light"` at `:82`), consistent across screens. Many literal hexes remain (`message-bubble.tsx:164,317`, `chat-list-item.tsx:75,126`, `reaction-chips.tsx:50,58`, `floating-tab-bar.tsx:231-236`), so a light theme or custom chat backgrounds (planned) would need a token pass. No fix now; note for the backgrounds task.

**MUX-33 (P3, confirmed).** Icons: lucide everywhere, no emoji in chrome; emoji appear only as reactions and picker content (`QUICK_REACTIONS`, `packages/chat-core/src/reactions.ts:2`), which matches the owner's rule. Leftovers: "‹" (MUX-14) and a literal "?" for the profile tab fallback (`floating-tab-bar.tsx:89-91`). Fix: `UserRound` icon.

**MUX-26 (P3, confirmed).** Copy is mixed: "Couldn't load messages" (`message-list.tsx:204`) vs "Could not pin the message. Try again." (`chat-thread.tsx:85`) vs "Couldn't send. Retry" (`attachment-body.tsx:174`); "Muted: change" (`chat-actions-sheet.tsx:85`); only "Delete for everyone" with no delete-for-me (`message-actions-sheet.tsx:130-137`); "Chat not found" bare (`chat/[id].tsx:43`); "Message not found" (`chat-thread.tsx:141`). Telegram: short, one voice ("Couldn't…"), "Unmute"/"Mute…", "Delete" with a for-me/for-everyone choice. Fix: one `m/lib/copy.ts` with the shared strings and a pass over these six places.

### Android specifics

**MUX-19 (P2, confirmed by code).** `app.json:25-39` registers only `VIEW` intent filters; no `expo-share-intent` or `ACTION_SEND` handling, so Zilar is absent from the system share sheet. Telegram is a top share target. Fix: `expo-share-intent` plugin + a `/share` route that opens the forward sheet (`forward-sheet.tsx`) with the shared text/file.

**MUX-23 (P3, confirmed).** One channel "Messages" (`m/lib/push/native.ts:161-166`), posts with no `categoryIdentifier`/reply action and no grouping (`m/lib/push/background.ts:74-79`). Telegram: separate channels for private/group/channel, inline reply, mark-as-read. Fix: three channels keyed by chat kind, `setNotificationCategoryAsync` with a Reply action, `threadIdentifier`/`groupKey` per chat.

**MUX-21 (P3, confirmed).** The message menu is a fade-in `Modal` bottom sheet (`message-bubble.tsx:271-273` → `action-sheet.tsx:43-49`), not an anchored menu with the bubble lifted; no double-tap-to-react (no `numberOfTaps`/double-tap in `m/components/chat/`). Telegram: blurred backdrop, bubble stays in place, reactions row above it, double-tap = quick reaction. Fix later: measure the bubble (`measureInWindow`) and anchor the reactions row above it; add a `Gesture.Tap().numberOfTaps(2)` on the bubble that reacts with the first quick reaction.

**Works**: edge-to-edge insets on headers (`chat-header-bar.tsx:30`), composer (`composer.tsx:215`), sheets (`action-sheet.tsx:48`), tab bar (`floating-tab-bar.tsx:229`), FAB (`new-chat-button.tsx:196`); tab bar hides when the keyboard is open (`floating-tab-bar.tsx:212-222`); notification channel created before the permission prompt (`native.ts:161-169`).

## 3. Gesture and interaction table

| Interaction | Status | Evidence |
| --- | --- | --- |
| Swipe right to reply | works | `swipe-to-reply.tsx:52-72`, 60 px, haptic |
| Long-press message menu | works (sheet, not anchored) | `message-bubble.tsx:271-273`, 350 ms |
| Double-tap to react | missing | no double-tap handler in `m/components/chat/` |
| Tap reaction chip to toggle | works | `reaction-chips.tsx:41-52` |
| Pull-to-refresh, chats | works | `chat-list.tsx:78-84` |
| Pull-to-refresh, topics / settings lists | missing | `group-topic-list.tsx:63-98` |
| Swipe actions on chat rows | missing | `chat-list-item.tsx:67-74` |
| Long-press chat row menu | works, no haptic | `chat-rows.tsx:26-41`, `chat-actions-sheet.tsx` |
| Scroll up to load older | broken (jumps to bottom) | MUX-1 |
| Stay in place on new message | broken | `use-message-list-scroll.ts:62-69` |
| Open at newest / unread divider | works but flashes | `use-message-list-scroll.ts:46-60` |
| Jump-to-bottom button | missing | MUX-8 |
| Keyboard: composer above keyboard | works | `chat/[id].tsx:109,149,243` |
| Keyboard: dismiss on drag | missing | `message-list.tsx:213-251` |
| Keyboard: taps pass through | broken (first tap swallowed) | same |
| Keyboard: last message stays visible | broken | MUX-7 |
| Pinch-zoom in viewer | works, laggy, no pan | `attachment-message.tsx:350-363` |
| Swipe-down to close viewer / sheets | missing (tap outside only) | `attachment-message.tsx:317-325`, `action-sheet.tsx:44-48` |
| Swipe between media | missing | one image per viewer |
| Hold to record, slide to cancel | works | `voice-recorder-gesture.ts:42-61` |
| Lock recording | missing | MUX-14 |
| Android hardware back: sheets, select mode | works | `onRequestClose`, `selection-bar.tsx:26-31` |
| Hardware/header back after cold deep link | suspected broken | MUX-6 |
| Predictive back gesture | disabled | `app.json:24` |
| Share into Zilar | missing | MUX-19 |
| Notification tap → chat | works (warm), suspect (cold) | `tap.ts:39-50, 82-93` |

## 4. Fix plan (ordered by user impact, then size)

1. **Message list scroll model** (MUX-1, 2, 7, 8). Files: `m/components/chat/message-list.tsx`, `m/components/chat/use-message-list-scroll.ts`, new `m/components/chat/jump-to-bottom.tsx`, `m/components/chat/chat-thread.tsx`. Inverted list, `maintainVisibleContentPosition`, scroll only when at bottom or own message, jump button with count. No new tests (UI).
2. **Failed text sends** (MUX-3). Files: `cc/store/send.ts` (`retryText`), `m/store/types.ts`, `m/components/chat/ticks.tsx`, `message-bubble-content.tsx`, `message-actions-sheet.tsx`, `chat-thread.tsx`. One pipeline test for `retryText` (message pipeline is a test area).
3. **Sign out and safe back** (MUX-5, 6, 24). Files: `m/app/(tabs)/settings.tsx`, new `m/lib/navigation.ts`, `m/app/chat/[id].tsx`, `m/app/group/[id].tsx`, `m/app/u/[handle].tsx`, `m/lib/push/tap.ts`, `app.json`.
4. **Per-chat composer drafts** (MUX-4). Files: `m/store/types.ts`, new `m/store/effects/composer-drafts.ts`, `m/components/chat/composer.tsx`, `m/components/chat/chat-list-item.tsx`.
5. **Keyboard polish** (MUX-9, 20). Files: `message-list.tsx` (two props), `m/auth/AuthFlow.tsx`, `m/auth/NameForm.tsx`, `m/app/welcome/handle.tsx`.
6. **Header actions and connection state** (MUX-11, 15, 16). Files: `m/components/chat/chat-header.tsx`, `m/components/chat/chat-header-bar.tsx`, `m/app/chat/[id].tsx`, `m/app/u/[handle].tsx`; reuse `chat-actions-sheet.tsx`.
7. **Chat row swipes and haptics** (MUX-10, 22). Files: new `m/components/chat/chat-row-swipe.tsx`, `chat-rows.tsx`, new `m/lib/haptics.ts`, `chat-list-item.tsx`, `message-actions-sheet.tsx`, `voice-recorder.tsx`.
8. **Photos in avatars** (MUX-12). Files: `m/components/chat/avatar.tsx`, `chat-list-item.tsx`, `chat-header.tsx`, `message-bubble.tsx`, `group-list-item.tsx`; needs `avatarUrl` on `ChatSummary` (check `packages/chat-core/src/types.ts` first; an audit line if absent).
9. **Image viewer** (MUX-13). New `m/components/chat/image-viewer.tsx` on reanimated gestures; `attachment-body.tsx` swaps the import; `attachment-message.tsx` loses `ZoomableImage`.
10. **Targets, font scaling, copy, voice hints** (MUX-14 hint/haptic/icon, 17, 18, 25, 26, 33). Files: `composer-input-row.tsx`, `message-actions-sheet.tsx`, `reaction-chips.tsx`, `search-field.tsx`, `chat-list-item.tsx`, `chat-header.tsx`, `message-bubble-content.tsx`, `voice-recorder.tsx`, `floating-tab-bar.tsx`, new `m/lib/copy.ts`.

Later, separate specs: share intent (MUX-19), notification channels and reply action (MUX-23), voice lock (MUX-14), anchored context menu and double-tap react (MUX-21), empty-state CTAs and topics refresh (MUX-27, 28, 29).

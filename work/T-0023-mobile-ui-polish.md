---
id: T-0023
title: Mobile UI polish — Telegram additions, swipe-to-reply, haptics, switch to @galena/chat-core
status: review
milestone: M1
branch: task/T-0023-mobile-ui-polish
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0019, T-0022]
estimate: 1–2 days
---

# T-0023: Mobile UI polish

## Spec (written by Claude, do not edit)

### Goal
Bring the mobile app to the same Telegram level as the web app after T-0022. Implement **every item** in `docs/design/ui-style.md` §4, under "Added after the first screenshots (2026-09-27)", **including the mobile-only ones**: swipe right to reply, and a light haptic on long-press. Also fix T-0019's review findings, and **switch to the shared `@galena/chat-core`** instead of the duplicated helpers. Still mock data.

### Read first
- `AGENTS.md` (mandatory)
- `docs/design/ui-style.md`: the new subsection and the `--online` token
- `work/T-0019-mobile-chat-shell.md`: the Review findings 1–3
- `work/T-0022-web-ui-polish.md`: its Report, for how the web did each item. Match the behavior.
- `packages/chat-core/src/**` (shared: `isBigEmoji`, `splitLinks`, `unreadDividerIndex`, `groupMessages`, `initials`, etc.)
- `apps/mobile/**`

### Allowed files
- `apps/mobile/**`
- `pnpm-lock.yaml`

**Not allowed:** `packages/**` (use `chat-core` as it is; if it's missing something, ask in the Report) and `apps/web/**`.

### Allowed dependencies
- `expo-haptics`, `expo-clipboard` (install with `npx expo install`)
- `react-native-gesture-handler` and `react-native-reanimated`, already present with Expo, for the swipe gesture

### What to build
1. **Use `@galena/chat-core`:**
   - Add it as a workspace dependency.
   - Delete the duplicated helpers in `src/lib/` that it replaces, and their tests (chat-core has its own). Keep only mobile-specific code.
   - Move the mobile store to chat-core's `ChatSummary` / `UiMessage` types.
2. **The T-0019 findings:**
   - the green online dot (the `--online` token)
   - mute icon spacing
3. **The new-chat button menu** ("New group" / "New message" → a "Coming soon" sheet), with the existing floating pencil button.
4. **Unread divider** in Ana's chat. Opening it scrolls to the divider.
5. **Typing** in the list and the header, with mock timings like the web (Ana, and "Luis is typing…" in Viernes).
6. **Long-press** a bubble → a light haptic → an action sheet or menu with Reply, Copy (expo-clipboard) and Delete (disabled).
7. **Swipe right on a bubble to reply:**
   - A reply arrow icon appears as you drag.
   - Past about 60 px, a light haptic, and releasing sets the reply.
   - Use `react-native-gesture-handler` + reanimated.
8. **The reply bar** above the composer, with `×` to cancel. The sent bubble shows the quote.
9. **Big emoji:** no bubble, about 48 px, a time pill. **Hide the sender name** above big emoji (Telegram style, from the T-0022 review).
10. **Safe links:** http/https only, through `splitLinks`, opened with `Linking.openURL`. Other schemes stay plain text.

### Tests (Vitest, pure logic)
- The store: typing timers (fake timers), reply state, unread divider position through chat-core.
- A test that the link-opening helper refuses non-http(s) URLs.

### Visual check (iOS simulator)
- Build with `npx expo run:ios --no-bundler`. Start Metro in the background, and **stop it** at the end.
- Screenshots in `apps/mobile/screenshots/` (replace the old ones where relevant):
  - `chats-light.png` (typing in the list, green dot, mute spacing)
  - `chat-ana-light.png` (unread divider)
  - `chat-viernes-dark.png` (typing header, big emoji)
  - `chat-reply-light.png` (reply bar active)

  To get the reply-bar screenshot you may add a **dev-only** mock flag. Remove any temporary redirect hacks before committing.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` pass for the whole repo.
- [ ] No duplicated helpers left in `apps/mobile/src/lib` that chat-core provides.
- [ ] Every screenshot committed. No Metro left running.
- [ ] Only allowed files touched.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### Out of scope
- Real data (mobile wiring comes after T-0024), push notifications, voice recording.

---

## Report (written by the worker when done)

### What I did

Implemented every item in `docs/design/ui-style.md` §4 "Added after the first screenshots (2026-09-27)" on mobile, fixed the T-0019 findings, and moved the app onto `@galena/chat-core`.

1. **`@galena/chat-core`.** Added it as a workspace dependency and switched the store, mock data and components to its `ChatSummary` / `UiMessage` types (`createdAt` and `lastSeenAt` are `Date`, `replyTo` is `ReplyRef`). Deleted the duplicated helpers and their tests: `lib/time.ts`, `lib/avatar.ts`, `lib/grouping.ts`, `lib/preview.ts` (and the four test files). `chat-core` had everything needed, so nothing was missing and I did not touch `packages/**`. `lib/types.ts` now holds only the mobile constants (`CURRENT_USER_ID`, `CURRENT_USER_NAME`, `ChatFolder`) and re-exports the shared types.
2. **T-0019 findings.** Added the `--online` token (light + dark) and mapped it to `online` in `tailwind.config.js`; the avatar dot is now `bg-online` (green). The mute icon sits in a `View className="ml-4"` (16 px) so the gap actually applies (a `className` on the lucide icon did not).
3. **New-chat button menu.** `NewChatButton` (mobile) keeps the floating pencil and opens a menu with **New group** / **New message**; each opens a "Coming soon" sheet with a Close button. No `alert`/`confirm`.
4. **Unread divider.** `MessageList` computes the position with `chat-core`'s `unreadDividerIndex` at mount (before `openChat` clears unread), renders `UnreadDivider` ("Unread messages") above the first unread message and scrolls to it instead of the bottom. Ana (unread 2) shows it.
5. **Typing.** The store has `typing: Record<chatId, { names: string[] }>` and a mock simulation (Ana and Viernes 🍻 after 2 s, cleared 4 s later, same as the web). The list preview and the header show `typing…` / `Luis is typing…` in accent with animated dots (`TypingDots`, RN `Animated`).
6. **Long-press actions.** Long-pressing a bubble (or big emoji) fires a light `expo-haptics` impact and opens `MessageActionsSheet` with **Reply**, **Copy text** (`expo-clipboard`) and **Delete** (disabled).
7. **Swipe right to reply.** `SwipeToReply` uses `react-native-gesture-handler`'s `ReanimatedSwipeable` + reanimated: a reply arrow fades/scales in as you drag, `leftThreshold` is 60 px, passing it fires a light haptic, and releasing sets the reply. The app root is wrapped in `GestureHandlerRootView`.
8. **Reply bar.** The composer shows the bar (colored left bar, "Reply to {name}" in accent, one-line excerpt, `×` to cancel). Sending calls `sendText(chatId, text, { replyTo })` and the new bubble renders the quote.
9. **Big emoji.** `isBigEmoji` from `chat-core`; such messages render without a bubble at 48 px with a time pill, and the sender name is hidden above them (T-0022 review).
10. **Safe links.** `LinkText` uses `chat-core`'s `splitLinks`; only `http`/`https` targets pass `safeLinkTarget` and open with `Linking.openURL`. Other schemes stay plain text.

Tests added: `lib/format.test.ts` (7: `formatLastSeen`, `typingLabel`, `replyRef`), `lib/links.test.ts` (2: the link helper refuses `javascript:`/`data:`/`vbscript:`/`file:`/bare `www`), and store cases for typing timers, `replyTo` on send, and the unread divider position through `chat-core` (8 total).

### Files changed

All under `apps/mobile/**` plus `pnpm-lock.yaml`.

- New: `src/lib/format.ts` (+test), `src/lib/links.ts` (+test); `src/components/chat/typing-dots.tsx`, `new-chat-button.tsx`, `message-actions-sheet.tsx`, `swipe-to-reply.tsx`, `link-text.tsx`, `unread-divider.tsx`.
- Deleted: `src/lib/{time,avatar,grouping,preview}.ts` and their `.test.ts`.
- Modified: `package.json` (`@galena/chat-core`, `expo-haptics`, `expo-clipboard`), `tailwind.config.js`, `src/global.css`, `src/app/_layout.tsx`, `src/app/index.tsx`, `src/app/chat/[id].tsx`, `src/lib/{types,chat,image-presets}.ts`, `src/mock/{time,messages}.ts`, `src/store/chat-store.ts` (+test), `src/components/chat/{avatar,chat-header,chat-list-item,composer,date-separator,message-bubble,message-list,reply-quote,voice-message}.tsx`, `README.md`.
- Screenshots: added `chats-light.png`, `chat-ana-light.png`, `chat-viernes-dark.png`, `chat-reply-light.png`; deleted the four stale T-0019 shots (`chats-dark.png`, `chat-light.png`, `chat-dark.png`, `chat-ai-cards-light.png`).

### Commands run and real results

- `pnpm install` → PASS ("Done in 9.2s", 902 packages).
- `npx expo install expo-haptics expo-clipboard` (in `apps/mobile`) → installed `expo-haptics@~57.0.3`, `expo-clipboard@~57.0.2` (SDK 57 compatible).
- `pnpm format:check` → PASS ("All matched files use Prettier code style!").
- `pnpm lint` → PASS ("Found 0 warnings and 0 errors", 218 files, 127 rules).
- `pnpm typecheck` → PASS (8 successful, 8 total).
- `pnpm test` → PASS (8 tasks successful). `@galena/mobile` **23 passed** (5 files); `@galena/protocol` 132 passed; the rest unchanged.
- `pnpm build` → PASS (2 successful; mobile `expo export` wrote the iOS and Android Hermes bundles, `Exported: dist`).
- `npx expo run:ios --no-bundler --device "iPhone 17 Pro"` → **BUILD EXIT: 0** (Build Succeeded; new native modules autolinked).
- Metro started separately (watch mode), the app bundled and launched on the iPhone 17 Pro simulator, screenshots taken, then Metro stopped: `lsof -ti tcp:8081` → port 8081 free, no `expo start` process left.

### Screenshots

In `apps/mobile/screenshots/` (iPhone 17 Pro, 1206×2622):

- `chats-light.png` — chat list, light: `typing…` (Ana) and `Luis is typing…` (Viernes) in accent with dots, green online dot on Ana, mute icon 16 px from "Neighbors", unread badges, new-chat pencil.
- `chat-ana-light.png` — Ana, light: the **Unread messages** divider above the first unread message, scrolled into view; header shows `typing…`.
- `chat-viernes-dark.png` — Viernes 🍻, dark: `Luis is typing…` header, **big emoji** `🥳🥳` without a bubble and with a time pill, no sender name above it; voice message, reply quote, image.
- `chat-reply-light.png` — Viernes 🍻, light: the **reply bar** active ("Reply to Ana" + excerpt + `×`) above the composer.

### Problems, deviations from the spec, open questions

1. **Gestures were not interactively exercised.** `simctl` has no touch injection, so I could not swipe or long-press in the simulator. I verified the gesture code compiles, builds and that the `ReanimatedSwipeable` tree mounts and lays out correctly (the chat screenshots render every bubble through it), but the actual swipe threshold, the haptic and the long-press sheet were not tapped by hand. Please exercise them on device/simulator; if anything feels off I can adjust the thresholds.
2. **Screenshots used temporary hacks, all reverted.** To reach the chat screens I pointed `src/app/index.tsx` at a `<Redirect>`; to hold the reply bar open I set a temporary initial `replyTo` in `chat/[id].tsx`; to make typing visible I temporarily widened `TYPING_START_MS`/`TYPING_DURATION_MS`. All three are restored to the real values (grep confirms no `Redirect` and the 2000/4000 timings) and the final `pnpm test`/`build` ran on the restored code.
3. **Mobile-only helpers kept.** `chat-core` has no `formatLastSeen`, so `lib/format.ts` keeps it plus `typingLabel` and `replyRef` (the web app has the same split in `apps/web/src/lib/format.ts`). `lib/chat.ts` keeps `chatSubtitle` and `formatMoney`; `lib/filter.ts`, `lib/colors.ts`, `lib/image-presets.ts` and `lib/protocol.ts` are mobile-specific and stayed.
4. **`lib/protocol.ts` (`protocolLabel`) is unused** (it was already only covered by a test in T-0019). I left it untouched as it is outside this task's scope; say the word and I'll remove it.
5. **Old screenshots deleted.** The T-0019 shots showed the pre-T-0023 UI (blue online dot, no new features), so I removed them and committed only the four the spec lists. Happy to re-shoot the dark list or the AI cards if you want them back.
6. **No new questions / blockers.**

---

## Review (written by Claude)

**Verdict:**

### Findings
-

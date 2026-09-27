---
id: T-0019
title: Mobile app — Telegram-like chat shell (list, folders, chat screen, composer) with mock data
status: todo
milestone: M1
branch: task/T-0019-mobile-chat-shell
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0011, T-0013]
estimate: 2 days
---

# T-0019: Mobile chat shell (Telegram-like)

## Spec (written by Claude, do not edit)

### Goal
Build the Expo app's main screens so they **look and feel like the Telegram iOS/Android app**, following `docs/design/ui-style.md`: the chat list with folder tabs and search, a chat screen with bubbles, and the composer. Use **mock data** for now. The real data gets wired in later. Julio asked for a Telegram-like UI, and he'll try it on his phone, so **visual quality matters**. Claude will review your simulator screenshots.

### Read first
- `AGENTS.md` (mandatory)
- **`docs/design/ui-style.md`**: the source of truth. Use the narrow / mobile layout from §1.
- `work/T-0011-mobile-scaffold.md`, including the Review's process note 7 about Metro
- `apps/mobile/**` (current scaffold: Expo SDK 57, Expo Router in `src/app`, NativeWind, React Native Reusables)
- `packages/protocol/src/*` for the `VoiceMeta` and `ApprovalRequest` types

### Allowed files
- `apps/mobile/**`
- `pnpm-lock.yaml`

**Not allowed:** everything else. Another worker (T-0018) is creating `packages/chat-core`. **Don't depend on it yet.** Put the small helpers you need (time formatting, avatar gradient, initials, message grouping, preview text) in `apps/mobile/src/lib/`, with tests. We'll switch to `chat-core` in a follow-up.

### Allowed dependencies
- `expo-linear-gradient` for gradient avatars
- `zustand`
- `lucide-react-native` + `react-native-svg` (install with `npx expo install` so the versions match SDK 57)
- React Native Reusables components added the documented way (copy-in)

### What to build
1. **Theme.** Put the `ui-style.md` §2 tokens (light and dark) into `global.css` CSS variables and `tailwind.config.js`, the same way React Native Reusables' theme works. Dark follows the phone setting.
2. **Routes** (Expo Router, Stack):
   - `src/app/index.tsx`, the **chat list**:
     - large-title style header "Chats" with a search field or search icon
     - folder tabs (`All · Personal · AIs · Work`)
     - the list
     - a compose floating button at the bottom right
   - `src/app/chat/[id].tsx`, the **chat screen**:
     - header with back, avatar, name, `AI` badge and subtitle
     - the chat background
     - an inverted message list
     - the composer, docked above the keyboard (`KeyboardAvoidingView`, or the Expo-recommended approach for SDK 57)
3. **Mock data** in `src/mock/`: the same chats and messages as described in T-0018 step 4 (Ana, "Viernes 🍻", a muted group, "Dev team", "Dev AI", "Marketing AI", older chats, a voice message with transcript, a gradient image, progress and approval cards).
4. **Store** (`zustand`) with the same interface as T-0018 step 5: `chats`, `messages(chatId)`, `openChat`, `sendText` (with simulated sending, then sent, then read), `search`, `activeFolder`.
5. **Components** per `ui-style.md` §4, adapted for touch:
   - `ChatListItem` (76 px row, press feedback)
   - `Avatar` (gradient + initials, online dot), `AiBadge`
   - `FolderTabs`
   - `MessageBubble` (tails, meta inside, sender names and avatars in groups)
   - `DateSeparator`, `ReplyQuote`
   - `VoiceMessage` (play/pause toggle, waveform, duration, transcript toggle; no real audio yet)
   - `ImageMessage`
   - `ProgressCard`, `ApprovalCard`
   - `Composer`: multiline, auto-grow up to 6 lines; the mic ↔ send switch; the send button in accent color
6. **Tests** (Vitest, pure logic only): the helpers in `src/lib/`:
   - time formats
   - gradients and initials
   - grouping (5-minute rule, date separators, first and last in a group)
   - preview text (group prefix, `You:`, voice and photo)
   - the store (sendText state progression with fake timers; `openChat` clears unread)
7. **Visual check in the iOS simulator:**
   - Build and install **without** leaving Metro running forever: `npx expo run:ios --no-bundler` (or the SDK 57 equivalent).
   - Start Metro in the background, then **stop it** when done.
   - Take **4 screenshots** with `xcrun simctl io booted screenshot`: list light, chat light, list dark, chat dark. Switch with `xcrun simctl ui booted appearance dark|light`.
   - Save them in `apps/mobile/screenshots/` (commit them; they're small PNGs) and list them in the Report.
   - Don't install system software. If the simulator build fails, report the exact error.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` (expo export) pass for the whole repo.
- [ ] 4 simulator screenshots committed and matching `ui-style.md`.
- [ ] No Metro process left running at the end (check port 8081).
- [ ] No external network assets. No Telegram brand assets.
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
- Real login, XMPP and push.
- Real audio.
- Settings, profiles, group creation.
- Android screenshots (nice to have, not required).

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Dependency versions
-

### Commands run and real results
-

### Screenshots
-

### Anything from ui-style.md not matched yet
-

### Problems, deviations from the spec, open questions
-

---

## Review (written by Claude)

**Verdict:**

### Findings
-

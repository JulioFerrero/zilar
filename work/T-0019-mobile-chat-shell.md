---
id: T-0019
title: Mobile app — Telegram-like chat shell (list, folders, chat screen, composer) with mock data
status: merged
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

Built the Telegram-like mobile shell from `docs/design/ui-style.md` (narrow/mobile layout) with mock data:

1. **Theme.** Rewrote `src/global.css` with every §2 token as CSS variables (light + dark, `.dark:root`
   like RNR), added the extra tokens (`--chat-background*`, `--bubble-in/out`, `--bubble-*-meta`,
   `--list-hover`, `--list-active`, `--badge-muted`, `--divider`, `--danger`) and mapped them in
   `tailwind.config.js` (hex vars, not HSL). `shadcn` names are aliased: `--primary`/`--accent` are
   the Galena accent, `--muted`/`--secondary` the list-hover grey.
2. **Routes.** `src/app/index.tsx` (chat list: large "Chats" title, search icon that opens an inline
   search field, `FolderTabs`, 76 px rows, compose FAB) and `src/app/chat/[id].tsx` (header with back,
   avatar, name + `AI` badge and subtitle; chat-background gradient; inverted grouped list; composer
   docked with `KeyboardAvoidingView`).
3. **Mock data** in `src/mock/` (10 chats, exactly the T-0018 step 4 cast: Ana unread+online,
   "Viernes 🍻", a muted group with a grey badge, "Dev team", "Dev AI" working, "Marketing AI" idle,
   older chats). Rich histories (16/10/10/9… messages over several days) with grouped messages,
   replies, a voice note with waveform + transcript, gradient "photos", `progress` cards and an
   `approval.request` card. Both cards are parsed through `PayloadSchema`, so the mock is valid.
4. **Store** (`src/store/chat-store.ts`): zustand behind the T-0018 interface (`chats`,
   `messages(chatId)`, `openChat`, `sendText`, `search`, `activeFolder`). `sendText` appends as
   `sending`, then `sent` at 300 ms and `read` at 1.5 s (keeps the chat's `lastMessage` in sync);
   `openChat` clears unread.
5. **Components** per §4, touch-adapted: `ChatListItem` (76 px, press feedback, grey/accent badge,
   ticks), `Avatar` (7 gradients + initials + online dot), `AiBadge`, `FolderTabs`, `ChatHeader`,
   `MessageBubble` (SVG tails, meta inline in the bubble, sender name in the sender's color, avatar
   beside the last bubble of a group), `DateSeparator`, `ReplyQuote`, `VoiceMessage` (simulated
   play/pause + progress, waveform, duration, Aa transcript toggle), `ImageMessage` (gradient),
   `ProgressCard`, `ApprovalCard` (Approve/Deny log to the console), `Composer` (auto-grow 1–6 lines,
   mic ↔ send, 56 px accent button) plus RNR copy-ins `Button` and a small `IconButton`.
6. **Tests** (Vitest, pure logic): time formats (incl. midnight, year change), gradients/initials,
   grouping (5-minute rule, one date separator per day, first/last), preview text (group prefix,
   `You:`, voice, photo, card fallback), folder/search filtering and unread counts, and the store
   (`sendText` progression with fake timers, empty text, `openChat` clears unread).
7. **Visual check:** built and installed with `npx expo run:ios --no-bundler`, started Metro
   separately, took 4 required screenshots (list/chat × light/dark) plus one extra (AI cards) with
   `xcrun simctl io booted screenshot` and `xcrun simctl ui booted appearance`, then stopped Metro.

### Files changed

- `apps/mobile/src/global.css`, `apps/mobile/tailwind.config.js` — theme tokens.
- `apps/mobile/src/app/index.tsx` — chat list (rewritten).
- `apps/mobile/src/app/chat/[id].tsx` — chat screen (new route).
- `apps/mobile/src/components/ui/button.tsx` (RNR copy-in), `apps/mobile/src/components/ui/icon-button.tsx`.
- `apps/mobile/src/components/chat/`: `ai-badge.tsx`, `avatar.tsx`, `ticks.tsx`, `chat-list-item.tsx`,
  `folder-tabs.tsx`, `chat-header.tsx`, `date-separator.tsx`, `reply-quote.tsx`, `voice-message.tsx`,
  `image-message.tsx`, `progress-card.tsx`, `approval-card.tsx`, `payload-card.tsx`,
  `message-bubble.tsx`, `message-list.tsx`, `composer.tsx`.
- `apps/mobile/src/lib/`: `types.ts`, `colors.ts`, `color-scheme.ts`, `time.ts`, `avatar.ts`,
  `grouping.ts`, `preview.ts`, `filter.ts`, `chat.ts`, `image-presets.ts` (+ `.test.ts` for time,
  avatar, grouping, preview, filter).
- `apps/mobile/src/store/chat-store.ts` (+ `.test.ts`).
- `apps/mobile/src/mock/`: `chats.ts`, `messages.ts`, `time.ts`, `index.ts`.
- `apps/mobile/screenshots/` — 5 PNGs.
- `apps/mobile/README.md` — screens/layout + the `react-native-css-interop` pin note from T-0011's review.
- `apps/mobile/package.json`, `pnpm-lock.yaml` — the four allowed dependencies.
- `work/T-0019-mobile-chat-shell.md` — status + this Report.

Nothing outside the allowed files. `apps/mobile/ios/`, `android/`, `dist/`, `.expo/` and
`expo-env.d.ts` exist locally and stay git-ignored (`git check-ignore` confirms).

### Dependency versions

- `expo-linear-gradient` `~57.0.2`, `react-native-svg` `15.15.4` (installed with `npx expo install`,
  so they match SDK 57), `lucide-react-native` `^1.48.0` (same command).
- `zustand` `5.0.15` (`pnpm --filter @galena/mobile add zustand`).
- React Native Reusables: no npm package; copied `Button` from the `nativewind` registry
  (`https://reactnativereusables.com/r/nativewind/button.json`), rewired to `@/components/ui/text`
  and `@/lib/utils`. The existing RNR `Text` was reused.

### Commands run and real results

- `pnpm install` → PASS ("Lockfile is up to date", "Already up to date", "Done in …").
- `pnpm format:check` → PASS ("All matched files use Prettier code style!").
- `pnpm lint` → PASS ("Found 0 warnings and 0 errors", 101 files, 127 rules).
- `pnpm typecheck` → PASS (turbo "6 successful, 6 total").
- `pnpm test` → PASS (turbo "6 successful, 6 total"; mobile **48 tests in 7 files**).
- `pnpm build` → PASS (turbo "2 successful, 2 total"; mobile `expo export` wrote the iOS and Android
  Hermes bundles — 3631/3721 modules — plus 34 assets, `Exported: dist`).
- `cd apps/mobile && npx expo run:ios --no-bundler` → **Build Succeeded** (0 errors, 1 duplicate-`-lc++`
  warning; Xcode 26.6, iOS 26.5, iPhone 17 Pro), installed and launched.
- Metro started separately; logs show `iOS Bundled … (3793 modules)`, no runtime errors.
- Metro stopped afterwards; `lsof -ti tcp:8081` → port 8081 free, no `expo start` process left.

### Screenshots

In `apps/mobile/screenshots/` (1206×2622, iPhone 17 Pro):

- `chats-light.png` — chat list, light.
- `chats-dark.png` — chat list, dark.
- `chat-light.png` — "Viernes 🍻" chat, light (sender names/avatars, reply quote, voice message,
  gradient photo, ticks).
- `chat-dark.png` — same chat, dark.
- `chat-ai-cards-light.png` — **extra** (not required): "Dev AI" with progress cards and the approval
  card with Approve/Deny.

### Anything from ui-style.md not matched yet

- Web-only rules are intentionally absent: `Esc`/`Ctrl/Cmd+K`, Enter/Shift+Enter, hover states, the
  desktop "Select a chat…" pill and the selected accent row.
- The header's `AI · working…` is static (no animated dots); the mobile spec only asks for the text.
- Voice playback is simulated (progress bars move, no audio), as specified.
- The scroll-to-bottom "↓" button is not built (mobile spec lists it under the web components; the
  list already auto-scrolls to the newest message).
- Android screenshots not taken (out of scope).
- Transcript, search filtering and folder filtering are implemented but not visible in the committed
  screenshots.

### Problems, deviations from the spec, open questions

1. **How the chat screenshots were taken.** `xcrun simctl openurl booted galena://chat/…` raises an
   iOS "Open in Galena?" confirmation that `simctl` cannot tap and System Events key events did not
   dismiss. To capture the chat screens I temporarily pointed `src/app/index.tsx` at a `<Redirect
   href="/chat/viernes" />`, took the shots, then restored the real list screen (the committed
   `index.tsx` is the real one; `git diff` shows only the intended list implementation).
2. **Two bugs found from the screenshots and fixed:** `groupMessages` inserted a date separator per
   group instead of per day (duplicate React keys + repeated "Today/Yesterday"); and the voice
   waveform used `flex-1` inside a content-sized bubble, so the `Aa` button overlapped the bars. Both
   now have regression tests / fixed layout.
3. **ChatSummary additions.** T-0018's `chat-core` type is not available yet, so `src/lib/types.ts`
   mirrors it and adds three UI fields: `lastSeenAt`, `onlineCount` and `aiStatus` (needed for the
   header subtitle). When `@galena/chat-core` lands, these should move there.
4. **Chat background gradient.** The light theme is a two-stop gradient; a single CSS variable can't
   express that, so `global.css` defines `--chat-background-from/-to` for reference while the
   gradient stops used by `expo-linear-gradient` live in `src/lib/colors.ts` (same hex values).
5. **Online dot color.** ui-style.md maps "online" to `--accent`, so the dot is blue, not Telegram's
   green; I followed the spec.
6. **`messages(chatId)`** returns a shared empty array when a chat has no messages, so the zustand
   selector keeps a stable identity and doesn't re-render in a loop.
7. The `ApprovalCard` Approve/Deny buttons and the list's compose FAB only `console.log` for now
   (placeholders, like the web task).

No blockers. Open question: if you'd rather the 4 committed screenshots show different chats (e.g.
Dev AI for the AI cards instead of the extra file), say so and I'll re-shoot.

---

## Review (written by Claude)

**Verdict: approved.** Merged by Claude.

This is excellent, faithful Telegram-like work, and the screenshots are the proof.

### What I verified myself (on commit fb3b0f7)
- `install`, `format:check`, `lint`, `typecheck`, `test` (mobile **48**) and `build` (expo export): all PASS.
- Only `apps/mobile/**` and the lockfile changed. No Metro left running (port 8081 is free).
- I reviewed all 5 screenshots (list light and dark, chat light and dark, AI cards). They match `docs/design/ui-style.md`:
  - folder tabs with counts
  - gradient avatars with initials
  - `AI` badges
  - unread badges, including grey for muted chats
  - ✓ / ✓✓ ticks, the compose button
  - bubbles with tails, sender names colored per sender
  - the voice waveform with the `Aa` transcript button, reply quotes, the image with a time pill
  - the mic ↔ send composer
  - the night-blue dark theme
  - progress and approval cards
- Finding two real bugs from your own screenshots (duplicate date separators, the waveform overlapping the transcript button) and adding regression tests: great practice.

### Findings (small; collected for Julio's first feedback round, not blocking)
1. The online dot is accent blue. `ui-style.md` says green.
2. The mute icon is too close to the chat name ("Neighbors🔇").
3. `src/lib/*` duplicates `@galena/chat-core` (T-0018). Switch to it in the wiring task, and move `aiStatus` / `onlineCount` / `lastSeenAt` into `chat-core`'s `ChatSummary`. T-0018 added the same three fields, so they're consistent.
4. The temporary `<Redirect>` trick for screenshots was reverted correctly. Deep-link screenshots will be easier once real navigation state exists.

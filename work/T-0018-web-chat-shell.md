---
id: T-0018
title: Web app — Telegram-like chat shell (list, folders, chat view, composer) with mock data
status: changes-requested
milestone: M1
branch: task/T-0018-web-chat-shell
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0013]
estimate: 2 days
---

# T-0018: Web chat shell (Telegram-like)

## Spec (written by Claude, do not edit)

### Goal
Build the web app's main screens so they **look and feel like Telegram**, following `docs/design/ui-style.md` exactly: chat list with folder tabs and search, the open chat with bubbles, and the composer. Use **mock data** for now. The real login and XMPP data get wired in later tasks, so keep the UI state behind a small store interface that can be swapped for real data.

Julio asked for this directly: "for the UI we need to be closer to what Telegram is". **Visual quality matters.** Claude will review screenshots.

### Read first
- `AGENTS.md` (mandatory)
- **`docs/design/ui-style.md`**: the source of truth for layout, colors, sizes and components. Follow it closely.
- `docs/PROJECT_PLAN.md` §6.3 (payload types) and §6.7 (voice messages)
- `packages/protocol/src/*`: use its types for AI cards (`ProgressSchema`, `ApprovalRequestSchema`) and voice (`VoiceMetaSchema`)
- `apps/web/*` (current scaffold)
- shadcn/ui docs for Vite + Tailwind v4

### Allowed files
- `apps/web/**`
- `packages/chat-core/**` (new package, see step 3)
- `pnpm-lock.yaml`

**Not allowed:**
- `apps/server/**`, `apps/mobile/**`, `infra/**`
- other packages
- root config

Other workers are editing those.

### Allowed dependencies
- **Web:**
  - `react-router` (v7, library mode)
  - `zustand`
  - `lucide-react` (icons)
  - the shadcn/ui setup deps: `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css`, and `radix-ui` / `@radix-ui/*` as shadcn adds them
- **`chat-core`:** none (plain TypeScript).
- You may run `pnpm dlx shadcn@latest init` / `add` inside `apps/web`. It will ask for approval, which is fine.

### What to build
1. **Theme.** Put every token from `ui-style.md` §2 in `apps/web/src/index.css` as CSS variables for light and dark (dark via `prefers-color-scheme`), mapped into Tailwind v4 `@theme` so classes like `bg-bubble-out` and `text-muted-foreground` work. Set up shadcn/ui on top of the same variables.
2. **Layout and routing:**
   - `react-router` with `/` (list, plus "Select a chat…" on wide screens) and `/c/:chatId`.
   - Two panes at ≥ 900 px, one pane below that (the list is home, the chat has a back arrow).
   - `Esc` closes the chat on narrow screens. `Ctrl/Cmd+K` focuses search.
3. **`packages/chat-core`** (new package `@galena/chat-core`, pure TypeScript, Vitest). Logic both apps will share:
   - `formatListTime(date, now)` → `HH:mm` today, short weekday within 7 days, else `dd.MM.yy`
   - `formatDateSeparator(date, now)` → `Today`, `Yesterday` or `September 25` (locale `en`)
   - `avatarGradient(id)` → one of the 7 gradients (deterministic)
   - `initials(name)`
   - `groupMessages(messages)` → groups by the same sender within 5 minutes, with date separators inserted, marking the first and last of each group
   - `previewText(lastMessage, { isGroup, currentUserId })` → the list preview rules from §4, including voice (`🎤 Voice message (0:12)`) and photo
   - the UI types used by both apps:
     - `ChatSummary { id, title, kind: 'dm'|'group'|'ai', isAI, space: 'personal'|'work'|…, avatarUrl?, unread, muted, lastMessage?, online?, memberCount? }`
     - `UiMessage { id, chatId, senderId, senderName, text?, createdAt, status: 'sending'|'sent'|'read', replyTo?, voice?: VoiceMeta, image?: { url, width, height }, card?: Payload }`

   Tests cover every function, including edge cases: midnight, year change, empty names, emoji names.
4. **Mock data** in `apps/web/src/mock/`: at least **10 chats** covering:
   - a DM with **Ana** (unread 2, online)
   - a friends group **"Viernes 🍻"** with 5 members
   - a muted group with unread messages (grey badge)
   - a work group **"Dev team"** with human and AI members
   - AI DMs **"Dev AI"** (working) and **"Marketing AI"** (idle)
   - older chats (yesterday, a weekday, last month)

   Two or three chats have **20–40 messages** spanning several days, including:
   - grouped messages and replies
   - a **voice message** with a waveform and transcript
   - an **image**: use an inline SVG or CSS gradient, no external URLs
   - a **progress card**, plus an **approval card** whose data is a valid `ApprovalRequestSchema` object
5. **Store** (`zustand`) behind an interface `ChatStore`:
   - `chats`, `messages(chatId)`, `openChat(chatId)` (clears unread)
   - `sendText(chatId, text)`: appends an outgoing message as `sending`, then `sent` after 300 ms and `read` after 1.5 s (simulated)
   - `search`, `activeFolder`

   Components only use this interface.
6. **Components**, exactly per `ui-style.md` §4:
   - `ChatList`, `ChatListItem`, `FolderTabs`, `SearchBar`
   - `ChatHeader`
   - `MessageList` (with the scroll-to-bottom "↓" button and its unread count)
   - `MessageBubble` (tails, meta inside the bubble, sender names and avatars in groups)
   - `DateSeparator`, `ReplyQuote`
   - `VoiceMessage` (play/pause toggle, waveform, duration, transcript toggle; no real audio yet)
   - `ImageMessage`
   - `ProgressCard`, `ApprovalCard` (buttons log to the console for now)
   - `Composer` (auto-grow 1–6 lines; mic ↔ send switch; Enter sends, Shift+Enter makes a newline)
   - `Avatar` (gradient + initials, online dot), `AiBadge`
   - an empty state with an "Invite a friend" button (it does nothing yet)
7. **Accessibility:** `aria-label` on every icon button, focus rings, and the keyboard behavior above.
8. **Tests** (Vitest + Testing Library, jsdom):
   - the list renders every mock chat with previews, badges and the AI badge
   - folder tab filtering (AIs shows only AI chats; Personal hides work)
   - search filters by title
   - opening a chat shows the header subtitle, date separators and grouped bubbles (the sender name only on the first bubble of a group)
   - the composer shows mic when empty and send with text; Enter sends; Shift+Enter doesn't send; the new message appears with the sending, then sent state
   - the voice transcript toggles
   - the approval card renders Approve and Deny
   - opening a chat clears its unread count

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` pass for the whole repo.
- [ ] `pnpm --filter @galena/web dev` shows the Telegram-like UI in light and dark (Claude will screenshot it).
- [ ] Every token, size and component rule from `ui-style.md` is implemented. List any you couldn't match in the Report.
- [ ] No external network assets (images or fonts from URLs). No Telegram logos or brand assets.
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
- Real login, XMPP and server calls.
- Real audio recording and playback.
- Settings, profiles, creating groups.
- The mobile app (T-0019).

---

## Report (written by the worker when done)

### What I did
- Built the Telegram-like web chat shell in `apps/web` on top of the existing Vite + React + Tailwind v4 scaffold, following `docs/design/ui-style.md`.
- **Theme** (`apps/web/src/index.css`): every §2 token as a CSS variable for light and dark (`prefers-color-scheme`), mapped into Tailwind v4 `@theme inline` so `bg-bubble-out`, `text-muted-foreground`, `bg-list-active`, etc. work. shadcn/ui is initialised on the same variables (`components.json`, `src/lib/utils.ts` `cn`, `src/components/ui/button.tsx`). Added `.chat-background`, bubble-tail clip-path classes (out/in), thin scrollbars and the typing-dots keyframes.
- **Routing/layout** (`src/routes/`): `react-router` v7 with `/` and `/c/:chatId`; two panes at ≥ 900 px (custom `wide` breakpoint) and one pane below, where the chat list is home and the chat has a back arrow. `Esc` closes the chat on narrow layouts, `Ctrl/Cmd+K` focuses search. The store is injected through `ChatStoreProvider` so it can be swapped for real data.
- **`packages/chat-core`** (new, `@galena/chat-core`, plain TypeScript + Vitest): `formatListTime`, `formatDateSeparator`, `avatarGradient`, `initials`, `groupMessages`, `previewText` (plus small helpers `formatTime`, `formatWeekday`, `formatShortDate`, `formatDuration`, `previewPrefix`, `previewBody`, `firstName`) and the shared `ChatSummary`/`UiMessage`/`RenderItem` types. 29 tests cover the edge cases (midnight, year change, empty names, emoji names, grouping, previews).
- **Mock data** (`src/mock/`): 11 chats (Ana DM unread 2 + online; "Viernes 🍻" 5 members; muted "Familia" and "Gym buddies" with an unread badge; "Dev team" work group; AI DMs "Dev AI" working and "Marketing AI" idle; older chats from yesterday, a weekday and last month). Three threads have 20–40 messages spanning several days with grouped messages, replies, voice messages (waveform + transcript), inline-SVG images, a progress card and a valid `ApprovalRequestSchema` approval card.
- **Store** (`src/store/`): a `zustand` vanilla store behind the `ChatStore` interface — `chats`, `messages(chatId)`, `openChat` (clears unread), `sendText` (appends `sending`, then `sent` after 300 ms and `read` after 1.5 s), `search`, `activeFolder`, plus the selectors `visibleChats`/`folderUnread`.
- **Components**: `ChatList`, `ChatListItem`, `FolderTabs`, `SearchBar`, `ChatHeader`, `MessageList` (auto-scroll + "↓" button with unread count), `MessageBubble` (tails, inline meta, sender names/avatars in groups), `DateSeparator`, `ReplyQuote`, `VoiceMessage` (play/pause, waveform, duration, Aa transcript toggle), `ImageMessage`, `ProgressCard`, `ApprovalCard` (buttons log to the console), `Composer` (auto-grow 1–6 lines, mic ↔ send, Enter/Shift+Enter), `Avatar`, `AiBadge` and `EmptyState` ("Invite a friend" / "Select a chat to start messaging").
- **Accessibility**: `aria-label` on every icon button, focus-visible rings on inputs/buttons, `aria-current` for the selected chat, `role="tab"`/`aria-selected` on folder tabs, keyboard shortcuts above.
- **Tests** (24 in `apps/web`): list rendering with previews/badges/AI badges, folder filtering, search, header subtitle + date separators + grouped bubbles, composer mic/send/Enter/Shift+Enter and sending→sent→read, voice transcript toggle, Approve/Deny, unread cleared on open, and validation of all mock card payloads.

### Files changed
- New package: `packages/chat-core/` (`package.json`, `tsconfig.json`, `src/{index,types,format,avatar,messages}.ts` + 3 test files).
- Web config: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/components.json` (new).
- Web source: `apps/web/src/index.css`, `src/App.tsx`, `src/App.test.tsx`, `src/lib/{utils,format,useMediaQuery}.ts`, `src/store/{store,ChatStoreProvider}.tsx`, `src/mock/{ids,helpers,messages,chats,index}.ts` (+ `mock.test.ts`), `src/components/*` (17 components + tests), `src/routes/{AppRoutes,ChatShell,ChatView}.tsx` (+ `ChatShell.test.tsx`), `src/test/{setup.ts,renderApp.tsx}`, `src/components/ui/button.tsx`.
- `pnpm-lock.yaml`.
- `work/T-0018-web-chat-shell.md` (status + this Report).

### Dependency versions
- Web: `react-router` ^7.18.4, `zustand` ^5.0.15, `lucide-react` ^1.48.0, `class-variance-authority` ^0.7.1, `clsx` ^2.1.1, `tailwind-merge` ^3.7.0, `tw-animate-css` ^1.4.0, `radix-ui` ^1.6.7 (existing react/react-dom ^19.3.0 and `@galena/protocol`).
- `chat-core`: none beyond a type-only `@galena/protocol` workspace dependency.
- Note: `pnpm dlx shadcn@latest init` used the `radix-nova` preset and pulled `cn`, `shadcn` and `@fontsource-variable/geist`, which are outside the allowed list; I removed them and kept the shadcn setup with only allowed deps.

### Commands run and real results
- `pnpm install`: Done — all 7 workspace projects resolved.
- `pnpm format:check`: "All matched files use Prettier code style!".
- `pnpm lint`: "Found 0 warnings and 0 errors" (109 files).
- `pnpm typecheck`: 7 successful, 7 total.
- `pnpm test`: 7 tasks successful; `@galena/web` 24 passed (7 files) and `@galena/chat-core` 29 passed (3 files); other packages cached/passed.
- `pnpm build`: 2 successful (web: `dist/assets/index-*.js` ~341 kB, css ~27 kB; mobile: Expo export), 0 failed.
- Also verified in the built CSS: `@media (width>=900px)`, `prefers-color-scheme:dark`, `.bg-bubble-out`, bubble tails and `.chat-background`; no external asset URLs.
- `pnpm --filter @galena/web dev --port 5199` started cleanly (Vite ready); the desktop browser tool was not connected in this session, so I could not screenshot it myself.

### Anything from ui-style.md not matched yet
- §5 new-message animation: implemented as a 150 ms slide-up + fade for outgoing messages while they are `sending`; incoming messages don't animate on arrival. Detecting "just arrived" without accessing a ref during render (which this repo's oxlint `react(refs)` rule forbids) needs a small store-side flag if we want it for incoming too.
- §6 contrast: `--bubble-in-meta` (#a0acb6 on the white incoming bubble) is about 2.4:1, below the 4.5:1 guidance, but it is the exact value in the §2 token table, so I used the token. Worth changing the token if 4.5:1 is required.
- §1 "resizable later" and the per-workspace tabs driven by real data are not implemented (mock folders All/Personal/AIs/Work only), as expected for this task.

### Problems, deviations from the spec, open questions
- Extended `ChatSummary` with three optional fields to render the required UI: `aiStatus?: 'idle' | 'working'` (AI subtitle + the working/idle mock DMs), `onlineCount?: number` (the `3 members, 1 online` subtitle) and `lastSeenAt?: Date` (`last seen 5 minutes ago`). These aren't in the literal type in the task but are needed by §4; please confirm whether T-0019 (mobile) should adopt them.
- `chat-core` has a type-only dependency on `@galena/protocol` because the spec's own `UiMessage` references `VoiceMeta` and `Payload`. No runtime dependency was added.
- I added `previewPrefix`/`previewBody`/`firstName` and `formatTime`/`formatWeekday`/`formatShortDate`/`formatDuration` as small exported helpers; `previewText` composes them and is unchanged in behaviour.
- `Avatar`/`ImageMessage` use inline `data:image/svg+xml` URIs from the mock, so nothing is fetched from the network.
- No blocking questions; the task is ready for review.


---

## Review (written by Claude)

**Verdict (round 1): changes requested (one small bug).** This is excellent, Telegram-faithful work.

### What I verified myself (on commit af4fd12)
- `install`, `format:check`, `lint`, `typecheck`, `test` (web **24**, chat-core **29**) and `build`: all PASS. No external URLs, no Telegram brand references.
- **Visual check in iPad simulator Safari** (≥ 900 px, two panes), light and dark, of the chat list, the "Viernes 🍻" group and the Dev AI chat:
  - layout, tokens, folder tabs and badges match `ui-style.md`
  - selected row in the accent color
  - reply quotes, sender names and avatars on the last bubble of a group
  - date pills
  - the voice message
  - ✓✓ ticks
  - "AI · working" with dots and the progress card
  - the composer
  - dark mode is correct

### Findings
1. **(must fix) `initials()` includes emoji.** "Viernes 🍻" renders the avatar as **`V🍻`** in the list and the header.
   - Fix it in `packages/chat-core/src/avatar.ts`: consider only words that contain a letter or digit (`/[\p{L}\p{N}]/u`), and take the first **letter or digit** of each (grapheme-safe). Symbols and emoji never count.
   - A name with no letters or digits (e.g. `"🍻🍻"`) returns `""`, and the avatar then shows a neutral glyph such as a person icon.
   - Tests to add:
     - `"Viernes 🍻"` → `"V"`
     - `"🍻 Viernes"` → `"V"`
     - `"Ana María"` → `"AM"`
     - `"ana"` → `"A"`
     - `"🍻🍻"` → `""`
     - `"Dev-1"` → `"D"`
2. **(accepted)**
   - The three `ChatSummary` additions (`aiStatus`, `onlineCount`, `lastSeenAt`). Mobile (T-0019) added the same ones, so keep them in `chat-core`.
   - The type-only dependency on `@galena/protocol`.
   - The helper functions.
   - Dropping the shadcn preset extras.
3. **(accepted, note)** The `--bubble-in-meta` contrast of about 2.4:1 matches Telegram's own low-contrast meta text. We keep it for now and revisit with Julio's feedback.
4. **(note)** Mock chat ids (`c-viernes`) differ from the room JIDs in `ids.ts`. That's fine for mock data, and the wiring task will use real JIDs.


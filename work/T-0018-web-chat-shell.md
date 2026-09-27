---
id: T-0018
title: Web app — Telegram-like chat shell (list, folders, chat view, composer) with mock data
status: todo
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
-

### Files changed
-

### Dependency versions
-

### Commands run and real results
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

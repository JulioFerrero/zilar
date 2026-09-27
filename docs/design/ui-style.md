# Galena UI style: close to Telegram

> **Decision D23 (Julio, 2026-09-27):** "for the UI we need to be closer to what Telegram is". Julio will give more detail after he uses the app, so this document will change. Web (`apps/web`) and mobile (`apps/mobile`) both follow it.
>
> **What "close to Telegram" means for us:** the same layout, patterns and feel (chat list, bubbles, folders, composer). **Never** Telegram's logo, name, wallpaper images or other brand assets. Our brand is **Galena**.

## 1. Layout

### Desktop / wide web (≥ 900 px)
```
┌──────────────── 360px ────────────────┬────────────────────────── rest ──────────────────────────┐
│ ☰  [ 🔍 Search                    ]   │ (avatar) Name                          🔍  ⋮             │
│ All · Personal · AIs · Work           │          online / last seen … / 3 members / AI · working │
├───────────────────────────────────────┼──────────────────────────────────────────────────────────┤
│ (●) Ana                        12:41  │                                                          │
│     See you tonight ❤️            (2) │        ┌──────────────┐                                  │
│ (●) Dev team            AI     11:02  │        │ incoming      │                                 │
│     Dev-1: PR #42 is ready        ✓✓  │        └──────────────┘                                  │
│ (●) Dev AI              AI    Yesterd │                         ┌─────────────────────┐          │
│     Tests pass. Merge?                │                         │ outgoing      12:40 ✓✓│         │
│ …                                     │                         └─────────────────────┘          │
│                                       │ [📎] [ Message                        ] [😊] [🎤/➤]      │
└───────────────────────────────────────┴──────────────────────────────────────────────────────────┘
```
- The **left column** is 360 px (resizable later), with a white or dark sidebar background:
  - A top bar with a menu button and a rounded search field.
  - **Folder tabs** below the top bar: `All`, `Personal`, `AIs`, and one tab per workspace (e.g. `Work`). The active tab has an accent-colored underline and text. There are unread counters on tabs.
  - The chat list scrolls.
- The **right side** is the open chat. With no chat selected, it shows the chat background with a centered pill: "Select a chat to start messaging".

### Narrow web and mobile (< 900 px)
- One pane at a time. The **chat list** is the home screen, and tapping a chat pushes the **chat screen**, with a back arrow in the header.
- On mobile, the search icon sits in the header and a compose (pencil) floating button is at the bottom right of the list.

## 2. Colors (design tokens)

Both apps use these semantic tokens. The values are close to Telegram's classic light and "night blue" themes.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `#ffffff` | `#17212b` | Sidebar / list background |
| `--foreground` | `#000000` | `#f5f5f5` | Primary text |
| `--muted-foreground` | `#707579` | `#708499` | Secondary text: previews, times, subtitles |
| `--accent` | `#3390ec` | `#5288c1` | Links, active tab, unread badge, send button, "online" |
| `--accent-foreground` | `#ffffff` | `#ffffff` | Text on accent |
| `--chat-background` | gradient `#c9dfc5 → #d8e8f0` (135°) | `#0e1621` | Behind messages |
| `--bubble-in` | `#ffffff` | `#182533` | Incoming bubble |
| `--bubble-out` | `#eeffde` | `#2b5278` | Outgoing bubble |
| `--bubble-out-meta` | `#4fae4e` | `#7da8d3` | Time and ticks inside outgoing bubbles |
| `--bubble-in-meta` | `#a0acb6` | `#6d7f8f` | Time inside incoming bubbles |
| `--list-hover` | `#f4f4f5` | `#202b36` | Chat list item hover |
| `--list-active` | `#3390ec` (text white) | `#2b5278` | Selected chat in the list (desktop) |
| `--badge-muted` | `#c4c9cc` | `#3e546a` | Unread badge of muted chats |
| `--divider` | `#dfe1e5` | `#0e1621` | Thin separators |
| `--danger` | `#e53935` | `#ef5350` | Destructive actions |

- **Light or dark** follows the system setting (`prefers-color-scheme`, or the phone's setting).
- **Avatars** without a photo get a **gradient circle with initials**. Pick one of 7 gradients, deterministically from a hash of the chat or user id:
  - red `#ff885e→#ff516a`
  - orange `#ffcd6a→#ffa85c`
  - violet `#82b1ff→#665fff`
  - green `#a0de7e→#54cb68`
  - cyan `#53edd6→#28c9b7`
  - blue `#72d5fd→#2a9ef1`
  - pink `#e0a2f3→#d669ed`

  Initials are white, semibold, up to 2 letters.

## 3. Typography

- **Font:** the system UI stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. On mobile, use the platform default.
- **Sizes (web):**
  - list name 16/600
  - list preview and messages 15/400
  - time 12
  - header name 16/600
  - header subtitle 14
  - folder tabs 15/500
- Mobile uses the same scale, adapted to the platform (e.g. 17 for names on iOS).

## 4. Components

### Chat list item (height 72 px web / 76 mobile)
- **Avatar:** a 54 px circle, with a green "online" dot (12 px, bordered) for people who are online.
- **Row 1:** the name (bold, one line, ellipsis).
  - AI chats and AI members show a small **`AI` badge**: a rounded pill with accent-colored outline text, 11 px.
  - A mute icon if muted.
  - The **time** is right-aligned: `HH:mm` today, the weekday within 7 days, otherwise `dd.MM.yy`.
- **Row 2:** the last message preview (muted, one line).
  - In groups, the sender's first name comes first, in foreground color: `Ana: ok!`.
  - For your own messages, the prefix is `You:`.
  - Voice notes read `🎤 Voice message (0:12)`, and images `🖼 Photo`.
- **Right side of row 2:**
  - an **unread badge**: an accent pill with a white count, grey for muted chats
  - or, for your own last message, **ticks**: `✓` sent, `✓✓` read
- **States:** hover background; selected = accent background with white text (desktop).

### Chat header
- The avatar is 42 px, next to the name (with the `AI` badge where relevant).
- The subtitle is one of:
  - `online`
  - `last seen 5 minutes ago`
  - `3 members, 1 online`
  - for AIs: `AI · idle` or `AI · working…` (animated dots)
- On the right: search and a ⋮ menu. The back arrow is only on narrow screens.

### Messages
- **Bubbles:**
  - max width 480 px web / 80 % mobile
  - radius 16 px, with a **tail** on the last bubble of a group:
    - outgoing: bottom-right corner squared, plus a small curved tail
    - incoming: bottom-left
  - 6/10 px padding
- **Consecutive messages** from the same sender within 5 minutes form a **group**: 2 px gap inside a group, 8 px between groups. Only the last bubble has the tail.
- **In groups:**
  - Incoming messages show the **sender's name** in the sender's avatar color (bold 14) on the first bubble of a group.
  - The **sender avatar** (34 px) sits beside the last bubble of the group.
- **Meta:** the time (and ticks for outgoing) sits inside the bubble at the bottom right, inline after the text, like Telegram (`12:40 ✓✓`).
- **Date separators:** a centered translucent pill: `Today`, `Yesterday`, `September 25`.
- **Replies:** a quoted block at the top of the bubble, with a colored left bar, the sender name and a one-line excerpt.
- **Voice message bubble:**
  - a play/pause circle button in the accent color
  - a waveform (bars from the `waveform` array; played part in the accent color, rest muted)
  - the duration
  - a small "Aa" button for **transcript**, which expands the transcript text below
- **Image bubble:** the image with rounded corners, and the time overlaid on a dark translucent pill.
- **AI cards** (placeholders for now):
  - **progress card:** stage text with a small spinner
  - **approval card:** title, summary, cost, and **Approve** / **Deny** buttons

  They're rendered from `@galena/protocol` payload types. For now they're static, with mock data.

### Composer
- A bottom bar on the chat background, containing a rounded input "pill":
  - 📎 attach button, on the left inside the pill
  - an auto-growing textarea, placeholder `Message`, 1–6 lines
  - 😊 emoji button, on the right inside the pill
- **Outside the pill on the right,** a round **56 px** accent button:
  - a **🎤 mic** when the input is empty (press to record: later)
  - a **➤ send** when there's text
- **Enter** sends, **Shift+Enter** adds a newline (web).

### Folder tabs
- Horizontal and scrollable. The active tab has accent text and a 3 px rounded underline. Unread counts appear as small pills next to tab names.

### Empty states
- **No chats:** a friendly illustration-free message plus an **"Invite a friend"** button (invite links from T-0015).
- **No chat selected** (desktop): the pill described in §1.

## 5. Motion and feel

- **Chat switch:** instant. No page transitions on desktop, and the native push animation on mobile.
- **New message:** a subtle slide-up and fade over 150 ms. The list auto-scrolls to the bottom only if the user is already near the bottom. Otherwise it shows a round "↓" button with an unread count.
- Hover states on desktop, and native press feedback on mobile.

## 6. Accessibility

- Every icon button has an `aria-label` / `accessibilityLabel`.
- Color contrast is at least 4.5:1 for text (check muted text on bubbles).
- Keyboard (web):
  - Tab reaches the list, header actions and composer.
  - `Esc` closes the open chat on narrow layouts.
  - `Ctrl/Cmd+K` focuses search.

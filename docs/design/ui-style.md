# Zilar UI style: a classic messenger layout, Vercel-dark look, skeuomorphic depth

> **Decision D24 (Julio, 2026-09-28), which supersedes the colors and type of D23:** keep a classic messenger layout and patterns, but in a Vercel style ("blacks, shadcn, uber") with real, skeuomorphic depth on buttons and bubbles ("more Skeuomorphism, the buttons, bubbles").
>
> The approved mockup is in `docs/design/mockups/` (`Main.dc.html` for desktop, `Mobile.dc.html` for the mobile chat list). Its markup holds the exact values. Where this document and the mockup disagree, the mockup wins.
>
> **D23 still holds for layout and behavior:** chat list, folders, bubbles grouping, composer, typing, unread divider and so on. **Never** use another messenger's logo, name, wallpaper or other brand assets. Our brand is **Zilar**.

**Dark only for now.** The app is always dark, whatever the system setting. A light theme comes later, as its own decision.

Web (`apps/web`) follows this first. Mobile (`apps/mobile`) follows in a later task.

## 1. Layout

### Desktop / wide web (≥ 900 px)
The page background is pure black (`#000`). It holds **two floating panels** with a 12 px gap and a 12 px margin all around:
- **Sidebar panel**, 360 px wide:
  - a top row with a raised menu key and an inset search field (`⌘K` hint);
  - a folder **segmented control**: a recessed track with the active tab raised;
  - the chat list;
  - a full-width **New chat** primary button at the bottom, above a 1 px divider.
- **Chat panel**, the rest of the width:
  - a header (64 px, bottom border);
  - the messages, on a subtle dot-grid background;
  - the composer well.

Both panels are `#0a0a0a`, with a 1 px `#1f1f1f` border, 16 px radius and `overflow: hidden`. With no chat selected, the chat panel shows a centered raised pill: "Select a chat to start messaging".

```
 ┌── 360 ───────────────────┐ ┌───────────────────────────────────────────────┐
 │ [≡] [ ⌕ Search      ⌘K ] │ │ (DT) deep test [AI]                  [⌕] [⋮]  │
 │ ((All)| Personal|AIs|Work)│ │      writing…                                 │
 │ (DT) deep test [AI] 20:28│ ├───────────────────────────────────────────────┤
 │      • writing…          │ │ · · · · · · · · ( Today ) · · · · · · · · · · │
 │ (GA) Zilar amigos  00:30│ │                        ┌───────────────────┐  │
 │      Claude: Good…    (2)│ │                        │ outgoing (white)  │  │
 │ …                        │ │ ┌──────────────────┐   └───────────────────┘  │
 │                          │ │ │ incoming (dark)  │                          │
 ├──────────────────────────┤ │ └──────────────────┘                          │
 │ [ + New chat        N  ] │ │ [📎] [ Message deep test          ] [🎤] [↑]  │
 └──────────────────────────┘ └───────────────────────────────────────────────┘
```

### Narrow web and mobile (< 900 px)
- One pane at a time, as in D23. The list is the home screen, and tapping a chat pushes the chat screen.
- The mobile list has:
  - a large title (`Chats`, 28/600);
  - an inset search field;
  - the segmented control;
  - rows with 52 px avatars and hairline separators (`#1a1a1a`);
  - a raised primary **+** floating button (56 px, 18 px radius) at the bottom right.

## 2. Colors (design tokens)

| Token | Value | Use |
|---|---|---|
| `--page` | `#000000` | Behind the panels |
| `--panel` | `#0a0a0a` | Sidebar and chat panels |
| `--surface` | `#111111` | Plain surfaces inside panels |
| `--surface-raised` | `#171717` | Hover and selected chat row |
| `--well` | `#0c0c0c` | Recessed fields: search, composer, segment track |
| `--border` | `#1f1f1f` | Panel borders, dividers |
| `--border-strong` | `#262626` | Field borders |
| `--edge` | `#050505` | Near-black outline of raised keys and bubbles |
| `--foreground` | `#ededed` | Primary text |
| `--muted-foreground` | `#a1a1a1` | Previews, subtitles |
| `--subtle-foreground` | `#8a8a8a` | Times, hints (still ≥ 4.5:1 on `--panel`) |
| `--generating-foreground` | `#8f8f8f` | Text of a reply that is still being written |
| `--accent` | `#ededed` | Primary buttons, unread badge, send. Text on it is `#0a0a0a` |
| `--online` | `#22c55e` | The online dot |
| `--danger` | `#ef4444` | Destructive actions |

- **Accent:** white by default. Blue (`#0070f3` or Uber `#276ef1`, with white text) is a planned user setting, so every accent use must go through the tokens.
- **Chat background:** `--panel`, with a dot grid (`radial-gradient(#1c1c1c 1px, transparent 1px)`, 22 px).
- **Avatars without a picture:** a glossy 3D ball from `@zilar/ball-avatar`, seeded by the id, for people, groups and AIs alike (Julio, 2026-10-11, T-1091).
  - The helpers are `avatarSvg` and `avatarDataUri` in `@zilar/chat-core`.
  - This is the one deliberate colour exception to the monochrome UI. There are no initials and no monochrome shades any more.
- **`AI` badge:** Geist Mono 10 px, `#a1a1a1` text, 1 px `#333` border, 5 px radius.

## 3. Typography

- **Geist** for UI text, **Geist Mono** for times, keyboard hints, the `AI` badge and the `generating` label. Both are bundled with the app, never loaded from a CDN (the app is self-hosted).
- **Sizes (web):**
  - list name 14/600
  - list preview 13
  - messages 14/1.5
  - header name 15/600
  - header subtitle 12
  - times 10–11 mono
  - segment tabs 13/500
  - buttons 14/600
- Titles get slightly tight tracking (`-0.02em`).

## 4. Depth: the skeuomorphic recipes

Four surface kinds, and every interactive element is one of them. These are the exact shadows from the mockup; implement them once as utilities or component variants, never ad hoc.

**Primary (accent) button, badge and FAB.** A glossy key:
- background: `linear-gradient(180deg, rgba(255,255,255,.40), rgba(255,255,255,.08) 48%, rgba(0,0,0,0) 52%, rgba(0,0,0,.14)), var(--accent)`;
- shadow: `inset 0 1px 0 rgba(255,255,255,.85), inset 0 -2px 0 rgba(0,0,0,.2), inset 0 0 0 1px rgba(255,255,255,.12), 0 1px 0 rgba(0,0,0,.95), 0 2px 3px rgba(0,0,0,.7), 0 10px 18px -8px rgba(0,0,0,.95)`;
- text-shadow: `0 1px 0 rgba(255,255,255,.7)` on a light accent, or `0 -1px 0 rgba(0,0,0,.35)` on a dark one;
- **pressed:** `translateY(1px)` and `inset 0 2px 5px rgba(0,0,0,.35), 0 1px 0 rgba(0,0,0,.95)`, over an 80 ms transition.

**Icon button.** A dark key:
- background: `linear-gradient(180deg, #2c2c2c, #151515)`;
- a 1 px `--edge` border, 10 px radius (12 on mobile), and icon color `#d4d4d4`;
- shadow: `inset 0 1px 0 rgba(255,255,255,.16), inset 0 -1px 0 rgba(0,0,0,.65), 0 1px 0 rgba(0,0,0,.95), 0 3px 6px -1px rgba(0,0,0,.75)`;
- the icon gets `drop-shadow(0 1px 0 rgba(0,0,0,.95))`;
- **pressed:** `translateY(1px)` and `inset 0 2px 5px rgba(0,0,0,.9)`.

**Well** (search, composer, segment track). Recessed:
- a `--well` background with a 1 px border (`#1f1f1f`, or `#1a1a1a` for the track);
- shadow: `inset 0 2px 6px rgba(0,0,0,.9), inset 0 1px 1px rgba(0,0,0,.8), inset 0 0 0 1px rgba(0,0,0,.4), 0 1px 0 rgba(255,255,255,.06)`.

**Raised segment / pill** (active folder tab, date pill):
- background: `linear-gradient(180deg, #333, #1c1c1c)` (the date pill uses `#1f1f1f → #121212` with an `--edge` border);
- shadow: `inset 0 1px 0 rgba(255,255,255,.16), inset 0 -1px 0 rgba(0,0,0,.6), 0 1px 0 rgba(0,0,0,.9), 0 2px 4px rgba(0,0,0,.7)`;
- text-shadow: `0 -1px 0 rgba(0,0,0,.7)`.

**Focus:** every key and well shows a visible focus ring (`0 0 0 2px #0a0a0a, 0 0 0 4px #a1a1a1`) on keyboard focus, in addition to its shadows.

## 5. Components

### Chat list item
- 10 px padding, 12 px radius, 2 px gap between rows. Hover and selected use `--surface-raised`, and selected also gets `inset 0 1px 0 rgba(255,255,255,.04)`.
- The avatar is 44 px (52 on mobile), with the online dot (10 px, a 2 px ring in the row color).
- **Row 1:** the name, the `AI` badge, then the time pushed right (mono 11, `--subtle-foreground`).
- **Row 2:** the preview (muted, ellipsis). A group sender prefix is in `#d4d4d4`, and your own messages are prefixed `You:`.
  - It ends with either the **unread badge** (a primary key pill, 20 px high, 11/600) or ticks (`--subtle-foreground`).
  - **While an AI writes:** `writing…` with a pulsing 6 px dot replaces the preview.
- Time formats, voice and photo previews and mute are as in D23.

### Chat header
64 px high, a `rgba(10,10,10,.85)` background and a bottom border. It holds:
- a 36 px avatar;
- the name (15/600) with the `AI` badge;
- the subtitle (12, muted);
- on the right, the icon keys (search, more).

The subtitles are the same as in D23. While an AI writes, the subtitle is `writing…`.

### Messages (bubbles)
- The radius is 14 px, with the tail corner 4 px (outgoing bottom-right, incoming bottom-left). Padding is 8–10/12. Max width is 520–560 px.
- **Outgoing:** a glossy white bubble.
  - background: `linear-gradient(180deg, #ffffff, #dedede)`, text `#0a0a0a`;
  - shadow: `inset 0 1px 0 #fff, inset 0 -3px 6px rgba(0,0,0,.08), 0 1px 0 rgba(0,0,0,.95), 0 4px 10px -3px rgba(0,0,0,.85)`;
  - text-shadow: `0 1px 0 rgba(255,255,255,.8)`;
  - meta (mono 10) in `#525252`.
- **Incoming:** a dark card.
  - background: `linear-gradient(180deg, #252525, #161616)`, a 1 px `--edge` border, text `--foreground`;
  - shadow: `inset 0 1px 0 rgba(255,255,255,.12), inset 0 -1px 0 rgba(0,0,0,.6), 0 1px 0 rgba(0,0,0,.95), 0 4px 10px -3px rgba(0,0,0,.85)`;
  - text-shadow: `0 -1px 0 rgba(0,0,0,.7)`;
  - meta in `--subtle-foreground`.
- **Generating (an AI reply still being written or revealed):** **recessed, not raised.** It isn't "pressed out" yet.
  - `--well` background, a 1 px `#1a1a1a` border, the well shadow, and text in `--generating-foreground`;
  - a blinking 2 px caret (`#bdbdbd`) and a mono `generating` label with a pulsing dot;
  - when complete, it transitions over 400 ms to the incoming look: color, background and shadow.
- Grouping, tails, sender names in groups, replies, voice, images, big emoji, links and the unread divider behave as in D23, restyled with these tokens. The unread divider is a well strip with muted text. Reply quotes use a `#333` left bar.
- **Date separator:** the raised pill (12 px, muted).

### Composer
A well (`--well`, 14 px radius, 8 px padding) holding:
- the attach icon key;
- an auto-growing textarea (placeholder `Message <name>`);
- the mic icon key;
- the **send** primary key (36 px, 10 px radius, an arrow-up icon).

Enter and Shift+Enter work as in D23.

### Folder tabs
A **segmented control**:
- a well track with 3 px padding and 10 px radius, and equal-width tabs 30 px high (34 on mobile) with 7 px radius;
- the active tab is the raised segment, and inactive tabs are muted text on the track;
- unread counts are small pills beside the tab name.

### New chat
- **Desktop:** a full-width primary key (40 px) at the bottom of the sidebar: `+ New chat`, with a mono `N` hint.
- **Mobile:** the primary FAB.

It opens the same menu as today (New group, New message, New AI).

### Empty states
As in D23, restyled. The empty-chat pill is the raised pill.

## 6. Motion and feel

- Chat switch is instant. A new message slides up and fades in over 150 ms. Autoscroll works as in D23.
- Keys press down 1 px over 80 ms. There are no bouncy animations.
- The AI draft reveal is smooth, frame by frame (T-0045). The generating → finished transition takes 400 ms.
- Honor `prefers-reduced-motion`: no reveal animation, no pulsing, no press translation.

## 7. Accessibility

- Every icon key has an `aria-label` / `accessibilityLabel`.
- Text contrast is ≥ 4.5:1: `#8a8a8a` is the darkest allowed text on `#0a0a0a`, and `#525252` only on the white bubble.
- Keyboard (web):
  - Tab reaches the list, header keys, the segmented control and the composer;
  - there is a visible focus ring (§4);
  - `Esc` closes the open chat on narrow layouts;
  - `Ctrl/Cmd+K` focuses search.

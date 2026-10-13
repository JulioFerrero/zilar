---
id: T-1327
title: "Web chat polish found in the lead's audit: doubled 'Today' date pill and a sticky pill covering text at rest, big-emoji time drawn as an empty bubble with the menu over the emoji, a wrong 'Username' heading over the profile picture, and New chat menu items without icons"
status: merged
milestone: M5
branch: task/T-1327-web-chat-polish
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1327: Web chat polish

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-13: find more places where the UI doesn't look like Telegram. The lead's audit of the web mock found these four.

### What to build
1. **Date pill.** `apps/web/src/components/DateSeparator.tsx` (rendered from `MessageListRow.tsx:82`) is `sticky top-2`. Two problems:
   - in Ana's chat (desktop and 400 px) the "Today" pill draws as a **pill inside a second pill**, with a ghost outline right under the pinned bar;
   - at 400 px, in Dev team › General, the sticky "Yesterday" pill sits **on top of a message's text at rest** ("Also checked landscape").
   Find the cause; say it in the Report. Telegram shows one pill. A floating date may overlap messages only while scrolling, then fades out about 1 s after scrolling stops; inline separators never stack.
2. **Big emoji.** `apps/web/src/components/message/BigEmoji.tsx` (59 lines): a "😂😂" message (Viernes, from Ana) shows:
   - the time `07:15` in its own empty rounded box under the emoji, with the avatar next to that box;
   - the message's "⋯" menu button over the second emoji.
   Telegram puts a small translucent time pill at the emoji's bottom-right, with no bubble. Show the reactions under it as today, and the menu only on hover, not covering the emoji.
3. **Profile settings heading.** `apps/web/src/components/ProfileSettingsSection.tsx:231-233`: the section heading says "Username" and sits above the **picture** card. Make it "Profile" (or drop it if the page title already says Profile), keeping `aria-label` correct.
4. **New chat menu icons.** `apps/web/src/components/NewChatButton.tsx:170-` lists New group, New channel, Explore groups, New message, New AI and New topic as text only, while the left drawer menu has a lucide icon on every item. Add matching lucide icons (reuse the drawer's icon for the same action where one exists; cite it).
5. Every file stays at most 400 lines. **No tests** (UI).

### Read first
`AGENTS.md`, `apps/web/src/components/DateSeparator.tsx`, `apps/web/src/components/MessageListRow.tsx`, `apps/web/src/components/message/BigEmoji.tsx`, `apps/web/src/components/MessageBubble.tsx` (394 lines: don't grow it), `apps/web/src/components/ProfileSettingsSection.tsx`, `apps/web/src/components/NewChatButton.tsx`.

### Allowed files
`apps/web/src/components/DateSeparator.tsx`, `apps/web/src/components/MessageListRow.tsx`, `apps/web/src/components/MessageList.tsx`, `apps/web/src/components/message/BigEmoji.tsx`, `apps/web/src/components/message/MessageMenu.tsx`, `apps/web/src/components/MessageBubble.tsx`, `apps/web/src/components/ProfileSettingsSection.tsx`, `apps/web/src/components/NewChatButton.tsx`, `apps/web/src/index.css`, `work/T-1327-web-chat-polish.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the web mock:**
  - one "Today" pill, and no pill over text at rest;
  - big emoji with a small time pill and no empty box;
  - the profile page heading is right;
  - the New chat menu has icons.

---

## Report (written by the worker when done)

### What I did

1. **Date pill — cause and fix.** `DateSeparator.tsx` was `sticky top-2 z-10`. A sticky box sticks inside its *containing block*, and every separator's containing block is the whole message list (the `contentRef` column in `MessageList.tsx:348`), not the separator's own row. So once a separator reached `top-2` it never scrolled away: "Yesterday" pinned under the pinned banner, then "Today" pinned at the same spot on top of it — hence the pill drawing as a pill inside a second pill, with the earlier pill's `raised-pill` border/shadow ("ghost outline") showing around it. At rest in Dev team › General every scrolled-past separator was pinned over the message under the bar ("Also checked landscape", dev-team thread `dev-26`). Ana's DM (`packages/mock-backend/.../threads/ana.ts`) has three day groups (`ago(3)`, `ago(1)`, `ago(0)`), dev-team four, so the stack was always there.
   Fix: dropped `sticky top-2 z-10`, keeping the `raised-pill` span centred in a plain flow row. Inline separators now scroll with their messages and never stack or cover text at rest. I did **not** add a separate floating pill that appears while scrolling and fades after ~1 s; the spec says one "may" (optional), it would need a new scroll-timing state inside `MessageList.tsx` (which is already at 392/400 lines), and the acceptance ("one 'Today' pill, and no pill over text at rest") is met without it. Flagging it as a possible follow-up if you want the transient floating date.

2. **Big emoji.** `message/BigEmoji.tsx`: the time pill was a `raised-pill` box on its own row *below* the emoji (which is why the avatar sat next to an empty box), and the bubble's hover "…" button (`MessageActionsButton`, `absolute top-0.5 right-0.5`) landed over the right-hand emoji. Replaced the time box with a small translucent pill (`bg-black/45`, `text-white/90`) absolutely positioned at the emoji's `right-1 bottom-1` inside a `relative inline-flex` wrapper, so it reads like Telegram's overlay pill and the avatar lines up with the emoji. The `⋯` button is unchanged in the sticker/normal cases; for big emoji `MessageBubble` now passes `beside={...}` and `MessageActionsButton` (`message/MessageMenu.tsx`) moves it to that side of the emoji (`-right-7` for peers, `-left-7 right-auto` for own, vertically centred), still hover/focus-only. Reactions keep rendering under the emoji as before.

3. **Profile heading.** `ProfileSettingsSection.tsx:231-233`: the section was `aria-label="Username"` with an `<h2>Username</h2>` above the picture card. The page title is already "Profile" (`routes/ProfilePage.tsx:11`, `SettingsShell title="Profile"`), so I dropped the redundant `h2` and set `aria-label="Profile"` on the `<section>` (the only consumer is that page).

4. **New chat menu icons.** `NewChatButton.tsx`: added a lucide icon to each item, order untouched (registry pitfall). Reused the drawer's icon for the same action where it exists:
   - New group → `Users` (`apps/mobile/.../chat/new-chat-button.tsx:206`).
   - New channel → `Megaphone` (mobile `new-chat-button.tsx:201`; also web channel chrome `panels/ChannelHeader.tsx:22`, `ChatListItem.tsx:129`).
   - Explore groups → `Compass` (`chatList/ChatListMenu.tsx:149`, same action).
   - New message → `MessageSquarePlus` (mobile `new-chat-button.tsx:214`).
   - New AI → `Bot` (`ChatListMenu.tsx:176`, "My AIs").
   - New topic → `Hash` (mobile `new-chat-button.tsx:219`).

5. No tests added (UI). Every touched file stays ≤ 400 lines.

### Files changed
`apps/web/src/components/DateSeparator.tsx` (11→17), `apps/web/src/components/message/BigEmoji.tsx` (59→64), `apps/web/src/components/message/MessageMenu.tsx` (266→277), `apps/web/src/components/MessageBubble.tsx` (394→395), `apps/web/src/components/ProfileSettingsSection.tsx` (358→357), `apps/web/src/components/NewChatButton.tsx` (250→262), and this task file. No other files touched; no dependency added.

### Commands run and real results
- `pnpm install`: Done in 14.5 s, 1273 resolved / 1183 added; only pre-existing warnings (deprecated `uuid@7.0.3`, an unmet `@types/react` peer in `apps/mobile`).
- `pnpm gate` (repo root, from the log): `gate: 7 changed file(s) against main`; `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `SKIP tests @zilar/web (no nearby test files)`; `scope: every changed file is inside the Allowed files`; `migration: every added migration continues from the base`; ends `GATE PASS` (exit 0).
- No single-file tests were run: `apps/web` has no test files at all (`vitest` step skipped by the gate).

### Deviations / open questions
- Optional floating date while scrolling (item 1) left out, per the reasoning above — say the word and I'll add it in a follow-up if the 400-line budget can move.
- I did not open a browser; the lead's mock check is the visual verification. The date fix and the two layout fixes are reasoned from the code, not screenshotted.

### Security checklist
No routes, DB writes, permissions, secrets or logs touched — all four changes are presentational web components.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (1 nit); the packet is current for `89d9f6f5`.**
- **Lead's headless check** (Playwright Chromium, web mock of this branch):
  - Ana shows one "Today" pill under the pin bar (no ghost);
  - Viernes "😂😂" has a small time pill at the emoji's bottom-right, no empty box, and the menu doesn't cover it at rest;
  - `/settings/profile` no longer has the "Username" heading over the picture;
  - the New chat menu has icons on all six items;
  - at 400 px, Dev team › General has no date pill over text at rest.

---
id: T-0047
title: Web redesign (D24), part 2 — chat panel: header, glossy/recessed bubbles, composer well, pills, voice/image/cards
status: planned
milestone: M2
branch: task/T-0047-redesign-chat-panel
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0045, T-0046]
estimate: 1.5 days
---

# T-0047: Redesign, part 2 (chat panel)

## Spec (written by Claude, do not edit)

### Goal

Part 1 (T-0046, merged) gave the web app the D24 foundation: dark tokens, Geist, the four depth primitives (primary key, icon key, well, raised segment or pill), the floating panels and the sidebar. This task restyles the **chat panel** to match the approved mockup. Julio asked for real skeuomorphism on **buttons and bubbles**, so the bubbles are the heart of this task.

**Quality bar:** it must look like `docs/design/mockups/Main.dc.html`. Screenshot your result next to the mockup and look at both.

### Read first
- `AGENTS.md` (mandatory)
- `docs/design/ui-style.md`: all of it, especially §4 (depth recipes) and §5 (Chat header, Messages, Composer)
- `docs/design/mockups/README.md` and `Main.dc.html`: exact values in the inline styles and the `<style>` classes (`bubble-out`, `bubble-in`, `bubble-gen`, `raised-pill`, `well`, `btn-icon`, `btn-primary`)
- `apps/web/src/index.css` and `components/ui/*`: the primitives from T-0046. **Reuse them; don't duplicate the shadows.**
- `work/T-0045-smooth-drafts.md`: the generating state and the `useSmoothText` reveal you must keep working
- `apps/web/src/components/MessageBubble.tsx`, `MessageList.tsx`, `ChatHeader.tsx`, `Composer.tsx`, `DateSeparator.tsx`, `UnreadDivider.tsx`, `ReplyQuote.tsx`, `VoiceMessage.tsx`, `ImageMessage.tsx`, `MessageTicks.tsx`, `MessageActionsMenu.tsx`, `ProgressCard.tsx`, `ApprovalCard.tsx`, `TypingDots.tsx`, `routes/ChatView.tsx`

### Allowed files
- `apps/web/src/index.css`: bubble tokens, and new utilities for the three bubble looks
- the components listed under "Read first", from `MessageBubble.tsx` through `TypingDots.tsx`, plus `routes/ChatView.tsx` (layout only), `components/EmptyState.tsx` (the "Select a chat" pill), plus their tests
- `apps/web/src/lib/useSmoothText.ts`, plus its test: only for item 7
- `work/T-0047-redesign-chat-panel.md` and `work/screenshots/T-0047/**`

**Not allowed:** the sidebar components (T-0046 is done), `apps/mobile/**`, `apps/server/**`, `packages/**`, `docs/**`. Store logic can't change either: this is a visual task.

### Allowed dependencies
None.

### What to build (values in `ui-style.md` §4 and §5)

**1. Bubbles.**
- **Outgoing:** a glossy white key-like bubble (gradient `#fff → #dedede`, inner highlight, drop shadow, light text-shadow) with dark text and `#525252` mono meta.
- **Incoming:** a dark card (gradient `#252525 → #161616`, `--edge` border, top highlight, drop shadow, dark text-shadow).
- **Generating** (T-0045's `generating` state): **recessed**. That's the well background and shadow, `--generating-foreground` text, the caret, and a mono `generating` label with a pulsing dot. When the reply completes, the bubble transitions over 400 ms to the incoming look: color, background **and** shadow. **The same DOM node must stay** (T-0045's key). Keep all of T-0045's tests green.
- Radius 14 px with a 4 px tail corner, keeping D23's grouping (2 px within a group, 8 px between groups; only the last bubble of a group gets the tail corner). Also keep sender names and avatars in groups, restyled with the new tokens (sender name colors: pick a small **monochrome-friendly** set, e.g. light grays plus one accent, so they are still readable and distinct).
- Big emoji keep no bubble; their time pill is the raised pill.
- **Links:** `#ededed` underlined in incoming bubbles, `#0a0a0a` underlined in outgoing ones.

**2. Header.** 64 px, `rgba(10,10,10,.85)`, a bottom border, a 36 px avatar (the same `Avatar` as the list), name 15/600, the mono `AI` badge, subtitle 12, and search and more as **icon keys**. On narrow screens, the back button is an icon key too. `writing…` shows while an AI draft is active.

**3. Messages area.** The dot-grid background from T-0046, 24/32 px padding. The **date separator** and the **"Select a chat"** empty pill are the raised pill. The **unread divider** is a full-width well strip with muted text. The scroll-to-bottom button is an icon key with the unread count as a primary pill.

**4. Composer.** A well (`--well`, 14 px radius, 8 px padding) holding:
- the attach icon key;
- the auto-growing textarea (placeholder `Message <chat title>`);
- the emoji button as an icon key;
- the mic icon key when the input is empty, and the **send primary key** (36 px, 10 px radius, arrow-up icon) when there is text.

The reply bar above it is a well strip with a `#333` left bar. Keep all composer behavior.

**5. Rich messages.**
- **Voice:** the play button is a primary key (circle). The waveform shows the played part in `#ededed` and the rest in `#525252`. The transcript `Aa` is a small icon key.
- **Images:** a 12 px radius, a thin `--edge` border and the drop shadow; the time sits on the raised pill.
- **Reply quotes:** a `#333` bar, the name in `#d4d4d4`, the excerpt muted.
- **Progress and approval cards:** the incoming-card look. **Approve** is a primary key and **Deny** an outline key (T-0046's `outline` Button variant).
- **Message actions menu:** a `--surface` popover with a 1 px `--border-strong` border, 12 px radius and a soft drop shadow.

**7. Background tabs.** The browser pauses `requestAnimationFrame` in hidden tabs, so a reply that arrived while the tab was hidden animates only when you come back. When the page becomes visible again (`visibilitychange`), the reveal must **snap** to the current text instead. This only concerns replies written while hidden; a reply still streaming keeps animating normally. Add a test with a fake visibility seam.

**6. Reduced motion:** no pulsing, no caret blink, no press translation. The generating → finished change is instant.

### Tests (Vitest and Testing Library, no network)
- The existing tests pass. Update only selectors or text the redesign changes, and list each change.
- `MessageBubble`: outgoing, incoming and generating bubbles each carry their look (assert the utility class or data attribute you use). Generating → finished keeps the same node, and the look switches after the reveal completes.
- `Composer`: mic when empty, send key when there is text.
- A group chat still shows sender names and tails on the last bubble only.

### Visual check (you do it, then report)
Use the mock store (`?mock=1`) and the mock chats that have voice, images, replies and cards. Screenshot at 1440×900 and at 390×844:
- a DM;
- a group;
- the chat with voice and image;
- the approval card;
- the composer with text.

For the generating bubble, render the draft state in a test harness, or with the store seam the tests use, and screenshot it. Compare everything with `Main.dc.html`, and list the differences you chose to keep. Save to `work/screenshots/T-0047/`. **Stop any dev server you start.**

### Live check (the lead does it, with Julio's permission for any message sent)
In Julio's Helium: his three chats, a hard reload of each, an AI reply writing (gray and recessed, then pressed out), and scrolling up while it writes.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` all pass.
- [ ] The chat panel matches the mockup; the depth recipes are reused from T-0046's primitives or utilities, not copy-pasted.
- [ ] T-0045's smooth reveal and same-node swap still work, with their tests green.
- [ ] Only the Allowed files changed.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/web
pnpm build
```

### Out of scope
- Mobile (T-0048).
- A light theme and the accent setting.
- Other pages (AIs, Connections, login): only what T-0046 did.

## Report (written by the worker when done)

## Review (written by Claude)

---
id: T-0047
title: Web redesign (D24), part 2 — chat panel: header, glossy/recessed bubbles, composer well, pills, voice/image/cards
status: merged
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
pnpm exec turbo test --force --filter=@zilar/web
pnpm build
```

### Out of scope
- Mobile (T-0048).
- A light theme and the accent setting.
- Other pages (AIs, Connections, login): only what T-0046 did.

## Report (written by the worker when done)

### What I did

**1. Bubbles — `apps/web/src/index.css`, `MessageBubble.tsx`**
- Added three utilities, `bubble-out`, `bubble-in` and `bubble-gen`, with the exact ui-style.md §5 recipes (gradients, `--edge` border, inset highlights, drop shadows and text-shadows). The generating one reuses the `--well` color and the well shadow.
- Removed the old triangle-tail pseudo-elements (`.bubble-tail-out/in`). The tail is now the mockup's 4 px corner (`rounded-br-[4px]` outgoing, `rounded-bl-[4px]` incoming) on the last bubble of a group only; radius is 14 px; group spacing stays 2 px / 8 px.
- Each bubble carries `data-bubble-look="outgoing" | "incoming" | "generating"`.
- Generating → incoming uses `transition-[color,background,box-shadow,border-color] duration-[400ms] ease-out` (both backgrounds are 2-stop gradients and both shadows are 4-entry with the same inset pattern, so all three interpolate). Reduced motion turns the transition off.
- Links: unlayered `.bubble-out a { color:#0a0a0a }` / `.bubble-in a, .bubble-gen a { color:#ededed }` rules, both underlined. (`LinkText.tsx` isn't an allowed file, so the color is overridden by descendant CSS.)
- Sender names: a deterministic monochrome-friendly set (`#d4d4d4`, `#a1a1a1`, `#8a8a8a`, `#ededed`) instead of the colourful `avatarGradient`.
- Big emoji keep no bubble; their time pill is the `raised-pill` utility. Meta is mono 10 px (`#525252` outgoing, `--subtle-foreground` incoming).
- Generating shows the mono `generating` label with a pulsing dot (`pulse-dot`, so reduced motion stops it) and the `#bdbdbd` caret.

**2. Header — `ChatHeader.tsx`**
- 64 px, `bg-panel/85`, bottom border. 36 px `Avatar` (now `ai={chat.isAI}`, matching the list), name 15/600, `AiBadge`, subtitle 12. Search and more are `IconButton` keys; the back button is an icon key shown only below `wide`. `writing…` shows while `store.drafts[chat.id]` exists.

**3. Messages area — `MessageList.tsx`, `DateSeparator.tsx`, `UnreadDivider.tsx`**
- Content padding 24/32 px (`px-8 py-6` from `wide`, smaller on narrow).
- Date separator is the `raised-pill`; `EmptyState`'s "Select a chat" pill already was one.
- Unread divider is a full-width `well-surface` strip with muted text.
- Scroll-to-bottom button is an `IconButton` key with the unread count as a `key-primary` pill.

**4. Composer — `Composer.tsx`**
- One `Well` (`--well`, 14 px radius, 8 px padding) with the attach icon key, the auto-growing textarea, the emoji icon key, then either the send primary key (36 px, 10 px radius, arrow-up) when there is text or the mic icon key when empty. All recording behaviour kept.
- Placeholder is `Message <chat title>`, read from the store (`store.chats.find(...)`), so `ChatView.tsx` (layout only) didn't need a new prop.
- Reply bar is a `Well` strip with a `#333` left bar, `#d4d4d4` name and muted excerpt.

**5. Rich messages — `VoiceMessage.tsx`, `ImageMessage.tsx`, `ReplyQuote.tsx`, `ProgressCard.tsx`, `ApprovalCard.tsx`, `MessageActionsMenu.tsx`**
- Voice play button is a primary key (circle); played waveform `#ededed`, rest `#525252`; transcript `Aa` is a small `key-icon`.
- Images are 12 px radius with a thin `--edge` border and the drop shadow; the time uses the raised pill.
- Reply quotes use a `#333` bar, `#d4d4d4` name, muted excerpt.
- Progress/approval cards use the `bubble-in` look; **Approve** is a primary key, **Deny** uses T-0046's `outline` variant.
- Actions menu is `bg-surface` with a 1 px `--border-strong` border, 12 px radius and a soft shadow.

**7. Background tabs — `apps/web/src/lib/useSmoothText.ts`**
- New `VisibilitySource` seam (default: `document` `visibilitychange`). When the page becomes visible again the hook cancels the pending frame and snaps `shown`/`progress` to the current target; a reply still streaming then animates normally on the next target change. Reduced motion / `animate:false` is unaffected.

**Not changed:** `ChatView.tsx` (no layout edit was needed) and `EmptyState.tsx` (already the raised pill from T-0046).

### Files changed
- `apps/web/src/index.css`
- `apps/web/src/components/MessageBubble.tsx`, `MessageList.tsx`, `ChatHeader.tsx`, `Composer.tsx`, `DateSeparator.tsx`, `UnreadDivider.tsx`, `ReplyQuote.tsx`, `VoiceMessage.tsx`, `ImageMessage.tsx`, `ProgressCard.tsx`, `ApprovalCard.tsx`, `MessageActionsMenu.tsx`
- `apps/web/src/lib/useSmoothText.ts`
- Tests: `MessageList.test.tsx`, `MessageContent.test.tsx`, `useSmoothText.test.ts`
- `work/T-0047-redesign-chat-panel.md`, `work/screenshots/T-0047/**`

`git status` shows no other tracked file changed. No new dependencies.

### Test selector/text changes (spec asks to list each)
- `MessageList.test.tsx`: `.text-bubble-in-generating` → `[data-bubble-look="generating"]` (5 places). The generating class is gone because `bubble-gen` now sets the generating colour.
- `MessageContent.test.tsx`: `.bg-bubble-in` / `.bg-bubble-out` → `[data-bubble-look]`; added a positive check that a text message's bubble is `data-bubble-look="incoming"`.
- No user-visible text assertions changed.

### Tests added
- `MessageList.test.tsx`: outgoing and incoming looks; a live draft is `data-bubble-look="generating"`; a group shows each sender name once and the 4 px tail `rounded-bl-[4px]` only on the last bubble of each group.
- `useSmoothText.test.ts`: "snaps to the current text when the page becomes visible again", plus that a reply still streaming afterwards animates normally, using a fake `VisibilitySource`.

### Commands (real results)
```bash
pnpm install                                        # Done in 6.2s, 912 packages (pnpm 10.32.1)
pnpm format:check                                   # All matched files use Prettier code style!
pnpm lint                                           # no output, exit 0
pnpm typecheck                                      # Tasks: 9 successful, 9 total
pnpm exec turbo test --force --filter=@zilar/web   # Test Files 34 passed (34); Tests 206 passed (206)
pnpm build                                          # Tasks: 2 successful, 2 total; web built in 556ms
```

### Visual check
Served this worktree's Vite on `localhost:5230` with a throwaway mock auth server (in the approved temp dir, outside the repo) answering `/api/auth/get-session`, and opened the app with `?mock=1` in Chrome through the DevTools MCP. Screenshots in `work/screenshots/T-0047/`:
- `dm-1440.png`, `dm-390.png` — Ana (DM; voice + image).
- `group-1440.png`, `group-390.png` — Viernes 🍻 (group; sender names, replies, big emoji).
- `media-1440.png`, `media-390.png` — Dev team (image + voice + progress card).
- `approval-1440.png`, `approval-390.png` — Dev team (approval card, Approve/Deny).
- `composer-1440.png`, `composer-390.png` — Ana with text typed (send primary key).
- `generating-1440.png`, `generating-390.png` — Dev AI with a live draft. I set it through the same store seam the tests use (`store.setState({ drafts … })`), reached through the React root in the browser — no repo file was edited for it.

Compared with `Main.dc.html`. **Differences I chose to keep:**
- `.bubble-gen` has a 4th, soft outer shadow and a `linear-gradient(180deg, var(--well), var(--well))` background (renders as the flat `#0c0c0c` of the mockup) so background and shadow interpolate to the incoming look over 400 ms; the mockup has 3 shadows / a flat background.
- The mockup's composer shows mic and send together (illustrative); the task says mic when empty, send when text, so I follow the task.
- The mockup's `Today` pill uses a `#050505` border and `#a1a1a1` text; `raised-pill` gives that exactly. No other deliberate differences found at 1440×900 or 390×844.

Both dev servers were stopped (`lsof -ti :5230`, `:4319` show nothing).

### Live check (for the lead, with Julio's permission for any message sent)
1. Open an AI DM and ask for a longer answer. Expect: the reply appears **recessed** (well background, gray text, blinking caret, mono `generating` label with a pulsing dot), the header reads `writing…`; when it completes the same bubble fades over ~400 ms to the dark incoming card (background, text and shadow) with no snap.
2. Scrolling up while it writes must not pull the view down. Watch a reply arrive in a background tab: switch away, come back — the reveal must **snap** to the current text instead of animating.
3. Check a DM (white outgoing bubbles), a group (sender names, tails only on the last bubble of a group, big emoji without a bubble), a voice message, an image, a reply quote, the approval card (Approve primary key, Deny outline key) and the composer with text (send key) — at 1440×900 and ~390 px wide.

### Problems / notes
- No deviations from the acceptance criteria; `pnpm` checks all pass. No open questions.
- One nuance: the generating → incoming CSS transition relies on the browser interpolating same-structure gradients and box-shadows (true in Chromium; it snaps in any browser that doesn't). The look itself is correct either way.

## Review (written by Claude)

**Verdict: approved, merged.**

- Pre-review (Muse): no blockers. Two optional nits kept as is: `transitioning` stays true after the swap (harmless, since the transition only runs on a class change), and the `visibility` option is compared by identity (callers don't pass it).
- Scope: only allowed files changed. The depth looks reuse the T-0046 utilities (`bubble-out`, `bubble-in`, `bubble-gen`, `raised-pill`, `well`). T-0045's same-node swap tests still pass.
- Screenshots match `Main.dc.html` closely: glossy outgoing bubbles, dark incoming cards, a recessed generating bubble with the mono label, the composer well with icon keys, and the raised date pill.
- Live check in Julio's Helium (branch served on localhost:5174 against the live server): the DM, the group and the AI chat each render correctly after a hard reload, with no "Couldn't load". Sender names in the group are readable. The live "AI reply writing" check needs a sent message, so Julio will do it on 5173 after the merge.
- Small note: `senderColor` has its own FNV hash rather than sharing the avatar hash. That's fine for now.

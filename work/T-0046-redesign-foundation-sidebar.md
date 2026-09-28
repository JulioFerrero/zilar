---
id: T-0046
title: Web redesign (D24), part 1 — dark tokens, Geist, skeuomorphic key/well primitives, floating panels, sidebar
status: review
milestone: M2
branch: task/T-0046-redesign-foundation-sidebar
model: opencode-go/deepseek-v4.1-flash
depends_on: []
estimate: 1.5 days
---

# T-0046: Redesign, part 1 (foundation and sidebar)

## Spec (written by Claude, do not edit)

### Goal

Julio approved a new look on 2026-09-28 (decision D24): Telegram's layout in a Vercel-dark style (black, Geist, shadcn) with **real skeuomorphic depth**, meaning glossy raised buttons and bubbles and recessed fields. He loved it: "omg so much better i love it, lets do that".

This is part 1 of 2:
- **Part 1 (this task):** the foundation (tokens, fonts, dark only, the four depth primitives), the page layout with two floating panels, and the whole **sidebar** (search, folder segmented control, chat list, New chat).
- **Part 2 (T-0047, later):** the chat panel (header, bubbles, composer and so on).

Because the tokens change globally, the rest of the app turns dark automatically. Part 2 finishes the chat panel. Other screens (login, AIs, Connections, dialogs) only need to stay readable here, so fix anything that becomes unreadable.

**Quality bar:** it must look like the mockup, not "roughly dark". Compare your result with the mockup side by side. Take screenshots and look at them.

### Read first
- `AGENTS.md` (mandatory)
- `docs/design/ui-style.md`: **the whole file**. It's the spec for this redesign, and §4 has the exact depth recipes.
- `docs/design/mockups/README.md`, `Main.dc.html` and `Mobile.dc.html`: the approved mockup, with exact values in inline styles and in the `<style>` classes
- `apps/web/src/index.css`, `components/ui/button.tsx`, `routes/ChatShell.tsx`, `components/ChatList.tsx`, `ChatListItem.tsx`, `FolderTabs.tsx`, `SearchBar.tsx`, `NewChatButton.tsx`, `Avatar.tsx`, `AiBadge.tsx`, `EmptyState.tsx`, `Skeleton.tsx`

### Allowed files
- `apps/web/src/index.css`
- `apps/web/src/main.tsx`: only to import the font packages
- `apps/web/src/components/ui/**`: primitives such as `button.tsx`, and new `icon-button.tsx`, `well.tsx`, `segmented.tsx` if you want them
- `apps/web/src/routes/ChatShell.tsx`: the page and panel layout only
- `apps/web/src/components/ChatList.tsx`, `ChatListItem.tsx`, `FolderTabs.tsx`, `SearchBar.tsx`, `NewChatButton.tsx`, `Avatar.tsx`, `AiBadge.tsx`, `EmptyState.tsx`, `Skeleton.tsx`, plus their tests
- other `apps/web/src/**` files **only** for token or class renames that break the build or leave text unreadable. List each one in the Report.
- `apps/web/package.json`: only the two font dependencies below
- `pnpm-lock.yaml`
- `work/T-0046-redesign-foundation-sidebar.md`

**Not allowed:**
- `MessageBubble.tsx`, `MessageList.tsx`, `Composer.tsx`, `ChatHeader.tsx` and `routes/ChatView.tsx`: they belong to part 2, and T-0045 is changing the first two right now.
- `apps/mobile/**`, `apps/server/**`, `packages/**`, `docs/**`

### Allowed dependencies
- `@fontsource-variable/geist`
- `@fontsource-variable/geist-mono`

They're bundled by Vite. **No CDN fonts.** If these packages don't exist under those names, stop and ask in the Report.

### What to build

**1. Tokens and dark only.**
- Replace the light and dark palettes in `index.css` with the D24 tokens (`ui-style.md` §2), dark only. Remove the `prefers-color-scheme` switch; the `dark:` variant may stay but should be unnecessary.
- Keep the shadcn token names that components already use (`--background`, `--foreground`, `--muted-foreground`, `--primary`, `--border` and so on), mapped onto the D24 values. Add the new tokens: `--page`, `--panel`, `--surface`, `--surface-raised`, `--well`, `--border-strong`, `--edge`, `--subtle-foreground`, `--generating-foreground`, `--accent`/`--accent-foreground`.
- **Leave the bubble tokens that `MessageBubble` uses alone** (`--bubble-in` and friends, and `--bubble-in-generating`); part 2 changes them.
- Set `color-scheme: dark`.

**2. Fonts.** Geist for `--font-sans` and Geist Mono for a new `--font-mono`, both bundled.

**3. The depth primitives** (`ui-style.md` §4), implemented once:
- the **primary key** (`Button` default variant);
- the **icon key** (a `size="icon"` variant or an `IconButton`);
- the **well**;
- the **raised segment / pill**.

Rules:
- Use the exact gradients and shadows from §4, as CSS utilities in `index.css` (`@utility`) or component variants.
- The pressed state (`:active`) translates 1 px with the inset shadow.
- There's a visible **focus ring** on `:focus-visible`.
- With `prefers-reduced-motion`, there's no press translation.
- The text-shadow on primary keys follows the accent's lightness. The accent is white today; make the rule read from a token so a blue accent works later.

**4. Page layout** (`ChatShell`, wide ≥ 900 px):
- a black page, 12 px padding and a 12 px gap;
- two floating panels: the sidebar at 360 px and the chat panel filling the rest;
- both panels use `--panel`, a 1 px `--border` border, 16 px radius and `overflow: hidden`.

Narrow screens keep one pane at a time, as today. There, the panels may go edge to edge with no outer margin.

**5. Sidebar**, matching the mockup:
- the top row: the menu **icon key** and the search **well** with a mono `⌘K` hint (keep the existing Ctrl/Cmd+K focus behavior if it exists; if not, add it only inside `SearchBar`);
- the folders as a **segmented control**: a well track with equal-width tabs, the active tab a raised segment, keeping the unread count pills;
- chat rows per `ui-style.md` §5:
  - 44 px monochrome avatars, deterministic by id;
  - the online dot;
  - the `AI` badge in mono;
  - times in mono;
  - the unread badge as a primary pill;
  - ticks;
  - `writing…` with a pulsing dot when a draft or typing is active (use the store's existing `typing` and `drafts`);
  - hover and selected rows in `--surface-raised`;
- **New chat:** a full-width primary key at the bottom of the sidebar on wide screens, with a mono `N` hint (it opens the existing menu), and the primary FAB on narrow screens;
- skeleton rows and the empty state restyled to fit.

**6. Everything else stays usable.** Look at login, `/settings/ais`, `/settings/connections` and the dialogs (New AI, New group, invite). They should be readable and on-palette, using the new primitives where a button already exists, but don't redesign them.

### Tests (Vitest and Testing Library, no network)
- The existing tests pass. Update only selectors or text that the redesign changes, and list each change.
- `Avatar`: the same id always gets the same shade, and AIs get the light avatar.
- `FolderTabs`: it's a segmented control with the right `aria` (for example `role="tablist"`/`tab` with `aria-selected`) and keyboard arrows, if you add them.
- `ChatListItem`: shows `writing…` while a draft exists for that chat.

### Visual check (you do it, then report)
Run the app with the mock store (`?mock=1`) or the live stack from your rules. Screenshot:
- the list at 1440×900;
- narrow at 390×844;
- the login screen;
- `/settings/ais`.

Compare the list with `docs/design/mockups/Main.dc.html` and `Mobile.dc.html`, open them in a browser. You can view `.dc.html` files statically: holes like `{{accent}}` just show as text. Describe every difference you chose to keep and why. Save the screenshots under `work/screenshots/T-0046/` (allowed, add them to the commit).

### Live check (the lead does it)
The list in Julio's Helium: reload, check that no chat order or loading regressions come back (T-0042 and the live fixes), the folders, search, New chat, and dark on other screens.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` all pass.
- [ ] The sidebar and page layout match the mockup, with depth recipes exactly as in `ui-style.md` §4.
- [ ] Geist is bundled, not loaded from a CDN.
- [ ] Dark only, and no screen is left unreadable.
- [ ] Only the Allowed files changed, plus the listed rename-only fixes.

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
- The chat panel (T-0047): header, bubbles, composer, date pills, cards.
- Mobile (a later task).
- A light theme and the accent setting UI.

## Report (written by the worker when done)

### What I did

Implemented part 1 of D24: dark-only tokens, bundled Geist/Geist Mono, the four depth
primitives in `index.css`, the two floating panels in `ChatShell`, and the whole sidebar.

**Tokens (`index.css`).** Replaced the light + `prefers-color-scheme` palettes with the
D24 tokens in `:root`, dark only, `color-scheme: dark`. The shadcn names stay and are
mapped (`--background` → `--panel`, `--primary` → `--accent`, `--divider` → `--border`,
`--list-hover`/`--list-active` → `--surface-raised`, …). Added `--page`, `--panel`,
`--surface`, `--surface-raised`, `--well`, `--border-strong`, `--edge`,
`--subtle-foreground`, `--generating-foreground`, `--accent`/`--accent-foreground`, and
the `--color-*`/`--font-*` theme entries. The `dark:` variant is kept but redefined as
class-based (`&:where(.dark, .dark *)`), so it is inert now that the app is always dark.

**Fonts.** Added `@fontsource-variable/geist` and `@fontsource-variable/geist-mono`
(both exist at 5.3.0), imported in `main.tsx`, wired to `--font-sans` (Geist Variable) and
the new `--font-mono` (Geist Mono Variable). Both are bundled by Vite: the build output
contains `dist/assets/geist-*.woff2` and `geist-mono-*.woff2`. No CDN.

**Depth primitives** (`@utility` in `index.css`, exact §4 recipes):
`key-primary`, `key-icon`, `well-surface`, `raised-pill`, `segment-raised`.
`Button`'s `default` variant uses `key-primary`; the new `IconButton`
(`components/ui/icon-button.tsx`) uses `key-icon`; the new `Well`
(`components/ui/well.tsx`) uses `well-surface`. `:active` translates 1 px with the inset
shadow, `:focus-visible` shows the ring, and the reduced-motion block removes the
translation and the pulsing/typing animations. The primary key's text-shadow reads from
`--key-text-shadow`, so a dark (blue) accent flips it later.

**Layout (`ChatShell`).** Wide ≥ 900 px: black page, 12 px padding, 12 px gap, a 360 px
sidebar panel and a filling chat panel, both `--panel` + 1 px `--border` + 16 px radius +
`overflow: hidden`. Narrow keeps one pane edge to edge.

**Sidebar.** Menu icon key + search well with a mono `⌘K` (Ctrl/Cmd+K kept in `SearchBar`);
folders as a segmented control (well track, equal tabs, raised active segment, unread
pills, `role=tablist`/`tab` + `aria-selected`, arrow/Home/End keys); rows per §5
(monochrome avatars, online dot with a row-matched ring, mono `AI` badge, mono times,
unread as a primary pill, ticks, `writing…` with a pulsing dot for an AI draft or AI
typing while people keep D23's `typing…` / `Ana is typing…` with the same dot,
hover/selected in `--surface-raised`); a full-width primary **New chat** key with a mono `N`
on wide screens and the primary FAB on narrow; skeleton rows and the empty pill restyled.
Narrow (< 900 px) follows §1/`Mobile.dc.html`: a 28/600 `Chats` title with the menu key on
the right, the `⌘K` hint hidden, 52 px avatars and `#1a1a1a` hairline separators under the
row text.

**Depth verification.** Built CSS contains `key-primary`, `key-icon`, `well-surface`,
`segment-raised`, `--key-shadow`, `pulse-dot` (checked in `dist/assets/index-*.css`).

### Files changed (all inside Allowed files)

- `apps/web/src/index.css`, `apps/web/src/main.tsx`
- `apps/web/src/components/ui/button.tsx`; new `ui/icon-button.tsx`, `ui/well.tsx`
- `apps/web/src/routes/ChatShell.tsx`
- `apps/web/src/components/{ChatList,ChatListItem,FolderTabs,SearchBar,NewChatButton,Avatar,AiBadge,EmptyState,Skeleton}.tsx`
- tests: new `ChatListItem.test.tsx`, `FolderTabs.test.tsx`; extended `Avatar.test.tsx`
- `apps/web/package.json` (the two fonts), `pnpm-lock.yaml`
- `work/T-0046-redesign-foundation-sidebar.md`, `work/screenshots/T-0046/*`

Outside the component list under “Allowed files”: `apps/web/src/components/TypingIndicator.test.tsx`.
It is an existing cross-cutting test of typing, not a test of one of the listed components,
and the redesign changes the list's typing text, so its string assertions had to change. No
other file outside the Allowed set changed.

### Test changes (selectors/text the redesign changes)

- `TypingIndicator.test.tsx` (see the outside-the-list note above): updated for the changed
  list typing text. Final state: DM list rows show `typing…`, group rows show
  `Luis is typing…`, and the header keeps D23's `typing`.
- `Avatar.test.tsx`: added “same id → same rendered shade” (renders twice), “AIs get the
  light avatar”, and a person-shade check.
- New `FolderTabs.test.tsx`: `role=tablist`/`tab` with `aria-selected`, and arrow-key
  selection + focus.
- New `ChatListItem.test.tsx`: `writing…` for an AI draft, and `typing…` while a person types.
- No other existing test needed changes (`ChatList.test.tsx`, `ChatShell.test.tsx`, etc.
  still pass unchanged).

### Commands (real results)

```bash
pnpm install                                   # ok, +2 packages (the two fonts)
pnpm format:check                              # All matched files use Prettier code style!
pnpm lint                                      # ok (oxlint, no findings)
pnpm typecheck                                 # 9 successful, 9 total
pnpm exec turbo test --force --filter=@galena/web
                                               # 33 files, 187 tests passed
pnpm build                                     # 2 successful, 2 total; web built in 450ms
```

### Visual check

Screenshots in `work/screenshots/T-0046/`: `list-1440.png`, `list-390.png`,
`login-1440.png`, `ais-1440.png`, plus `connections-1440.png`,
`new-ai-dialog-1440.png`, `chat-1440.png`, `newchat-menu-1440.png`.

Served this worktree's Vite on `localhost:5199` (`GALENA_API_URL=http://localhost:3188`)
and opened it in the DevTools browser. To render authenticated screens without signing in
as anyone, I used `?mock=1` and an init-script that answers `/api/auth/get-session` with a
fake user (same shape the tests inject); `/api/ais` and `/api/connections` were stubbed for
the AIs/Connections screenshots. The live stack (Julio's `[::1]:5173`, server `:3188`) was
never navigated or signed into.

- `list-1440.png` compares well with `Main.dc.html`: two floating panels, 360 px sidebar,
  segmented control, glossy `New chat` key with the `N` hint, and the centered raised
  “Select a chat to start messaging” pill on the dot grid. AI avatars are light; people
  and groups are monochrome.
- `list-390.png` now follows §1/`Mobile.dc.html`: a 28/600 `Chats` title with the menu key
  on the right, the search well without the `⌘K` hint (keyboard-only anyway), 52 px avatars,
  `#1a1a1a` hairline separators under the row text, and the primary FAB bottom-right.
- `login-1440.png`, `ais-1440.png`, `connections-1440.png`, `new-ai-dialog-1440.png`:
  dark, readable, on-palette, with the new key buttons.
- `chat-1440.png` (refreshed in round 2): the part-2 chat panel is left as-is and is still
  readable after the token change (incoming #182533, outgoing #2b5278, white text on both);
  it also shows the fixed person typing: Ana `typing…`, Viernes `Luis is typing…`.

### Deviations from the spec (chosen, with reasons)

1. **Bubble tokens.** Since the file is dark-only now, `--bubble-in/-out/-in-meta/-out-meta`
   hold their previous *dark* values. `MessageBubble`/messages were not touched; part 2
   repaints them.
2. **Focus rings** use `outline: 2px solid var(--muted-foreground); outline-offset: 2px`
   rather than appending box-shadow rings. On `--panel` that is the same visible result
   (2 px gap + 2 px ring) and it composes with the `:active` shadows.
3. **FAB shadow.** The FAB keeps the primary key's depth. I did not add the mockup's extra
   `0 8px 24px` float shadow: it would override the `:active` box-shadow and break the press
   state (the mockup's inline style has the same issue).
4. **`/settings/ais` avatars.** `AisPage` passes no `ai` prop and is not in the Allowed
   files, so its AI avatars use the deterministic person shade (still readable/on-palette);
   the chat list's AI avatars are light. A one-line follow-up (`<Avatar … ai />`) would fix
   it if wanted.
5. **Segmented track border** is `#1a1a1a` (the §4 track value) via an inline `borderColor`
   on top of `well-surface`'s `--border`; otherwise exact.
6. `--chat-background` is now the D24 dot grid (`#0a0a0a` + 22 px `#1c1c1c` dots), so the
   part-2 messages area already matches §1's chat background. Token only.

### Problems / needs attention

- No signing in as anyone: “dark on other screens” and the live-reload check remain the
  lead's live check.

### Review fixes (round 2)

All seven review points addressed; nothing else changed.

1. **Typing label regression — fixed.** `ChatListItem` now shows `writing…` only for an AI
   chat (`chat.isAI && (draft || typing)`); people keep D23's wording with the ellipsis and
   the new pulsing dot: `typing…` in DMs, `Ana is typing…` in groups. Verified live in
   `chat-1440.png`: Ana `typing…`, Viernes `Luis is typing…`.
2. **`link` focus ring — fixed.** Added `PLAIN_FOCUS` to the `link` variant in
   `components/ui/button.tsx`.
3. **Mobile list — implemented** in `ChatList`/`ChatListItem`/`SearchBar`: a 28/600
   `-0.02em` `Chats` title row with the 40 px menu key on the right, the `⌘K` hint hidden
   (`hidden wide:inline-block`), 52 px avatars and a `1px #1a1a1a` separator under each row's
   text (`border-b` on the content column, so it does not run under the avatar). See the
   refreshed `list-390.png`.
4. **`Well` — now used** by `SearchBar` and `FolderTabs` (both wrap in `<Well>`), so it is
   no longer dead code.
5. **Icon-key pressed state — exact.** `key-icon:active` is now
   `inset 0 2px 5px rgba(0,0,0,.9)` plus the 1 px translate; the extra white line was dropped.
6. **Avatar test — renders twice.** The “same id → same shade” test now renders `<Avatar>`
   twice and compares `style.backgroundColor`, instead of calling the pure function twice.
7. **Report accuracy — fixed.** `TypingIndicator.test.tsx` is now called out as a changed
   file outside the Allowed component list, with the reason.

Re-ran every check on the final tree:

```bash
pnpm format:check                              # All matched files use Prettier code style!
pnpm lint                                      # ok (oxlint, no findings)
pnpm typecheck                                 # 9 successful, 9 total
pnpm exec turbo test --force --filter=@galena/web
                                               # 33 files, 188 tests passed (+1 new test)
pnpm build                                     # 2 successful, 2 total; web built in 624ms
```

Screenshots refreshed with a self-terminating Vite (`perl -e 'alarm 150; exec @ARGV' …`, so
no `kill` needed): `list-1440.png`, `list-390.png` and `chat-1440.png` (the last because the
old one still showed the fixed `writing…` regression). The server self-terminated; nothing is
listening on `:5199` now. Round 1's `:5199` Vite was the one the lead stopped.

## Review (written by Claude)

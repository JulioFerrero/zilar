---
id: T-0046
title: Web redesign (D24), part 1 — dark tokens, Geist, skeuomorphic key/well primitives, floating panels, sidebar
status: planned
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

## Review (written by Claude)

---
id: T-0062
title: Web QA fixes — Esc closes every menu and dialog, reduced motion covers the spinner and skeleton, a few cheap polish items
status: review
milestone: M2
branch: task/T-0062-web-qa-fixes
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0060]
estimate: 0.5 day
---

# T-0062: Web QA fixes

## Spec (written by Claude, do not edit)

### Goal

T-0060's QA sweep (`work/T-0060-web-qa-sweep.md`) found two real bugs and some cheap polish. Fix them.

### Read first
- `AGENTS.md` (mandatory)
- `work/T-0060-web-qa-sweep.md`, Bugs 1 and 2 and polish items 1, 2, 5 (the ones this task covers)
- `docs/design/ui-style.md` §4 (focus rings), §6 (motion)
- `apps/web/src/components/NewChatButton.tsx`, `NewGroupDialog.tsx`, `ais/NewAiDialog.tsx`, `Skeleton.tsx`, `ProgressCard.tsx`, `index.css`, `MessageActionsMenu.tsx`

### Allowed files
- `apps/web/src/components/NewChatButton.tsx`, `NewGroupDialog.tsx`, `ais/NewAiDialog.tsx`, `InviteDialog.tsx`, `Skeleton.tsx`, `ProgressCard.tsx`, `ChatList.tsx`, `SearchBar.tsx`, `ApprovalCard.tsx`, `index.css`, `MessageActionsMenu.tsx`, `Composer.tsx`
- Their test files
- `work/T-0062-web-qa-fixes.md` and `work/screenshots/T-0062/**`

**Not allowed:** anything else. In particular, don't touch reactions, edits or deletes: T-0059 and T-0061 own that ground.

### What to fix

1. **Bug 1 — Esc closes every menu and dialog.**
   - The New chat menu (`NewChatButton.tsx`): Esc closes it regardless of whether focus is on the trigger button or inside the menu. A document-level (or container-level) Escape handler while the menu is open, not just the menu's own `onKeyDown`.
   - `NewGroupDialog.tsx`, `ais/NewAiDialog.tsx`, and the inline "New message" dialog: add an Escape handler that closes/cancels them, same as clicking Cancel or the overlay.
   - Closing returns focus to the control that opened it (the New chat trigger, or the menu item that opened the dialog).
   - Test each: menu Esc-closes from both focus positions; each dialog Esc-closes and returns focus.

2. **Bug 2 — reduced motion covers all animation.**
   - Extend the `prefers-reduced-motion: reduce` block in `index.css` to also stop `animate-pulse` (the loading skeleton) and `animate-spin` (the progress spinner, `Loader2` in `ProgressCard.tsx`).
   - Under reduced motion, the skeleton can show a static muted fill instead of pulsing, and the spinner can show a static icon (still legible as "in progress") instead of spinning. Don't remove the loading semantics, just the motion.
   - Test with the media query mocked/emulated in Testing Library (`window.matchMedia`), asserting the relevant class or style is absent/static.

3. **Polish (do all three, they're cheap):**
   - Polish 1: push an explicit `outline` on focus rings (2px, `#a1a1a1`, matching ui-style.md §4) instead of relying on the UA default.
   - Polish 2: add `id`/`name` to the search input and the message composer textarea.
   - Polish 5: Approve/Deny buttons (currently `console.log`-only no-ops) get `disabled` plus a small "coming soon" affordance (a `title` tooltip is enough; don't invent a bigger feature).

### Visual check
Mock mode, 1440×900: the New chat menu and each dialog open, Esc closing them; the reduced-motion skeleton and spinner (emulate the media query); the focus ring on a key. Screenshots to `work/screenshots/T-0062/`. **Stop any dev server you start.** Use `localhost`, not `127.0.0.1`. Never use ports 3000, 3188, 5173, 8081.

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
- Wiring Approve/Deny to anything real.
- The AI panel's mock-fixture gap (a separate follow-up).
- Anything reactions/edit/delete related.

## Report (written by the worker when done)

### What I did

Fixed both bugs and all three polish items, staying inside the task's
**Allowed files**. Read `AGENTS.md`, `docs/design/ui-style.md` (§2, §4, §6, §7)
and T-0060's Bug 1, Bug 2 and polish items 1, 2 and 5 first.

**Bug 1 — Esc closes every menu and dialog.**
- `NewChatButton.tsx`: the menu's escape handling moved from the `role="menu"`
  `onKeyDown` to a document-level listener while `menuOpen` is true, so Esc
  closes the menu whether focus is on the trigger or inside the menu. Added a
  `triggerRef` and one `focusTrigger()` used by the menu close, the overlay
  click, every dialog close and the inline "New message" close, so closing
  returns focus to the control that opened it.
- `NewGroupDialog.tsx`, `ais/NewAiDialog.tsx`: a document-level Escape listener
  that calls `onClose()` (same as Cancel / the overlay).
- The inline "New message" dialog (owned by `NewChatButton`) got its own
  document-level Escape listener. `InviteDialog` was left as-is: it was not in
  the spec list and its close paths already matched the others.

**Bug 2 — reduced motion covers all animation.**
- The skeleton and the spinner keep the Tailwind `animate-pulse`/`animate-spin`
  utilities (so the loading meaning is unchanged) and the components add a
  `skeleton-reduced`/`spinner-reduced` marker class when
  `prefers-reduced-motion: reduce` matches.
- A subtlety worth recording: a plain rule inside the existing unlayered
  `@media (prefers-reduced-motion: reduce)` block does **not** beat Tailwind's
  utilities layer, and a rule written *before* the utilities loses to the base
  `.animate-pulse`/`.animate-spin` by source order (proved in the browser on
  the real dev CSS). The marker classes are therefore declared with `@utility`
  in `index.css`, which emits them into the same utilities layer **after** the
  animate classes, and the reduced-motion block also matches them. The built
  `dist/assets/*.css` proves the final order:
  `.animate-pulse{…animation:var(--animate-pulse)}.animate-spin{…}.skeleton-reduced,.spinner-reduced{animation:none}`.
  I verified the computed styles in a live Chrome: unmarked elements keep
  `pulse`/`spin`, marked ones compute `animation: none`. The skeleton falls back
  to a static mute fill and the spinner to a static icon, so both stay legible
  as "in progress".

**Polish.**
1. `index.css`: an explicit `:focus-visible { outline: 2px solid
   var(--muted-foreground); outline-offset: 2px }` (2 px, `#a1a1a1`, matching
   ui-style.md §4). Verified in the browser: a keyboard-focused key computes
   `outline: 2px solid rgb(161,161,161)` with a 2 px offset instead of the UA
   `auto` ring. It is a weaker declaration than the utilities layer, so the
   component-level `focus-visible:outline-none` / ring utilities still win.
2. `SearchBar.tsx` input gets `id="chat-search" name="chat-search"`;
   `Composer.tsx` textarea gets `id="message-composer" name="message"`.
3. `ApprovalCard.tsx`: Approve and Deny get `disabled` and
   `title="Approvals are coming soon"`.

### Files changed

- `apps/web/src/components/NewChatButton.tsx`, `NewGroupDialog.tsx`,
  `ais/NewAiDialog.tsx`, `Skeleton.tsx`, `ProgressCard.tsx`, `SearchBar.tsx`,
  `ApprovalCard.tsx`, `Composer.tsx`, `index.css`
- Tests: `NewChatButton.test.tsx`, `ais/NewAiDialog.test.tsx`,
  `Skeleton.test.tsx`, `ApprovalCard.test.tsx`, `Composer.test.tsx`,
  `ProgressCard.test.tsx` (new)
- `work/T-0062-web-qa-fixes.md`, `work/screenshots/T-0062/**`

### Commands I ran (real results)

- `pnpm install`: "Already up to date", 6.9 s.
- `pnpm format:check`: "All matched files use Prettier code style!"
- `pnpm lint`: clean (oxlint, no output).
- `pnpm typecheck`: 9 successful, 9 total (8 cached).
- `pnpm exec turbo test --force --filter=@galena/web`: **313 passed** across
  40 files. My first run failed 1 of 313 (`ApprovalCard` "logs the decision to
  the console" — `disabled` blocks the stub click); I updated that test to
  assert the disabled buttons do not fire the stub, then all 313 pass. New
  tests added: 5 Esc tests in `NewChatButton.test.tsx` (menu from the trigger,
  menu from inside, and the New group / New message / New AI dialogs, each also
  asserting `document.activeElement` is the trigger), 1 Esc test in
  `NewAiDialog.test.tsx`, 2 reduced-motion skeleton tests, 2 `ProgressCard`
  tests (spinning by default, `spinner-reduced` under reduce), 1 id/name test
  for the composer and 1 for the chat search, and the reworked `ApprovalCard`
  disabled/tooltip test.
- `pnpm build`: 2 successful, 2 total; `dist/assets/index-*.css` contains the
  reduced-motion `.skeleton-reduced,.spinner-reduced{animation:none}` rule
  after the animate utilities.
- Visual check (mock mode, 1440×900, Vite on port 5262 from this worktree, API
  proxied to a throwaway local stub on 5263 to supply a session):
  - the New chat menu, Esc closing it and returning focus to the trigger;
  - New group / New message / New AI opening, Esc closing each and focus
    returning to the trigger;
  - the explicit 2 px `#a1a1a1` focus ring on a key;
  - the progress-card spinner spinning normally and static under emulated
    `prefers-reduced-motion: reduce` (`spinner-reduced`, `animation: none`);
  - the skeleton markup under reduce computing `animation: none`;
  - Approve/Deny disabled with the "Approvals are coming soon" tooltip;
  - search input `id`/`name` and composer `id`/`name` in the live DOM;
  - console clean (only `[vite] connecting/connected` and the React DevTools hint).
  - Screenshots in `work/screenshots/T-0062/` (10 PNGs).
- **My Vite and the stub are stopped**: `lsof -nP -iTCP:5262/-5263 -sTCP:LISTEN`
  is empty for both.

### Behaviour change worth noting

Approve/Deny are now `disabled`, so the `console.log('approve'/'deny', id)` stub
can no longer be clicked (that stub is a no-op anyway; the spec asked for the
disabled + "coming soon" affordance). The corresponding test now asserts the
stub does not fire. If the lead wants the stub to remain clickable, the
affordance would need a different treatment — say so and I will adjust.

### Deviations and limitations

- The spec says the reduced-motion block in `index.css` should "extend to stop
  `animate-pulse`/`animate-spin`". Because of the layer/order behaviour above,
  the reset for those two classes only takes effect when the marker class is
  present (which the components always add under reduce). I also put the
  reset inside the existing `@media (prefers-reduced-motion: reduce)` block, so
  the CSS is correct on its own for elements carrying the marker classes.
- The reduced-motion skeleton screenshot (`09-…`) is the component's exact
  markup mounted manually: the mock store resolves instantly, so the real
  skeleton never renders at runtime and cannot be held from outside the app. The
  authoritative checks for it are the unit test and the live computed-style probe.
- The emulated `prefers-reduced-motion` in the visual check was driven by
  overriding `window.matchMedia` via a navigation init script (the available
  browser tooling cannot set the CDP media feature), which is the same approach
  T-0060 used; the built CSS and the unit tests are the primary evidence.
- I did not touch `InviteDialog.tsx` (not listed in the spec's dialog list), so
  Esc over it closes the "New message" dialog underneath via propagation, then
  the trigger still receives focus.

### Open questions

- None blocking. The Approve/Deny stub-click change above is the only judgement
  call; the rest follows the spec.

## Review (written by Claude)

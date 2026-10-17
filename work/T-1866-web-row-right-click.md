---
id: T-1866
title: "Web: right-clicking a chat row opens its chat actions menu (the same ChatActionsMenu as the hover ⋯ button), like Telegram desktop and the phone's long-press"
status: merged
milestone: M5
branch: task/T-1866-web-row-right-click
model: auto
effort: default
depends_on: []
estimate: 15 min
---

# T-1866: Right-click a chat row for its menu (web)

## Spec (written by Claude, do not edit)

### Why
**Julio's easy-life pass (2026-10-17).** On the phone, a long-press on a chat row opens its actions (`apps/mobile/src/components/chat/chat-rows.tsx:45`). On the web, the actions open only from a small ⋯ button that appears on hover. Telegram desktop opens the chat menu on right-click.

### Facts (read by the lead on 2026-10-17)
- **`apps/web/src/components/ChatListItem.tsx`** (229 lines):
  - `const [menuOpen, setMenuOpen] = useState(false)` (`:91`);
  - the row is a `<Link to={/c/...}>` (`:101`);
  - the ⋯ `Button` toggles `menuOpen` with `preventDefault` and `stopPropagation` (`:208-224`);
  - `{menuOpen && <ChatActionsMenu chat={chat} onClose={() => setMenuOpen(false)} />}` (`:226`).

### Steps
1. **On the row `<Link>`** (`:101`), add `onContextMenu={(event) => { event.preventDefault(); setMenuOpen(true); }}`. The menu opens where it already opens today, so don't add positioning.
2. **No other change.** No tests (UI).

### Allowed files
- `apps/web/src/components/ChatListItem.tsx`
- `work/T-1866-web-row-right-click.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **A right-click on a chat row** opens that chat's actions menu instead of the browser menu.
- **A left-click** still opens the chat.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- Added an `onContextMenu` handler to the chat row `<Link>` in
  `apps/web/src/components/ChatListItem.tsx`: it calls `event.preventDefault()`
  (so the browser menu does not appear) and `setMenuOpen(true)`, which opens the
  existing `ChatActionsMenu` in the same place the hover ⋯ button does.
- No positioning logic, no other changes. Per the spec, no tests (UI).

### Checks run

- `pnpm install` — done, 17.6s, no errors (one pre-existing peer warning about
  `@types/react` 19.2.18 vs `^19.3.0`).
- `pnpm gate` — GATE PASS. Summary lines:
  - `gate: 2 changed file(s) against main`
  - `PASS  install (frozen)  (1.7s)`
  - `PASS  format  (0.8s)`
  - `PASS  lint  (1.4s)`
  - `PASS  typecheck  (4.3s)`
  - `PASS  effect  (0.8s)`
  - `SKIP tests @zilar/web (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
- No single test files were run: the change is UI-only and the spec says no tests.

### Notes for the lead

- Files changed: `apps/web/src/components/ChatListItem.tsx` (4 added lines) and
  this task file.
- The ⋯ button still works as before; its click handlers are untouched, so a
  left-click on the row still navigates and its `stopPropagation` keeps the
  button from triggering navigation.
- I did not manually exercise this in a browser; verified by code reading plus
  the gate. Worth a quick right-click in the live check.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `1f6f6cbc7`.
- **The mock check** ran on the branch in vite at 1440 px: a Playwright right-click on Marta's row opens the chat actions menu (Pin, Mute…, Archive chat, Mark as unread, Clear history) beside the row, and the browser menu doesn't appear.

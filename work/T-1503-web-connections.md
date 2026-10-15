---
id: T-1503
title: "Web Connections (approved canvas): one list of keys with a status dot and a ⋮ menu (Test key, Replace key, Delete), 'Add key' in the header, no status words"
status: merged
milestone: M5
branch: task/T-1503-web-connections
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1503: Web Connections

## Spec (written by Claude, do not edit)

### Why
Julio approved the Connections design on 2026-10-15 ("connects are okay"). The boards are in `docs/design/mockups/connections/` (`Main.dc.html` is web); read its `README.md` first.

The page becomes one rounded list of keys. Each row has:
- a status dot (green: working, red: not working);
- the provider name;
- one muted line;
- a ⋮ key that opens Test key, Replace key and Delete.

"Add key" moves to the header. The status word badge goes away.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/web/src/routes/ConnectionsPage.tsx` (349 lines):**
  - `:57-61` `SettingsShell` with title, subtitle and `onBack`;
  - `:75-82` the empty state;
  - `:84-104` the list section with its own "Add a connection" button;
  - `:152-288` `ConnectionRow`:
    - the status word badge `{connection.status}` at `:189-191`;
    - the meta line at `:193-203`;
    - the host line for a custom base URL (`hostOf`);
    - the test outcome text at `:205-209`, and "Key replaced" at `:209`;
    - the two-step remove (`confirming`, `:227`);
    - three icon buttons (Zap, KeyRound, Trash2);
  - `:290-349` `ReplaceKeyForm`.
- **`apps/web/src/components/SettingsShell.tsx` (53 lines):** `subtitle: string` is required, and the header has no slot for an action.
- **Connection status:** `ConnectionView.status` is a plain string (`packages/api-contract/src/connections.ts:100`), and the server only writes `'active' | 'revoked'` (`apps/server/src/connections/service.ts:18`). No failure state is stored on the server. A failed test is known only in the page.
- **The kit:**
  - `IconButton` (`apps/web/src/components/ui/icon-button.tsx`, 36 px by default);
  - `Menu` and `MenuItem` (`apps/web/src/components/ui/menu.tsx:54,110`; `MenuItem` takes `icon`, `onSelect` and `destructive`);
  - `useToast` (`apps/web/src/components/ui/toast.tsx:66`);
  - the primary `Button` (`apps/web/src/components/ui/button.tsx:15`).
  - The pattern to copy for a row's ⋮ menu is `apps/web/src/components/sticker/PackMenu.tsx`.

### Steps
1. **`apps/web/src/components/SettingsShell.tsx`:**
   - `subtitle` becomes optional; leave out the `<p>` when it is absent;
   - add an optional `action?: ReactNode`, rendered at the right end of the title row (`ml-auto`).
   - Every other page keeps working unchanged.
2. **Move the row out.** Move `ConnectionRow` and its helpers (`hostOf`, `testOutcome`) into a new `apps/web/src/components/connections/ConnectionRow.tsx`, and `ReplaceKeyForm` into a new `apps/web/src/components/connections/ReplaceKeyForm.tsx`, so every file stays well under 400 lines.
3. **The page (`ConnectionsPage.tsx`):**
   - `SettingsShell` with the title "Connections", no subtitle, and as `action` a primary `Button` with a lucide `Plus` icon and the text "Add key", which opens `AddKeyDialog`;
   - the empty state's title becomes "No keys yet", and its action is "Add key";
   - the list section loses its own heading and button. It is one `<ul>` card (`rounded-xl border border-border bg-surface`) whose rows are divided by `border-b border-divider`, with none after the last row.
4. **The row (`ConnectionRow.tsx`), following `docs/design/mockups/connections/Main.dc.html`:**
   - **Layout:** `flex items-center gap-3 py-3 pr-2.5 pl-4`.
   - **The dot:** an 8 px round dot with `role="img"`.
     - Green (`bg-online`, `aria-label="Working"`) when `status === 'active'` and the last test in this page did not fail.
     - Red (`bg-danger`, `aria-label="Not working"`) when `status !== 'active'` or the last test failed.
   - **The name:** `providerLabel(provider)`, `text-[14px] font-semibold`.
   - **The muted line** (`text-[13px] text-muted-foreground`), its parts joined with " · ":
     1. when not working, the reason in `text-danger`: the failed test's message, or "Key revoked" when the status is not active;
     2. the label, if any;
     3. the host, for a custom base URL;
     4. the short date (the current `Intl.DateTimeFormat` call), without the word "Added".
   - **No status badge.** The status word goes away.
   - **A ⋮ `IconButton`** (lucide `MoreVertical`, `aria-label="<Provider> key actions"`) opens a `Menu` aligned to the end, with:
     - **Test key** (`Zap`): runs the test. A pass shows the toast "Key works" and makes the dot green; a fail shows the reason on the muted line and makes the dot red;
     - **Replace key** (`KeyRound`): opens the existing `ReplaceKeyForm` under the row. After a save, show the toast "Key replaced" and forget any failed test;
     - **Delete** (`Trash2`, `destructive`): the existing two-step confirm, with the right side showing "Delete" (destructive) and "Cancel". The failure text stays as it is.
   - Remove the three separate icon buttons.
5. **Commit the boards.** The lead has already committed `docs/design/mockups/connections/` on this branch; do not edit them.

### Not in scope
- the server (no stored key-failure state; a later task);
- `AddKeyDialog`;
- the mobile app.

### Tests
None (UI code, CLAUDE.md Hard rules).

### Allowed files
- `apps/web/src/components/SettingsShell.tsx`
- `apps/web/src/routes/ConnectionsPage.tsx`
- `apps/web/src/components/connections/ConnectionRow.tsx` (new)
- `apps/web/src/components/connections/ReplaceKeyForm.tsx` (new)
- `work/T-1503-web-connections.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- `/settings/connections?mock=1` at 1280 and 390 px:
  - "Add key" is in the header;
  - each key is one row with a dot, the name, the muted line and ⋮;
  - the ⋮ menu has Test key, Replace key and Delete;
  - no status words.
- Test, Replace and Delete work as before.
- Every file stays under 400 lines.

---

## Report (written by the worker when done)

### What I did
- `SettingsShell.tsx`: `subtitle` is now optional (the `<p>` is only rendered when it is present) and an optional `action?: ReactNode` renders at the right end of the title row (`ml-auto shrink-0`). Every existing caller keeps working (it still passes `subtitle`).
- Moved the row out of the route into `apps/web/src/components/connections/ConnectionRow.tsx` with its helpers `hostOf` and `testOutcome`. Moved `ReplaceKeyForm` into `apps/web/src/components/connections/ReplaceKeyForm.tsx` with its `KeyMissing`/`FormError` types. The small `shownFailure`/`messageOf` helpers are re-declared locally in each file, matching the per-file duplication the settings/panel code already uses (`packEditorModel.ts`, `groupPanelOps.ts`, several routes).
- `ConnectionsPage.tsx` (`105` lines): `SettingsShell` with title "Connections", no subtitle, and as `action` a primary `Button` with a lucide `Plus` and "Add key" that opens `AddKeyDialog`. The empty state is now "No keys yet" with the action "Add key". The list is one `<ul>` card (`overflow-hidden rounded-xl border border-border bg-surface`) with no heading and no button of its own.
- `ConnectionRow` (one `<li>`, `flex items-center gap-3 py-3 pr-2.5 pl-4`):
  - 8 px round dot with `role="img"`: `bg-online` / `aria-label="Working"` when `status === 'active'` and the last test in the page did not fail; `bg-danger` / `aria-label="Not working"` otherwise.
  - the name `providerLabel(provider)` at `text-[14px] font-semibold`;
  - one muted line (`text-[13px] text-muted-foreground`) joining with " · ": the red reason (`text-danger`) when not working (the failed test's message, or "Key revoked" when the status is not active), then the label, then the host for a custom base URL, then the short `Intl.DateTimeFormat` date — no "Added" word;
  - no status badge at all (the `{connection.status}` word is gone);
  - a ⋮ `IconButton` (lucide `MoreVertical`, `aria-label="<Provider> key actions"`) that opens a `Menu` (`align="end"`) with Test key (`Zap`), Replace key (`KeyRound`) and Delete (`Trash2`, `destructive`);
  - rows are divided by `border-b border-divider` with `last:border-b-0` on the last row.
- Menu behavior: Test key runs the test; a pass shows the toast "Key works" (shown from inside the action's `Effect.tap`, the `PackMenu` pattern) and leaves the dot green, a fail puts its reason on the muted line and makes the dot red. Replace key opens `ReplaceKeyForm` under the row; saving shows the toast "Key replaced", closes the form and resets the test action so a failed test is forgotten. Delete keeps the existing two-step confirm, now with "Delete" (destructive) and "Cancel"; the failure text is unchanged. The three separate icon buttons are gone.

### Checks run
- `pnpm install` (repo root): done, `Done in 12.2s` (one pre-existing peer warning in `apps/mobile`, unrelated).
- `pnpm gate` (repo root), first run: **FAIL** on `format` (Prettier flagged `ConnectionRow.tsx` and `ConnectionsPage.tsx`). Fixed with `pnpm exec prettier --write` on the four allowed files only.
- `pnpm gate` (repo root), second run: **GATE PASS** (exit 0). Summary lines:
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.8s)
  PASS  lint  (1.1s)
  PASS  typecheck  (4.9s)
  PASS  effect  (0.8s)
  SKIP tests @zilar/web (no nearby test files)
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: the task says "Tests: None" and the gate found no nearby web test files (no test references `ConnectionsPage`, `SettingsShell`, `ConnectionRow` or `ReplaceKeyForm`).

### Notes for the lead
- **Scope lines in the gate:** the gate prints 4 files "outside the Allowed files": `docs/design/mockups/connections/{Main,Phone,PhoneSheet}.dc.html` and `README.md`. These are the boards **you committed on this branch** ("T-1503: approved Connections boards") and the spec says not to edit them; every file I changed is inside the task's Allowed files. The gate does not treat them as a failure (it still printed `GATE PASS`), but the scope list is not empty, so I am flagging it rather than hiding it.
- Line counts of the touched source files: `SettingsShell.tsx` 59, `ConnectionsPage.tsx` 105, `ConnectionRow.tsx` 207, `ReplaceKeyForm.tsx` 90 — all well under 400.
- I did not edit the boards, the `AddKeyDialog`, the server or the mobile app (per "Not in scope").
- Small deviation for review: the card also carries `overflow-hidden` (the kit `card.tsx` idiom) so the rounded corners clip cleanly; the spec listed only `rounded-xl border border-border bg-surface`.
- The dot, the toast and the "forget a failed test on replace" behavior are all UI-only state in the page, as the spec expects (no server change).

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean (0 findings) for head `544726e27`.
- **Headless check (mock, dark):**
  - at 1280 and 390 px, "Add key" is in the header with no subtitle;
  - there is one card of three rows, each with a green dot, the name, the muted line (the label, the host for the custom key, the date) and ⋮;
  - the ⋮ menu reads Test key, Replace key and Delete (red);
  - Test key shows the "Key works" toast;
  - no horizontal scroll, 0 page errors.
- **The `overflow-hidden` deviation is fine:** the menu renders in a portal and is not clipped.
- **Sizes:** `ConnectionsPage.tsx` went from 349 to 105 lines; the row file is 207.

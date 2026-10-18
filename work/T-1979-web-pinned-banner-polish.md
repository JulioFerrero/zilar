---
id: T-1979
title: "Web pinned bar: one focus ring, only on keyboard focus (wells use :has(:focus-visible), not :focus-within); 'Message not found' becomes a calm inline note with an Unpin key for people who can pin"
status: merged
milestone: M5
branch: task/T-1979-web-pinned-banner-polish
model: deepseek/deepseek-flash
effort: default
estimate: 25 min
---

# T-1979: Web pinned bar polish

## Spec (written by Claude, do not edit)

### Why
Julio reported this on 2026-10-18, with a screenshot of his DM. After he clicked the pinned message, he saw two problems:
- **Rings.** Two thick rings appeared: one around the whole bar and one around the text. His words: "its horrible this click borders".
- **Not found.** A red "Message not found" line appeared under the bar, and the pin stayed. He asked "why still show the pinned message if its not found?"

Why the matching itself fails is T-1980. This task fixes how both cases look and what the user can do.

### Facts (read by the lead on 2026-10-18)
- **The bar.** `apps/web/src/components/PinnedBanner.tsx` (160 lines):
  - the bar is `<div className="well-surface ... rounded-[12px] px-3 py-2">` (`:91`);
  - the text is a `<button>` with `focus-visible:ring-2 focus-visible:ring-accent/40` (`:93-97`);
  - a failed jump shows `<p role="alert" className="... text-[12px] text-danger">Message not found</p>` (`:133-140`).
- **The style rule.** `apps/web/src/index.css:249-261`, the `@utility well-surface`, has `&:focus-within { outline: 2px solid var(--muted-foreground); outline-offset: 2px; }`. `:focus-within` also matches mouse focus on a button inside the well, so a click draws the outer ring. Plain inputs (search, composer) still match `:focus-visible` on a mouse click, so they keep their ring under `:has(:focus-visible)`.
- **Unpin.** The pins panel gets the "may unpin" flag from `useChatSelector((s) => s.canPin(chatId))` (`apps/web/src/components/PinsPanel.tsx:43`). The store action is `unpinMessage(chatId, pinId)` (`apps/web/src/store/effects/chatActions.ts:161`).

### Steps
1. **One ring, keyboard only.**
   - In `index.css`, change the `well-surface` rule from `&:focus-within` to `&:has(:focus-visible)`, keeping the same outline.
   - In `PinnedBanner.tsx`, remove the button's own `focus-visible:ring-*` classes, so keyboard focus shows exactly one ring (the well's).
   - A mouse click on the pinned text shows no ring.
2. **A calm not-found state** (`PinnedBanner.tsx:133-140`). Replace the red alert line with a muted 12 px line under the bar: "Can't find this message here. It may have been deleted." Keep `role="status"`.
   - When `canPin(chatId)` is true, put a small ghost `Button` "Unpin" on the right of that line. It calls `unpinMessage(chatId, current.id)`; when it succeeds, the line and the pin go away.
   - Moving to another pin (`cycle`) still clears the line, as it does today.
3. **Change nothing else.** No tests (UI). Every file stays at or under 400 lines.

### Allowed files
- `apps/web/src/components/PinnedBanner.tsx`
- `apps/web/src/index.css`
- `work/T-1979-web-pinned-banner-polish.md`

### Checks
```bash
pnpm gate
```

### Acceptance
The lead checks these in the web mock with Playwright:
- **Mouse click.** Clicking the pinned text in a mock chat with a pin draws no ring.
- **Keyboard.** Tabbing to the pinned text draws one ring.
- **Composer and search.** Both still show their ring when focused.
- **Not found.** A pin whose message can't be found shows the muted line, with Unpin for a manager.
- **The gate passes.**

---

## Report (written by the worker when done)

### What I did

- **One ring, keyboard only.** In `apps/web/src/index.css` the `well-surface` utility now uses `&:has(:focus-visible)` instead of `&:focus-within`, with the same outline. In `PinnedBanner.tsx` the pinned-text button no longer carries `focus-visible:ring-2 focus-visible:ring-accent/40`; it keeps `focus-visible:outline-none` so keyboard focus shows only the well's outline, and a mouse click shows no ring.
- **Calm not-found state.** The red `role="alert"` "Message not found" line is now a muted 12 px `role="status"` line: "Can't find this message here. It may have been deleted." When `canPin(chatId)` is true a ghost `Unpin` button sits on the right; it calls `unpinMessage(chatId, current.id)` through `useAction`/`fromApi` (disabled while the call runs), and on success it resets the jump state so the line disappears with the pin. Cycling to another pin still clears the line as before.
- Removed the now-unused `cn` import. No other files touched; both source files stay well under 400 lines.

### Checks run

- `pnpm gate` from the repo root (re-run after the Report was filled in; a further run after these Report edits passed with the same summary):
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (2.3s)
  PASS  format  (0.6s)
  PASS  lint  (0.7s)
  PASS  typecheck  (0.9s)
  PASS  effect  (0.4s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files run: this is UI-only and the gate reports no nearby tests for `@zilar/web`. I did not run the browser/Playwright acceptance checks; those are the lead's.

### Round (fix round, 2026-10-18)

- **Findings fixed:** PREREVIEW finding 1 (must-fix) — `well-surface` only matched `:has(:focus-visible)`, so elements carrying the utility directly (`text-input.tsx`, `search-field.tsx`, `select.tsx`, `combobox.tsx`, `switch.tsx`) never showed the ring. `apps/web/src/index.css:257` now matches both `&:focus-visible` (self) and `&:has(:focus-visible)` (descendant), with the same outline. The banner path is unchanged: the well still gets one ring from `:has`, and the click path still draws none.
- **Tests added:** none. This is UI/CSS, the spec says "No tests (UI)", and test files are outside the Allowed files. I verified the nested selector compiles with the installed `tailwindcss` 4.3.3 compiler (generated `.well-surface:focus-visible, .well-surface:has(:focus-visible)`).
- **Gate:** `pnpm gate` from the repo root ended with `GATE PASS` (install, format, lint, typecheck, effect PASS; `SKIP tests @zilar/web (no nearby test files)`; scope/size/migration/images ok).
- No disagreements with the finding.

### Notes for the lead

- Files changed: `apps/web/src/components/PinnedBanner.tsx`, `apps/web/src/index.css`, `work/T-1979-web-pinned-banner-polish.md`.
- Acceptance points to verify in the mock: mouse click on pinned text draws no ring; Tab draws exactly one ring; composer and search keep their ring; a pin that can't be found shows the muted line, with `Unpin` for managers.
- Unpin failure is not surfaced by this new button itself; as with other unpin paths, the store puts the pin back and its error appears in the banner's existing pins-error line with `Dismiss`.
- `role="status"` is used as the spec asked; the line is no longer announced as an alert.

## Review (written by Claude)

Approved. Checked with Playwright in the web mock (Ana DM, pinned "Deal"):
- **Mouse click** on the pinned text: the well has no outline, and the button has no ring or shadow.
- **Keyboard (Tab):** the well shows one solid 2px outline, and the button draws nothing of its own.
- **Composer click:** its well keeps its outline, as before.
- **Not-found line and Unpin:** not reached in the mock. They were read in the diff and the pre-review.
  - The line is muted, with `role="status"`.
  - Unpin shows only when `canPin(chatId)` is true, and the line clears only after the unpin succeeds.
  - The lead checks them live on Julio's card pin after the deploy.

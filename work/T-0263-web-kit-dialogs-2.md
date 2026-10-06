---
id: T-0263
title: "Web kit migration 3: TelegramImportDialog, NewAiDialog and NewGroupDialog render through the kit Dialog"
status: merged
milestone: M5
branch: task/T-0263-web-kit-dialogs-2
model: auto
effort: low
depends_on: [T-0258]
estimate: 0.3 day
---

# T-0263: three more dialogs on the kit Dialog

## Spec (written by Claude, do not edit)

### Why
This is audit step 6, batch 2. T-0258 moved four dialogs onto the kit `Dialog` (`apps/web/src/components/ui/dialog.tsx`). The kit has Escape handling (only the topmost dialog closes), a focus trap, focus return, `initialFocusRef`, a backdrop click to close, `size: 'sm' | 'md'` and an `actions` footer.

### Verified facts (do not re-derive)
- `apps/web/src/components/TelegramImportDialog.tsx` (332 lines): its own Escape at line 72 and `role="dialog"` at line 121. Per its doc comment (lines 16-17), it does not close on Escape or the backdrop while busy. Test: `apps/web/src/components/TelegramImportDialog.test.tsx`.
- `apps/web/src/components/ais/NewAiDialog.tsx` (351 lines): Escape at line 78, `role="dialog"` at line 169. Test: `apps/web/src/components/ais/NewAiDialog.test.tsx`.
- `apps/web/src/components/NewGroupDialog.tsx` (377 lines): Escape at line 39, `role="dialog"` at line 139. Test: `apps/web/src/components/NewGroupDialog.test.tsx`.

### What to build
1. Each of the three renders through the kit `Dialog`. Delete its own Escape handler, backdrop and panel markup, and keep every text, step, button and behaviour.
2. "Not while busy": pass an `onClose` that does nothing while busy, or add an optional kit prop `dismissable?: boolean` (default true) that blocks Escape and the backdrop. Add a kit test and a fixture case if you add the prop.
3. If a dialog needs to be wider than `max-w-md`, add `size: 'lg'` (`max-w-lg`) to the kit with a fixture case; do not hard-code widths in the callers.
4. Existing tests keep passing, changed only where they relied on the old markup. Each of the three has a test that Escape closes it (and, for Telegram import, one where Escape does not close it while busy).

### Read first
`AGENTS.md`, `apps/web/src/components/ui/dialog.tsx`, the three dialog files and their tests, and `work/T-0258-web-kit-dialogs-1.md` (Report) for how batch 1 was done.

### Allowed files
`apps/web/src/components/ui/dialog.tsx`, `apps/web/src/components/ui/dialog.fixture.tsx`, `apps/web/src/components/ui/kit.test.tsx`, `apps/web/src/components/TelegramImportDialog.tsx`, `apps/web/src/components/TelegramImportDialog.test.tsx`, `apps/web/src/components/ais/NewAiDialog.tsx`, `apps/web/src/components/ais/NewAiDialog.test.tsx`, `apps/web/src/components/NewGroupDialog.tsx`, `apps/web/src/components/NewGroupDialog.test.tsx`, `work/T-0263-web-kit-dialogs-2.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit TelegramImportDialog NewAiDialog NewGroupDialog fixtures
pnpm gate
```

### Acceptance
- None of the three files contains `role="dialog"` or its own Escape handler. Behaviour and texts are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

### Out of scope
The remaining dialog files (`NewTopicDialog`, `FolderEditorDialog`, `AvatarUploader`, `GroupHandleRoute`, `NewChatButton`, `StickerPanel`, `ExplorePage`) and the side panels.

---

## Report (written by the worker when done)

### What I did

Moved `TelegramImportDialog`, `NewAiDialog` and `NewGroupDialog` onto the kit `Dialog`. Each now renders through it; their own Escape handlers, backdrops and panel markup are gone. Every text, step and button is kept.

- `TelegramImportDialog`: one `<Dialog open onClose title ariaLabel size="sm" dismissable={!busy} initialFocusRef={inputRef} actions>` per state (unavailable / token-invalid / done / form). The old panel-header ✕ is now the first item of the body, right-aligned next to the first paragraph, and stays disabled while busy. `dismissable={!busy}` blocks Escape and the backdrop while busy; `initialFocusRef` keeps focus on the pack input on open, like the old focus effect. The 501 and token-invalid states are unchanged.
- `NewAiDialog`: `<Dialog open onClose title="New AI" size="sm" actions={Cancel + Create}>` with the old scroll body as children. The `listConnections` effect stays; the Name input keeps `autoFocus`.
- `NewGroupDialog`: `<Dialog open onClose title={step heading} ariaLabel={dialogLabel} size="sm" actions={Cancel/Next or Back/Create}>`. The step heading is the title; the old `aria-label` (`New group` / `New channel`) is preserved via `ariaLabel`.

### Kit `Dialog` changes (Allowed files)

- Added optional `dismissable?: boolean` (default `true`). When `false`, Escape and a backdrop click do not close. Kit test `stays open on Escape and a backdrop click when not dismissable` + fixture case `NotDismissable`.
- Added optional `ariaLabel?: string`, used as the accessible name when it must differ from the visible title. Kit test `uses ariaLabel as the accessible name when it differs from the title` + fixture case `AccessibleName`.
- `ariaLabel` was needed (not just nice-to-have): `NewChatButton.test.tsx` (outside Allowed files) asserts `getByRole('dialog', { name: 'New group' })`, while the visible step heading is `Add members` / `Group name`. The same applies to Telegram's non-form states, whose old `aria-label`s differ from their headings. Without `ariaLabel` the title would silently rename those dialogs.
- No `size: 'lg'` added: all three old panels were `max-w-sm`, so `size="sm"` matches; none needed `max-w-md`.

### Tests

- `TelegramImportDialog.test.tsx`: the overlay test now checks the backdrop on the `role="dialog"` element's parent (the kit puts the role on the panel), and I added `closes on Escape` and `does not close on Escape or the backdrop while importing`.
- `NewGroupDialog.test.tsx`: added `closes on Escape` (it also checks the preserved accessible name `New group`).
- `NewAiDialog.test.tsx`: already had `closes on Escape`; unchanged.
- `kit.test.tsx` + `dialog.fixture.tsx`: tests and fixture cases for the two new props.

### Files changed

`apps/web/src/components/ui/dialog.tsx`, `apps/web/src/components/ui/dialog.fixture.tsx`, `apps/web/src/components/ui/kit.test.tsx`, `apps/web/src/components/TelegramImportDialog.tsx`, `apps/web/src/components/TelegramImportDialog.test.tsx`, `apps/web/src/components/ais/NewAiDialog.tsx`, `apps/web/src/components/NewGroupDialog.tsx`, `apps/web/src/components/NewGroupDialog.test.tsx`, `work/T-0263-web-kit-dialogs-2.md`.

### Commands and real results

- `pnpm install`: exit 0. It added two peer-dependency lines (`bufferutil`, `utf-8-validate`) to `pnpm-lock.yaml`; I restored the lockfile with `git checkout -- pnpm-lock.yaml` so it is untouched in the commit.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit TelegramImportDialog NewAiDialog NewGroupDialog fixtures`: 5 files passed, 119 tests passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot NewChatButton Channels StickersPage AisPage ConfirmDialog InviteDialog AddContactDialog AddMachineDialog` (callers and the other kit-Dialog users): 8 files passed, 52 tests passed.
- `pnpm gate` (repo root):
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (18.1s)
  PASS  lint  (1.0s)
  PASS  typecheck  (10.6s)
  PASS  tests @zilar/web  (26.9s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Acceptance

- None of the three files contains `role="dialog"` or its own Escape handler (grep; only two comments mention Escape). Confirmed.
- Behaviour and texts unchanged, except the layout notes below.
- `pnpm gate` is green and lists no file outside the Allowed files; `pnpm-lock.yaml` is not modified.

### Deviations / open questions

- I added two kit props (`dismissable`, `ariaLabel`) instead of only the one suggested for "not while busy". `dismissable` is the spec's proposed option; `ariaLabel` was required to keep the out-of-scope `NewChatButton.test.tsx` green (see above). Both have kit tests and fixture cases.
- The old panel-level max heights (`NewAiDialog` `max-h-[85vh]`, `NewGroupDialog` `max-h-[80vh]`) are gone because the kit panel owns its sizing; the body `overflow-y-auto` wrappers remain but no longer have a bounded height. On a long contact list or tall "More options" body the panel can grow past the viewport and its footer can scroll out of reach. I left it because the spec says to delete the panel markup and the kit has no height prop. Open question: should the kit gain a max-height/scrollable-body prop (later batch), or is the unconstrained kit panel intended?

### Lead fix round

- Fixed the height regression flagged in pre-review. `apps/web/src/components/ui/dialog.tsx` now gives the panel `flex max-h-[85vh] flex-col`; the title and description carry `shrink-0`, the children sit in a `min-h-0 flex-1 overflow-y-auto` wrapper, and the actions footer is `shrink-0`. So a short body stays compact, and a tall one scrolls with the title and footer in view.
- Dropped the now-redundant inner `overflow-y-auto` wrappers in `NewAiDialog` (line 188) and `NewGroupDialog` (line 178); Telegram had none. AddContactDialog/AddMachineDialog never had one.
- Added kit test `caps the panel height and scrolls the body between fixed title and actions` (`kit.test.tsx`) and fixture case `LongBody` (40 rows) in `dialog.fixture.tsx`.
- Commands: `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit TelegramImportDialog NewAiDialog NewGroupDialog ConfirmDialog AddContactDialog InviteDialog AddMachineDialog fixtures` → 9 files, 132 tests passed. `pnpm gate` → `GATE PASS` (install frozen, format, lint, typecheck, tests @zilar/web all PASS; scope clean).

## Review (written by Claude)

**Verdict:** Approved after one lead fix round.
- The first packet's nit was a real regression: the dialogs had lost their max height. The kit `Dialog` now caps at 85vh, with a fixed title, a scrolling body and a fixed footer (`b58df909`).
- `dismissable={!busy}` keeps Telegram import open while it is busy.
- I checked New group in mock mode in the browser.

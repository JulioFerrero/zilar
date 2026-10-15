---
id: T-1431
title: "Web dialog kit for the approved design: Dialog with header close key, footer and form submit; DialogStepper; light-key choice control; searchable Combobox; well Select; keys at radius 10"
status: merged
milestone: M5
branch: task/T-1431-web-dialog-kit
model: auto
effort: default
depends_on: []
estimate: 0.8 day
---

# T-1431: Web dialog kit

## Spec (written by Claude, do not edit)

### Why
Julio approved the New AI design on 2026-10-15 ("10/10"). Canvas: https://claude.ai/artifact/WMbGfFmbgAHeuEKKHvBg2k. Open it and copy its exact values: the boards are plain HTML with inline styles.

The New AI flow (a later task) and every other dialog are built from these parts. The design is D24 only (`docs/design/ui-style.md`, `docs/design/mockups/Main.dc.html`). The lead's design brief is the background. Its relevant rules are restated below.

### Facts (the lead read them on main)
- **`apps/web/src/components/ui/dialog.tsx` (96 lines, Base UI Dialog):**
  - the backdrop is `bg-black/40` (`:62`);
  - the popup is `rounded-2xl border border-border bg-panel p-5 shadow-xl`, `max-w-sm/md/lg` (`:66-69`);
  - the title is 18/600 (`:73-75`);
  - the description is optional (`:76-80`);
  - the body is a scroll div (`:81`);
  - `actions` render in `mt-5 flex justify-end gap-2` (`:82-84`);
  - there is no close control and no `<form>`.
- **`apps/web/src/components/ui/button.tsx:9`:** `rounded-lg`, `font-medium`. Variants are at `:12-22` (`default` = `key-primary`); sizes at `:24-31` (`lg` = h-9).
- **`apps/web/src/components/ui/select.tsx`:** Base UI Select. `TRIGGER` (`:30-31`) is a flat `border-input bg-background` box; `PANEL` (`:33-34`).
- **`apps/web/src/components/ui/segmented-control.tsx` (98 lines):** `mode` is `tabs | radio` (`:16`, `:58`). The track is `well-surface rounded-[10px] p-[3px]` (`:64`) and the active segment is `segment-raised` (`:87`).
- **`apps/web/src/components/ui/text-input.tsx:53-54`:** `FIELD_INPUT` is `well-surface ... rounded-lg`.
- **`apps/web/src/index.css` utilities:** `key-primary` (`:186`), `key-icon` (`:221`), `well-surface` (`:249`), `segment-raised` (`:274`).
- **`apps/web/src/components/ui/icon-button.tsx`** exists (39 lines).
- **`@base-ui/react` 1.8.0** ships `combobox` (`apps/web/node_modules/@base-ui/react/combobox`), unused so far.

### What to build (D24 only; values from the canvas)
1. **`Dialog`** (`ui/dialog.tsx`, plus a new `ui/dialog-parts.tsx` if it passes 150 lines). Keep the old `actions` prop working.
   - **Close:** a header close key (`key-icon`, 32 px, radius 10, lucide `X` 16, `aria-label="Close"`, never focused first).
   - **Header:** `stepper` and `description` slots.
   - **Footer:** a `footer` slot with a 1px `border-border` hairline, `px-5 py-3.5`, and keys aligned right.
   - **Errors:** an `error` line (13 px, `text-danger`, `role="alert"`) above the footer.
   - **Form:** `onSubmit` wraps body and footer in `<form noValidate>` (Enter submits).
   - **Busy:** `busy` turns off Esc, backdrop and the X.
   - **Backdrop:** `bg-black/60`.
   - **Shadow:** the popup shadow becomes `0 24px 60px rgba(0,0,0,.8)`.
   - **Narrow screens:** below 640 px the popup docks to the bottom: full width, top corners 16 only.
   - **Focus:** first focus goes to the element with `data-autofocus`.
2. **`DialogStepper`** (new `ui/dialog-stepper.tsx`): props `steps: {label: string; value?: string}[]` and `current: number`, plus `onStep?(i)`.
   - The track is the segmented well (28 px segments, radius 7, 13/500).
   - The current step uses `segment-raised`.
   - A done step shows lucide `Check` 12 plus its `value` (for example "DeepSeek"), in `text-muted-foreground`, and is a button that calls `onStep(i)`.
   - Later steps are `text-subtle-foreground`.
   - `aria-label="Step 2 of 4: Key"`.
3. **Choice control:** `SegmentedControl` gains `tone?: 'tab' | 'choice'`.
   - With `choice`, the selected option uses the light key: the `key-primary` recipe at segment size, with dark text. Add a `segment-choice` utility next to `segment-raised` if needed.
   - Options take an optional `icon` (16 px, same stroke).
   - The row is icon + label inline, 34 px high, `13px/1` weight 500, the same weight when selected.
4. **`Combobox`** (new `ui/combobox.tsx`, Base UI Combobox):
   - The trigger is a well field (`well-surface`, radius 10, h-10, chevron 16 muted).
   - The popup is the menu surface (`#111111` = `bg-surface`, 1px `border-border-strong`, radius 12, padding 6, max height 320, scrolls).
   - A search well sits at the top (`placeholder` prop).
   - Rows are 34 px with radius 8; the selected row is `bg-surface-raised` plus `Check` 16.
   - Each item can carry a trailing `dot?: 'online'` (8 px `--online` green).
   - An optional pinned `footerItem` (icon `Plus`) sits after a 1px divider.
   - Typing filters by label. Arrow keys and Enter work. It handles 250 items smoothly.
5. **Well Select and fields:** `select.tsx` `TRIGGER` uses the well look (`well-surface`, radius 10, h-10), and its popup uses the menu surface. `FIELD_INPUT` becomes radius 10.
6. **Keys:** `button.tsx` base becomes `rounded-[10px]`, and the `default` variant gets `font-semibold`.
7. **Cosmos fixtures:** update or add `ui/dialog.fixture.tsx`, `ui/segmented-control.fixture.tsx` and `ui/combobox.fixture.tsx`, showing a 4-step dialog that matches the canvas board "2 · Key".

### Tests
None (UI).

### Allowed files
- `apps/web/src/components/ui/dialog.tsx`, `apps/web/src/components/ui/dialog-parts.tsx`, `apps/web/src/components/ui/dialog-stepper.tsx`
- `apps/web/src/components/ui/segmented-control.tsx`, `apps/web/src/components/ui/combobox.tsx`, `apps/web/src/components/ui/select.tsx`, `apps/web/src/components/ui/text-input.tsx`, `apps/web/src/components/ui/button.tsx`, `apps/web/src/index.css`
- `apps/web/src/components/ui/dialog.fixture.tsx`, `apps/web/src/components/ui/segmented-control.fixture.tsx`, `apps/web/src/components/ui/combobox.fixture.tsx`
- `work/T-1431-web-dialog-kit.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- Existing dialogs still open and close.
- `?mock=1` shows no layout breaks.
- Every file stays at 400 lines or fewer.

The lead checks the fixtures and two existing dialogs headless at 1280 and 390 px.

---

## Report (written by the worker when done)

**Status:** review. All spec work is done; `pnpm gate` ends with `GATE PASS`.

### What I did
Read the approved boards from `main` with `git show` (`docs/design/mockups/new-ai/README.md`,
`Main.dc.html`, `Key.dc.html`, `Model.dc.html`, `Limits.dc.html`) and copied their inline values.
The private canvas was not fetched.

- **`dialog.tsx` + new `dialog-parts.tsx`**: header close key (`key-icon`, 32 px, radius 10,
  lucide `X` 16, `aria-label="Close"`), `stepper`/`description` header slots, `footer` slot
  (hairline `border-border`, `px-5 py-3.5`, keys right), `error` line (13 px `text-danger`,
  `role="alert"`), `onSubmit` wraps the body + footer in `<form noValidate>`, `busy` disables
  Esc/backdrop/X, backdrop `bg-black/60`, popup shadow `0 24px 60px rgba(0,0,0,.8)`, narrow
  docking via `max-sm:items-end max-sm:p-0` + `max-sm:rounded-b-none max-sm:max-w-none`, and
  first focus goes to `[data-autofocus]` (falling back to the popup, so the close key is never
  focused first). `actions`, `initialFocusRef`, `dismissable`, `forceRenderBackdrop` and
  `ariaLabel` still work. `dialog.tsx` is 140 lines, so the parts file was optional but keeps it small.
- **New `dialog-stepper.tsx`**: segmented well (28 px segments, radius 7, 13/500); current step is
  `segment-raised`; done steps show lucide `Check` 12 + `value` in `text-muted-foreground` and are
  buttons calling `onStep(i)`; later steps are `text-subtle-foreground`; `aria-label="Step 2 of 4: Key"`.
- **`segmented-control.tsx`**: added `tone: 'tab' | 'choice'` and an optional `icon` per option.
  `choice` rows are 34 px, `13px/1` weight 500, and the selected option uses `segment-choice`
  (the light key at segment size, dark text).
- **New `combobox.tsx`** (Base UI `Combobox`, input-inside-popup pattern): well trigger
  (`well-surface`, radius 10, h-10, chevron 16 muted), menu-surface popup (`bg-surface`,
  `border-border-strong`, radius 12, padding 6, max height 320, scrolling list), search well on
  top (`placeholder` prop), 34 px radius-8 rows with `data-[selected]:bg-surface-raised` + `Check`,
  trailing `dot: 'online'` (8 px `--online`), and a pinned `footerItem` after a 1 px divider.
  Filtering/keyboard come from Base UI (`createItems` with `getValue`/`getLabel`).
- **`select.tsx`**: `TRIGGER` now the well field (radius 10, h-10) and `PANEL` the menu surface.
- **`text-input.tsx`**: `FIELD_INPUT` radius 10.
- **`button.tsx`**: base radius `rounded-[10px]`, `default` variant gets `font-semibold`.
- **`index.css`**: added the `segment-choice` utility next to `segment-raised`.
- **Fixtures**: `dialog.fixture.tsx` gains a `NewAiKeyStep` (the "2 · Key" board: 4-step bar, key
  well with lock/eye/green dot, Back + Continue); `segmented-control.fixture.tsx` gains a `Choice`
  example with icons; new `combobox.fixture.tsx` (providers with a dot + pinned
  "OpenAI-compatible", plus a 250-item list).

### Files changed (all inside Allowed files)
`dialog.tsx`, `dialog-parts.tsx` (new), `dialog-stepper.tsx` (new), `segmented-control.tsx`,
`combobox.tsx` (new), `select.tsx`, `text-input.tsx`, `button.tsx`, `index.css`,
`dialog.fixture.tsx`, `segmented-control.fixture.tsx`, `combobox.fixture.tsx` (new),
`work/T-1431-web-dialog-kit.md`.

### Commands and results
- `pnpm install`: ok (peer warning `@types/react` in `apps/mobile`, pre-existing).
- `prettier --write` on `combobox.tsx` once (format check flagged it). No format/lint/typecheck run
  one by one beyond that. No package had nearby test files, so I ran no unit tests.
- `pnpm gate` (final):
  ```
  gate: 13 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.1s)
  PASS  lint  (1.0s)
  PASS  typecheck  (2.5s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  (An earlier run failed on `format` then `typecheck`; both were fixed before this run.)

### Deviations / notes
- `Combobox.Value` has no `className`, so the trigger label is truncated by a wrapping `<span>`.
- The spec asks for the old `dialog.tsx` only if it stays ≤ 150 lines; it is 140, so
  `dialog-parts.tsx` was added only to keep the shell small (it is in the Allowed files).
- Focus behavior changes by design: dialogs without a `[data-autofocus]` element now focus the
  popup instead of the first tabbable child, so the new header close key is not focused first.
  Existing dialogs that need an initial input focus should mark it `data-autofocus` (they open and
  close unchanged; I did not touch their files).
- I did not run the browser/headless smoke (`?mock=1`, 1280/390 px); that is the lead's check.
  The narrow-screen docking uses Tailwind's `max-sm` (640 px).

### Open questions
None.

### Round (fix round, T-1431)
- **Finding 1 (should-fix) — fixed:** `combobox.tsx` now controls the popup with internal
  `open` state (`open`/`onOpenChange` on `BaseCombobox.Root`) and closes it in the pinned
  footer item's `onClick` after `footerItem.onSelect()`, so the New AI flow's
  "OpenAI-compatible" action no longer leaves the menu mounted over the next step.
- **Findings 2–5 (nits) — left as they are.** None sits on a line this round changes, so per
  the fix-round brief they were not touched.
- **Tests:** none added. The task spec says "Tests: None (UI)" and AGENTS.md says UI code gets
  no tests; the changed `combobox.tsx` is presentational, and a new test file would fall outside
  the task's Allowed files. The finding names no test.
- **`pnpm gate` (final):**
  ```
  gate: 13 changed file(s) against main
  PASS  install (frozen)  (4.8s)
  PASS  format  (1.1s)
  PASS  lint  (1.1s)
  PASS  typecheck  (4.7s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN after 1 auto round, nit 2.
- The lead rendered the Cosmos fixtures headless (Playwright, dark) at 1280 and 390 px:
  - the dialog has one close key and a hairline footer, and docks to the bottom at 390;
  - the combobox filters ("deep" → DeepSeek, with a check) and keeps OpenAI-compatible pinned under a hairline.
- The fixture's footer still shows Cancel plus Save. The approved standard is the close key plus one primary (Back in wizards), so the migration specs (E1-E3, web New AI) ask for no Cancel key.

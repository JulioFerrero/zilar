---
id: T-2224
title: "Web kit on Base UI: Switch, Checkbox, Toast and SegmentedControl wrap Base UI parts instead of hand-made ARIA; same props, so no caller changes"
status: merged
milestone: M5
branch: task/T-2224-web-kit-base-ui
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2224: Web kit on Base UI

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-19: "Base UI for the web kit". Web primitives use Base UI (`@base-ui/react` 1.8.0, already installed). The four parts below hand-roll their ARIA, keyboard handling and live region. Base UI ships them with tested accessibility.

### Facts (read by the lead on 2026-10-19)
1. **`Switch`** (`apps/web/src/components/ui/switch.tsx`, 50 lines): a hand-made `role="switch"` button with `aria-checked`; 2 importers.
2. **`Checkbox`** (`apps/web/src/components/ui/checkbox.tsx`, 40 lines): a hand-made box with a lucide `Check`; 1 importer.
3. **`ToastProvider` / `useToast`** (`apps/web/src/components/ui/toast.tsx`, 64 lines): a hand-made `role="status"` live region; 5 importers, including `apps/web/src/main.tsx`.
4. **`SegmentedControl`** (`apps/web/src/components/ui/segmented-control.tsx`, 137 lines): a hand-made `tablist`/`radiogroup` with arrow-key roving focus (`mode: 'tabs' | 'radio'`, `tone: 'tab' | 'choice'`); 8 importers.
5. **Base UI 1.8.0** has `switch`, `checkbox`, `toast`, `toggle-group`, `tabs` and `radio-group` (`apps/web/node_modules/@base-ui/react/`). Read their types there before writing; never guess the API.
6. **Look and tokens:** each part's current classes are the D24 look (`docs/design/ui-style.md`). Keep every class, size and colour; only the element and its behaviour source change.

### Steps
1. **`Switch`** wraps Base UI `Switch.Root` and `Switch.Thumb`. Same props and same classes, applied through Base UI's `data-[checked]` state.
2. **`Checkbox`** wraps Base UI `Checkbox.Root` and `Checkbox.Indicator` (keep the lucide `Check`). Same props.
3. **`ToastProvider` / `useToast`** keep their exported API and use Base UI Toast (`Toast.Provider`, `Toast.Viewport`, `Toast.Root`, `Toast.Title`). The same position, look and timeout as today.
4. **`SegmentedControl`** keeps its props:
   - `mode: 'tabs'` uses Base UI `Tabs.Root` and `Tabs.List` with `Tabs.Tab`;
   - `mode: 'radio'` uses `RadioGroup` (or `ToggleGroup` if that fits better; say which in the Report);
   - the hand-written roving-focus helpers (`firstEnabled`, `lastEnabled` and the key handler) go.
5. **No caller changes.** If a caller must change, keep it to the import line and say why in the Report.
6. **Stop rule:** the four files together must shrink (net below 0 over `apps/web`). If they cannot, stop and say why in the Report.

### Allowed files
- `apps/web/src/components/ui/switch.tsx`
- `apps/web/src/components/ui/checkbox.tsx`
- `apps/web/src/components/ui/toast.tsx`
- `apps/web/src/components/ui/segmented-control.tsx`
- `work/T-2224-web-kit-base-ui.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes; no new tests (UI).
- Net below 0.
- The lead checks in web mock, comparing screenshots with main:
  - Settings › Notifications switches toggle and keep their look;
  - the Add key and New AI steppers and the Explore tabs switch with the mouse and the arrow keys;
  - "Key works" or another toast shows and fades;
  - the TopicAddDialog checkbox ticks.

---

## Report (written by the worker when done)

### What changed

- **`apps/web/src/components/ui/switch.tsx`** — wraps Base UI `Switch.Root` / `Switch.Thumb`. The root uses `nativeButton` + `render={<button type="button" />}` so the existing sibling `<label htmlFor>`/`id` pattern, disabled button semantics and classes stay intact. The checked look now comes from `data-[checked]` (`key-primary`, `border-0`, thumb `translate-x-5`).
- **`apps/web/src/components/ui/checkbox.tsx`** — wraps Base UI `Checkbox.Root` / `Checkbox.Indicator` and keeps the lucide `Check`. Same props; the visual classes moved onto the Base UI root and checked/disabled/focus states use `data-*`/`focus-visible` variants.
- **`apps/web/src/components/ui/toast.tsx`** — `ToastProvider` now wraps Base UI `Toast.Provider` (plus `Toast.Portal`, `Toast.Viewport`, `Toast.Root`, `Toast.Title`). `useToast(): (text: string) => void` is unchanged. A fixed toast id makes each call update the visible toast and restart the 2 s timer, as the old `setText` did; the viewport/root classes keep the same position and look.
- **`apps/web/src/components/ui/segmented-control.tsx`** — `mode="tabs"` uses `Tabs.Root` / `Tabs.List` / `Tabs.Tab` with `activateOnFocus` (arrow keys select and wrap as before); `mode="radio"` uses `RadioGroup` / `Radio.Root`. `firstEnabled`, `lastEnabled`, `enabledFrom`, the ref array and the key handler are gone. Same props, classes, sizes, `tone` variants and disabled handling.

No caller changed.

### Why `RadioGroup` (not `ToggleGroup`)

`mode="radio"` already rendered a `radiogroup` of `radio`s. Base UI `RadioGroup` gives exactly that role pair plus roving focus and disabled skipping. `ToggleGroup` would have switched the options to `aria-pressed` buttons, changing the semantics.

### Files changed

- `apps/web/src/components/ui/switch.tsx`
- `apps/web/src/components/ui/checkbox.tsx`
- `apps/web/src/components/ui/toast.tsx`
- `apps/web/src/components/ui/segmented-control.tsx`
- `work/T-2224-web-kit-base-ui.md`

### Commands and results

- `pnpm install` — done (14.8 s, 1155 packages).
- `pnpm gate` — **GATE PASS**, 5 changed files against `main`, every changed file inside the Allowed files. Summary lines:

```text
PASS  install (frozen)  (1.6s)
PASS  format  (1.4s)
PASS  lint  (1.2s)
PASS  typecheck  (4.9s)
PASS  effect  (1.4s)
SKIP build @zilar/server (no server, package or manifest change)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

No single-file tests were run: this is a UI-only change and no test files sit near it; the gate skipped web tests for the same reason.

### Stop rule (net below 0)

The four files went from 291 lines to 245 lines: **net −46**.

### Deviations and caveats

- Added `Toast.Portal` beyond the parts named in the spec, so toasts mount on `body` like Base UI's own example; position and look are unchanged.
- I did not run the web app or a browser, so I did not visually test the switches, steppers, Explore tabs, toast or TopicAddDialog checkbox. The lead's mock-mode pass still covers those.

### Round

- Fixed finding 1 (must-fix): `SegmentedControl` now carries both the `data-[checked]` selector used by `Radio.Root` and the `data-[active]` selector used by `Tabs.Tab`, for both tones. Radio callers with the default `tone="tab"` get `segment-raised` and foreground text again, and the symmetric `tone="choice"` + `mode="tabs"` case gets `segment-choice`.
- Tests: none added. This is a UI-only change, the finding named no test and `AGENTS.md` says UI code gets no tests.
- `pnpm gate`: **GATE PASS** (5 changed files against `main`, all inside the Allowed files; web tests SKIP, no nearby test files).


## Review (written by Claude)

Approved; clean after 1 auto round. The must-fix: radio mode lost the selected look, because Tabs set `data-active` and Radio sets `data-checked`. Now both selectors carry it. One nit: disabled items keep a hover class that the disabled colour overrides. Net −46.

**What changed:** Switch, Checkbox, Toast and SegmentedControl wrap Base UI 1.8.0 parts (Switch, Checkbox, Toast, Tabs and RadioGroup). The props are the same, so no caller changes. The hand-written roving focus is gone.

**Lead checks** (web mock, screenshots branch vs main, side by side):
- Notifications switch: toggles (true → false) and looks identical.
- Explore kind filter (radio): "Channels" selected looks identical.
- New group visibility (radio): "Public" selected looks identical.
- The "Key works" toast shows in the same place with the same look, and fades.

Base UI's viewport is a polite live region (`role="region"`, `aria-live="polite"`), so the toast is still announced.

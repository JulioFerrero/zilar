---
id: T-1921
title: "Web overlay motion (Julio picked it from the find-animation-opportunities sweep): kit dialogs fade+scale in (bottom-sheet slide on narrow screens), the side sheet slides from the right, menus/select/combobox scale from their trigger — Base UI starting/ending styles, transitions only, reduced motion = opacity only"
status: merged
milestone: M5
branch: task/T-1921-web-overlay-motion
model: auto
effort: default
depends_on: []
estimate: 35 min
---

# T-1921: Web dialogs, sheets and menus enter and leave with motion

## Spec (written by Claude, do not edit)

### Why
**Julio, 2026-10-17,** picked items 1–3 from the lead's `find-animation-opportunities` sweep (Emil Kowalski's skills). Every web overlay in the kit appears and vanishes instantly: the dialog, its backdrop, the side sheet, menus, select and combobox. Base UI already sets `data-starting-style` / `data-ending-style` on these parts, so CSS transitions are all it takes. Use **transitions, not keyframes**, so a quick open-close can reverse mid-way.

### Facts (read by the lead on 2026-10-17)
- **Tailwind v4:** `scale-*` and `translate-*` set the separate CSS `scale` and `translate` properties, not `transform`. A transition must list `scale` / `translate`, not only `transform`.
- **`apps/web/src/components/ui/dialog.tsx`** (140 lines):
  - `DialogPrimitive.Backdrop` `className="fixed inset-0 z-40 bg-black/60"` (`:104-107`);
  - `DialogPrimitive.Popup` with `cn('flex max-h-[85vh] w-full flex-col rounded-2xl … outline-none', 'max-sm:max-w-none max-sm:rounded-b-none', size…)` (`:109-119`);
  - on narrow screens the viewport puts it at the bottom (`max-sm:items-end`, `:108`), so it acts as a bottom sheet.
- **`apps/web/src/components/ui/sheet.tsx`** (62 lines): `DialogPrimitive.Backdrop className="fixed inset-0 z-40 bg-black/40"` (`:49`); the `Popup` is `"flex h-full w-full flex-col bg-surface shadow-xl outline-none sm:w-[380px]"` (`:51-55`), on the right (`justify-end`).
- **The popup classes:**
  - `menu.tsx:36-37` `PANEL`, used by `BaseMenu.Popup` (`:87`);
  - `select.tsx:33-34` `PANEL`, used by `BaseSelect.Popup` (`:96`);
  - `combobox.tsx:43-44` `POPUP`, used by `BaseCombobox.Popup` (`:113`).

  Base UI sets `--transform-origin` on these popups (toward the trigger).
- **Existing motion conventions:** `apps/web/src/index.css` has no easing tokens; components use Tailwind arbitrary values and `motion-reduce:` variants (`MessageBubble.tsx:195,298`).

### Steps
Use these exact curves:
- **out:** `cubic-bezier(0.23,1,0.32,1)`;
- **drawer:** `cubic-bezier(0.32,0.72,0,1)`.

1. **The dialog backdrop** (`dialog.tsx`) and **the sheet backdrop** (`sheet.tsx`), add:
   ```
   transition-opacity duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 data-[ending-style]:duration-150
   ```
2. **The dialog popup**, add one more `cn` part:
   ```
   transition-[opacity,scale,translate] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]
   data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.97]
   data-[ending-style]:opacity-0 data-[ending-style]:scale-[0.97] data-[ending-style]:duration-150
   max-sm:duration-300 max-sm:ease-[cubic-bezier(0.32,0.72,0,1)]
   max-sm:data-[starting-style]:scale-100 max-sm:data-[starting-style]:opacity-100 max-sm:data-[starting-style]:translate-y-full
   max-sm:data-[ending-style]:scale-100 max-sm:data-[ending-style]:opacity-100 max-sm:data-[ending-style]:translate-y-full max-sm:data-[ending-style]:duration-200
   motion-reduce:transition-opacity
   ```
   With reduced motion only opacity transitions; the transform values apply at once.
3. **The sheet popup** (`sheet.tsx`), add:
   ```
   transition-[translate] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]
   data-[starting-style]:translate-x-full data-[ending-style]:translate-x-full data-[ending-style]:duration-200
   motion-reduce:transition-opacity motion-reduce:data-[starting-style]:translate-x-0 motion-reduce:data-[ending-style]:translate-x-0
   motion-reduce:data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:opacity-0
   ```
4. **Menu `PANEL`, select `PANEL` and combobox `POPUP`**, append:
   ```
   origin-[var(--transform-origin)] transition-[opacity,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]
   data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.97]
   data-[ending-style]:opacity-0 data-[ending-style]:scale-[0.97] data-[ending-style]:duration-100
   motion-reduce:transition-opacity
   ```
   Never `scale(0)`; keep 0.97.
5. **Nothing else changes:** no keyframes, no new dependency, no token file. Keep classes in the existing order style, and let the formatter sort them if it does. No tests (UI). Files stay at most 400 lines.

### Allowed files
- `apps/web/src/components/ui/dialog.tsx`
- `apps/web/src/components/ui/sheet.tsx`
- `apps/web/src/components/ui/menu.tsx`
- `apps/web/src/components/ui/select.tsx`
- `apps/web/src/components/ui/combobox.tsx`
- `work/T-1921-web-overlay-motion.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Dialogs** fade and scale in from 0.97 over 200 ms and leave in 150 ms. On a narrow window they slide up from the bottom over 300 ms and leave downward.
- **The side sheet** slides in from the right and leaves the same way.
- **Menus, selects and comboboxes** grow from their trigger in 150 ms and leave in 100 ms.
- **With reduced motion,** every overlay only fades.
- **Opening and closing quickly** reverses smoothly (transitions).
- The gate passes.

---

## Report (written by the worker when done)

### What I did

Added CSS transitions (no keyframes, no new dependencies) driven by Base UI's `data-starting-style` / `data-ending-style`:

- **`dialog.tsx`** — backdrop fades over 200 ms with the out curve and leaves in 150 ms. Popup gets `transition-[opacity,scale,translate]`: fades and scales from 0.97 over 200 ms, leaves over 150 ms. On `max-sm` it becomes a bottom sheet: scale stays 1, opacity stays 1, and it slides with `translate-y-full` over 300 ms on the drawer curve, leaving over 200 ms. `motion-reduce:transition-opacity` keeps opacity as the only transitioning property.
- **`sheet.tsx`** — backdrop same fade as the dialog. Popup slides in from the right with `translate-x-full` over 300 ms on `cubic-bezier(0.32,0.72,0,1)` and leaves the same way in 200 ms. With reduced motion the translate is pinned to 0 and only opacity fades.
- **`menu.tsx`, `select.tsx`, `combobox.tsx`** — panel/popup strings gain `origin-[var(--transform-origin)]`, `transition-[opacity,scale]`, fade + scale from 0.97 in 150 ms, out in 100 ms, and reduced motion fades only. Never `scale(0)`.

No other files touched; files remain well under 400 lines.

### Checks run

`pnpm gate` from the repo root:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.6s)
PASS  lint  (0.8s)
PASS  typecheck  (2.9s)
PASS  effect  (0.5s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

This run happened after both fix-round commits; the same gate passed on the first round of work as well. A final re-run after this Report edit ended `GATE PASS` with the same checks.

No separate test run was needed: the change is UI-only and the gate found no nearby test files for `@zilar/web` (per AGENTS.md, UI code gets no tests). I did not run the app in a browser, so the actual motion feel is not verified beyond the class wiring; acceptance is left to Julio's live check.

### Fix round (lead review)

- **`T-1921: dialogs and sheets fade in when mounted open`** — added the Tailwind `starting:` classes (`@starting-style`) so a dialog or sheet whose `open` prop is already true on mount still fades/scales in: backdrop `starting:opacity-0`; dialog popup `starting:opacity-0 starting:scale-[0.97]` with `max-sm:starting:*` keeping full opacity and scale and adding `translate-y-full`; sheet popup `starting:translate-x-full` plus the reduced-motion `starting:translate-x-0` / `starting:opacity-0` pair.
- **`T-1921: kit dialogs and sheets play their exit before onClose`** — added a `leaving` state to both shells. Escape, a backdrop click and the dialog header's close key now set `leaving`, which drives `open={open && !leaving}` so Base UI plays the 150–200 ms exit; `onOpenChangeComplete` resets `leaving` and then calls the caller's `onClose`. The `closable` / `dismissable` Escape cancel is unchanged, and a caller that passes `open={false}` itself leaves `leaving` false, so `onClose` is not called twice.

### Notes for the lead

- Reduced motion relies on `motion-reduce:transition-opacity` overriding `transition-property`; the transform is then applied instantly. This is the spec'd approach, but only verified by class output, not by rendering.
- Combobox popup uses `scale` only, as specified (no translate).

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `cbc93752e`. Checked against the `review-animations` bar by sampling computed styles frame by frame in the mock, at 1278 px wide.
- **Menus** (the top-left menu and New chat): start at `scale 0.97`, `opacity 0` and settle in about 150 ms with ease-out. `transform-origin` comes from Base UI and points at the trigger. They leave in about 100 ms.
- **Round 1 gap:** the kit dialogs and sheets had no motion at all. Callers mount them already open (`{dialog === 'group' && <NewGroupDialog/>}`), so Base UI never sets `data-starting-style`, and they unmounted with no exit.
- **After the fix round:**
  - the "New group" dialog fades and scales in from 0.97 over about 200 ms, leaves in about 150 ms on Escape, and is gone afterwards (`onClose` ran);
  - the contact info sheet slides in from the right (`translate` 100% → 0 over about 300 ms, drawer curve) and back out in about 200 ms.
- **Not checked live:** reduced motion, and the narrow-screen bottom slide (class output only).
- **Left as is:** a Cancel or Save button inside a dialog still closes it at once, because callers call their own `onClose`. That is fine for an action.

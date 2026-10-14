---
id: T-1344
title: "Web dialogs and sheets on Radix Dialog: rebuild ui/dialog.tsx, ui/sheet.tsx and ConfirmDialog.tsx on radix-ui's Dialog primitive (portal, focus trap, Escape, scroll lock) keeping their props so the 26 call sites don't change"
status: merged
milestone: M5
branch: task/T-1344-web-dialogs-radix
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1344: Web dialogs on Radix

## Spec (written by Claude, do not edit)

### Why
The library audit (T-1342, row 3). The web overlay kit hand-rolls the focus trap, the "topmost dialog only" Escape rule and focus return (`apps/web/src/components/ui/use-modal.ts`, 95 lines, `:54-94`), and that has needed seven fix rounds (T-0282, T-0318, T-0319, T-0320, T-0359, T-0401). `radix-ui` is already a dependency (`apps/web/package.json:30`, `^1.6.7`), but only `Slot` is used (`ui/button.tsx:2`).

### Library rule (Julio, 2026-10-13)
Use the named library; do **not** hand-roll its behaviour. First check it with `npm view <pkg> version time.modified peerDependencies` and confirm it fits the app (web: React 19 / Vite; mobile: Expo SDK 57, RN new architecture, reanimated 4.5.1, RNGH ~2.32.0). Pin an exact version at least two weeks old. If it does not fit, set `status: blocked` and report instead of hand-rolling. Every file stays at most 400 lines. **No tests** (UI). The plan is `docs/audit/library-plan.md` (T-1342, on branch `task/T-1342-library-audit` until it merges; the row is quoted below).

### What to build
1. **Rebuild `apps/web/src/components/ui/dialog.tsx`** (83 lines) on the Radix `Dialog` primitive from the `radix-ui` umbrella: Root controlled by `open`/`onClose`, Portal, Overlay, Content, Title, Description.
   - Keep **every prop** of `DialogProps` (`:5-19`): `size`, `actions`, `initialFocusRef` (→ `onOpenAutoFocus`), `ariaLabel`, and `dismissable` (false → prevent `onEscapeKeyDown` and `onPointerDownOutside`).
   - Keep the same look and Tailwind classes.
2. **Rebuild `apps/web/src/components/ui/sheet.tsx`** (56) the same way, keeping `SheetProps`.
3. **Make `apps/web/src/components/ConfirmDialog.tsx`** (61) use the new `Dialog`, or Radix `AlertDialog` if it fits better.
4. **Nested dialogs** (a dialog opened from a dialog or sheet): Escape closes only the top one. Radix does this; check one real nested case and name it.
5. **Leave `ui/use-modal.ts` alone.** `apps/web/src/components/media/MediaViewer.tsx` still imports it, and T-1343 removes that import; deleting it is a later clean-up. **Leave `ui/menu.tsx` alone**: it has no trigger element (it's placed with classes), so it needs its own plan.
6. **Do not edit any call site.** If a call site would need a change, report it instead.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/dialog.tsx`, `apps/web/src/components/ui/sheet.tsx`, `apps/web/src/components/ui/use-modal.ts`, `apps/web/src/components/ConfirmDialog.tsx`, `apps/web/src/components/ui/button.tsx`.

### Allowed files
`apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/src/components/ui/dialog.tsx`, `apps/web/src/components/ui/sheet.tsx`, `apps/web/src/components/ConfirmDialog.tsx`, `apps/web/src/components/ui/dialog.fixture.tsx`, `apps/web/src/components/ui/sheet.fixture.tsx`, `work/T-1344-web-dialogs-radix.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's web mock check:**
  - Settings → a dialog opens; Escape closes it; Tab stays inside;
  - focus returns to the opener;
  - the look is unchanged.

---

## Report (written by the worker when done)

### What I did

Rebuilt the web kit overlays on the `radix-ui` `Dialog` primitive (Root/Portal/Overlay/Content/Title/Description) and dropped the hand-rolled `useModal` usage from both. `DialogProps` and `SheetProps` are unchanged, so the 26 call sites and both fixtures compile and render without edits.

- `apps/web/src/components/ui/dialog.tsx`: `DialogPrimitive.Root` controlled by `open`/`onOpenChange`; `Portal` → `Overlay` (same `fixed inset-0 z-40 ... bg-black/40` classes) → `Content` (same `max-h-[85vh] ... bg-panel p-5 shadow-xl` classes and the same `size` → `max-w-*` mapping). `Title`/`Description` replace the `<h2>`/`<p>` but keep the same classes and text. `actions`/`children` layout unchanged. `ariaLabel` still overrides the visible title: when set I pass `aria-label` and clear Radix's auto `aria-labelledby` so the accessible name is the `ariaLabel`. `initialFocusRef` → `onOpenAutoFocus` (preventDefault + `.focus()`). `dismissable={false}` → `onEscapeKeyDown`/`onPointerDownOutside` call `preventDefault()`. Focus return to the opener is done in `onOpenAutoFocus`/`onCloseAutoFocus` because Radix otherwise only restores focus to its own `Trigger`, which this kit does not use.
- `apps/web/src/components/ui/sheet.tsx`: same rebuild, right-side drawer classes kept (`fixed inset-0 z-40 flex justify-end bg-black/40` overlay, `flex h-full w-full ... sm:w-[380px]` content), `aria-label={ariaLabel}` (required prop) so no `Title` is needed. Same `initialFocusRef`, `dismissable` and focus-return handling.
- Escape always calls `stopPropagation()` in `onEscapeKeyDown`, matching the old "swallow Escape before window listeners" rule (`ChatShell`'s narrow-layout handler), while `dismissable={false}` additionally `preventDefault()`s so Radix does not dismiss. Radix wires this listener to the topmost layer only, so a nested dialog closes alone.
- `apps/web/src/components/ConfirmDialog.tsx`: left unchanged. It already renders `Dialog` and every prop it uses (`open`, `onClose`, `title`, `description`, `size`, `initialFocusRef`, `actions`) keeps its shape, so no edit was needed.
- Fixtures left unchanged too.
- `apps/web/package.json` + `pnpm-lock.yaml`: pinned `radix-ui` from `^1.6.7` to the exact installed `1.6.7` per the library rule ("pin an exact version at least two weeks old"). `npm view radix-ui version time.modified peerDependencies` shows current `1.8.1` (2026-10-12, one day old) and `1.6.7` published 2026-07-24; peer deps include `react ^19`/`react-dom ^19`, which fits web (React 19 / Vite). Only the lockfile specifier changed; the resolved version was already 1.6.7.

### Nested dialog case (checked in code)

`apps/web/src/components/TopicPanel.tsx:241-258`: the topic-info `Sheet` renders two `ConfirmDialog`s (they are siblings in the fragment, so each Radix layer mounts above the sheet). Escape while a confirm is open closes only that confirm and leaves the sheet open. Same shape in `apps/web/src/components/FolderEditorDialog.tsx:206` (a `Dialog` with a delete `ConfirmDialog`), and `ContactPanel.tsx:214/323`. Radix's `DismissableLayer` attaches its keydown handler only to the highest layer, so this is the library behaviour, not something re-implemented here.

### Commands run (real results)

- `pnpm install` — done, 1184 packages, peer-dep warnings only (pre-existing `@types/react` mismatch in `apps/mobile`, unrelated).
- `pnpm install --lockfile-only` — used to record the pinned specifier (`^1.6.7` → `1.6.7`); resolved version stayed `1.6.7`.
- `pnpm gate` — `GATE PASS`:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (2.2s)
  PASS  format  (1.5s)
  PASS  lint  (1.1s)
  PASS  typecheck  (4.9s)
  PASS  effect  (1.0s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Files changed

`apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/src/components/ui/dialog.tsx`, `apps/web/src/components/ui/sheet.tsx`, `work/T-1344-web-dialogs-radix.md`. All inside the Allowed files.

### Deviations / notes

- I did not run `pnpm dev` or click through the UI, so the "look unchanged" and the focus/Escape/Tab acceptance are argued from the code and Radix's source, not observed in a browser. The lead's web mock check is the real test.
- `ui/use-modal.ts` and `ui/menu.tsx` were left alone as the spec says; `use-modal` is now imported only by `MediaViewer.tsx`.

### Open questions

None. (If pinning `radix-ui` exactly was not wanted, that is the only non-overlay change in this task.)


## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (0 nits); the packet is current for `21213733`.**
Lead's headless web mock check, Settings → Folders → New folder:
- the dialog opens with the same look and is named "New folder";
- after 12 Tabs, focus is still inside;
- Escape closes it, and focus returns to the opener.

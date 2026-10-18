---
id: T-1966
title: "Phone UI consistency M8+M10: Connections, Machines and the sticker pack page use the shared ScreenHeader; drop the dead largeTitle prop"
status: merged
milestone: M5
branch: task/T-1966-phone-last-headers
model: deepseek/deepseek-flash
effort: default
depends_on: [T-1948]
estimate: 30 min
---

# T-1966: Phone last hand-made headers (M8 + M10)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: "make sure all the ui follows the same style and flow". These are batches M8 and M10 of `docs/audit/ui-consistency.md` §5, plus the T-1960 review follow-up. After this, no phone screen draws its own `ChevronLeft` header.

### Facts (read by the lead on 2026-10-18)
- **The shared header.** `apps/mobile/src/components/ui/screen-header.tsx` exports `ScreenHeader({ variant: 'root' | 'sub', title, subtitle?, onBack?, right?, bare? })`. `bare` draws only the 56 dp nav row.
- **Connections header.** `apps/mobile/src/components/connections/connections-header.tsx` (35 lines) is a hand-made back key (`:21-23`), an "Add key" `IconButton` (`:25-27`) and a 28/600 title below them (`:30`).
- **Machines header.** `apps/mobile/src/components/machines/machines-header.tsx` (38 lines) is the same: back (`:24-26`), "Add machine" (`:28-30`) and the title (`:33`). It is used at `apps/mobile/src/app/settings/machines.tsx:82` with `showAdd`.
- **Sticker pack page.** `apps/mobile/src/app/stickers/[packId].tsx` has a hand-made nav row: back at `:158-159` and a Share key. The body then draws the 28/600 pack title (`:192`).
- **The dead prop.** `apps/mobile/src/components/settings/screen-shell.tsx:15` still declares `largeTitle?: boolean`, which has done nothing since T-1948. It is passed at `apps/mobile/src/app/settings/sticker-pack.tsx:49` and `apps/mobile/src/app/settings/stickers.tsx:157`.

### Steps
1. **Connections and Machines.** Make each header file render `<ScreenHeader variant="sub" title=… onBack=… right={…Add key…} />`. Keep the props, so the callers don't change, and keep `showAdd` working: no Add key when it is false.
2. **Sticker pack page.** In `stickers/[packId].tsx`, replace the hand-made nav row with `<ScreenHeader variant="sub" bare title={packTitle} onBack={…} right={…Share key…} />`. Keep the body title at `:192` as it is.
3. **The dead prop.** Remove `largeTitle` from `screen-shell.tsx` and from its two callers.
4. **Change nothing else.** No tests, since this is UI. Every file stays at or under 400 lines.

### Allowed files
- `apps/mobile/src/components/connections/connections-header.tsx`
- `apps/mobile/src/components/machines/machines-header.tsx`
- `apps/mobile/src/app/stickers/[packId].tsx`
- `apps/mobile/src/components/settings/screen-shell.tsx`
- `apps/mobile/src/app/settings/sticker-pack.tsx`
- `apps/mobile/src/app/settings/stickers.tsx`
- `work/T-1966-phone-last-headers.md`

### Checks
```bash
pnpm gate
```

### Acceptance
The lead checks the phone smoke:
- **`/settings/connections` and `/settings/machines`:** the same back row as `/settings/devices`, with the + key on the right and the 28/600 title under it.
- **A pack page:** the back and Share keys sit in the shared 56 dp row.
- **The gate passes.**

---

## Report (written by the worker when done)

### What I did

- `apps/mobile/src/components/connections/connections-header.tsx`: now renders the shared `<ScreenHeader variant="sub" title="Connections" onBack right={showAdd ? Add key : undefined} />`. Props (`onBack`, `onAdd`, `showAdd`) are unchanged, so `connections.tsx` needed no edit, and no Add key is drawn when `showAdd` is false.
- `apps/mobile/src/components/machines/machines-header.tsx`: same rewrite with `title="Machines"` and the "Add machine" key. Props unchanged, so `machines.tsx:82` needed no edit.
- `apps/mobile/src/app/stickers/[packId].tsx`: replaced the hand-made nav row with `<ScreenHeader variant="sub" bare title={pack?.title ?? ''} onBack right={Share key} />`; the Share key is still absent while the pack is loading or failed. The body title at the old `:192` (now `:190`) is untouched. Dropped the now-unused `ChevronLeft` import.
- `apps/mobile/src/components/settings/screen-shell.tsx`: removed the dead `largeTitle?: boolean` prop and its comment.
- `apps/mobile/src/app/settings/sticker-pack.tsx` and `apps/mobile/src/app/settings/stickers.tsx`: removed the `largeTitle` pass-through.
- No other files changed. Every touched file is well under 400 lines (largest is `settings/stickers.tsx` at 320).

### Checks run

- `pnpm install` at the start: completed with no output.
- `pnpm gate` from the repo root, first run: `FAIL format` on `apps/mobile/src/app/stickers/[packId].tsx` (Prettier wanted the shortened lucide import on one line); all other steps passed.
- After `pnpm exec prettier --write "apps/mobile/src/app/stickers/[packId].tsx"`, `pnpm gate` final run:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (0.6s)
  PASS  lint  (1.0s)
  PASS  typecheck  (5.0s)
  PASS  effect  (1.2s)
  PASS  tests @zilar/mobile  (3.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files run separately: this is UI-only and the gate ran `@zilar/mobile` tests.

### Notes for the lead

- The old pack-page nav row used `px-4 py-2` (about 56 dp tall with the 40 px keys); it now uses the shared 56 dp row (`pl-1 pr-4`), so the back key sits slightly closer to the left edge, matching `/settings/devices`.
- `ScreenHeader` requires a string `title`; with `bare` it is not drawn, so the pack page passes `pack?.title ?? ''` while loading. The Share key stays hidden until the pack loads.
- Nothing outside the Allowed files was touched.

## Review (written by Claude)

**Approved and merged.** The pre-review was clean. The lead checked the phone smoke (mock build of `ee2ab9cd7`):
- **`/settings/connections` and `/settings/machines`:** the shared 56 dp row, with back on the left and + on the right, then the 28/600 title.
- **`/stickers/<Space cats>`:** back and Share sit in the shared row, and the 28/600 pack title stays in the body.
- **The dead prop:** `largeTitle` is gone from the shell and both of its callers.

With this, the phone header batches M1 to M10 are all merged.

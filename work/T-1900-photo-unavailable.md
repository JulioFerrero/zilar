---
id: T-1900
title: "A card photo that cannot load says so: web and phone images blocks show an ImageOff icon and 'Photo unavailable' (muted, centred) on the existing dark tile instead of a blank box"
status: merged
milestone: M5
branch: task/T-1900-photo-unavailable
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1900: "Photo unavailable" instead of an empty box

## Spec (written by Claude, do not edit)

### Why
**Julio, 2026-10-17, with a phone screenshot:** an AI photo card showed as "just an empty message". Its stored file was lost when card media moved to the persistent volume (T-1890), so the image request fails. Both apps then draw a plain `#181818` tile that reads as an empty bubble. A failed photo must say what happened.

### Facts (read by the lead on 2026-10-17)
- **Phone:** in `apps/mobile/src/components/chat/blocks/images-block.tsx` (171 lines), a tile with `source === undefined || failed` renders `<View className="h-full w-full" style={{ backgroundColor: PLACEHOLDER }} />` (`:69-70`, `PLACEHOLDER = '#181818'` at `:15`). `onError` sets `failed` (`:74`).
- **Web:** in `apps/web/src/components/message/blocks/ImagesBlock.tsx` (84 lines), a tile is a `bg-[#181818]` box (`:53`). The `<img>` is left out once `failed.has(id)` (`:59-65`), which leaves a blank box.
- Both apps use lucide icons (`lucide-react-native` / `lucide-react`); both have `ImageOff`.

### Steps
1. **Phone:** when `failed` is true, the placeholder `View` gets `items-center justify-center gap-1.5` with:
   - `<ImageOff size={22} color={MUTED_FOREGROUND} />` (use the muted colour constant this file or the theme already exports);
   - `<Text className="text-[12px] text-muted-foreground">Photo unavailable</Text>`.

   Keep it plain while the source is merely `undefined` (still loading).
2. **Web:** when `failed.has(id)`, render inside the box an absolutely centred `flex flex-col items-center gap-1.5 text-muted-foreground` with `<ImageOff className="size-5" aria-hidden />` and `<span className="text-[12px]">Photo unavailable</span>`.
3. **Keep the rest as is:** the tile size, the `+N` overlay and tap-to-open. A failed tile doesn't open the viewer, if that's simple to guard; otherwise leave it.
4. **No tests.** Both files stay at most 400 lines.

### Allowed files
- `apps/mobile/src/components/chat/blocks/images-block.tsx`
- `apps/web/src/components/message/blocks/ImagesBlock.tsx`
- `work/T-1900-photo-unavailable.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **A card photo whose file is gone** shows the ImageOff icon and "Photo unavailable" on web and phone, and doesn't look empty.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- **Phone** (`apps/mobile/src/components/chat/blocks/images-block.tsx`): a failed tile now draws the dark placeholder with `items-center justify-center gap-1.5`, an `ImageOff` icon (`size={22}`, `color={MUTED_FOREGROUND}` from `@/lib/colors`) and `Photo unavailable` in `text-[12px] text-muted-foreground`. A tile whose source is merely `undefined` keeps the plain `#181818` box, so loading looks the same as before. Tapping a failed tile no longer opens the viewer (`!failed` in the `onPress` guard).
- **Web** (`apps/web/src/components/message/blocks/ImagesBlock.tsx`): when `failed.has(id)`, the tile renders an absolutely centred `flex flex-col items-center gap-1.5 text-muted-foreground` with `<ImageOff className="size-5" aria-hidden />` and `<span className="text-[12px]">Photo unavailable</span>` instead of the removed `<img>`. A failed tile also drops its `href`, so it is no longer a link and cannot be opened; `target`/`rel` are harmless without it.
- Tile sizes, corner radii, the `+N` overlay and tap-to-open behave exactly as before.
- No new dependencies, no tests (UI-only change, per the spec). Both files stay well under 400 lines (mobile 181, web 90).

### Checks run
`pnpm gate` (from the repo root):
```
gate: 3 changed file(s) against main
PASS  install (frozen)  (1.8s)
PASS  format  (0.8s)
PASS  lint  (1.2s)
PASS  typecheck  (7.9s)
PASS  effect  (1.3s)
SKIP tests @zilar/mobile (no nearby test files)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
No single test files were run: the gate reports no nearby test files for either package, and the spec asks for none.

### Notes for the lead
- Deviation: the web tile lost its `href` when failed, going slightly beyond "render the message" because the spec allowed guarding tap-to-open "if that's simple". The anchor element and its classes stay, so the box keeps its size and corners.
- Not visually tested in a browser or on the phone: this is a JSX/class change only, and the gate covers typecheck and lint. Julio's live check should show the icon and label on a card whose media file is gone.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `be9bbabf0`.
- **Both apps:** a failed photo shows `ImageOff` plus "Photo unavailable" on the dark tile, and a failed tile no longer opens (web `href` dropped, phone guard). A tile that is merely loading stays plain.
- **Emulator check** (mock `/dev/blocks`): the photos stay as blank loading tiles, since mock images never fail. So the failed state is checked live after the deploy, on the 19:22 "cards test" card whose file was lost in the D1 move.


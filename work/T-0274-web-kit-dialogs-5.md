---
id: T-0274
title: "Web kit migration 7: the Explore overlay and the avatar crop dialog render through the kit Dialog"
status: todo
milestone: M5
branch: task/T-0274-web-kit-dialogs-5
model: auto
effort: low
depends_on: [T-0273]
estimate: 0.3 day
---

# T-0274: Explore and avatar crop on the kit Dialog

## Spec (written by Claude, do not edit)

### Why
This is audit step 6, batch 5. The kit `Dialog` (`apps/web/src/components/ui/dialog.tsx`) already owns:
- the topmost-only Escape, the focus trap and focus return, and `initialFocusRef` (line 20);
- `dismissable` (line 24, default `true`; it turns off both Escape and the backdrop click, see lines 67 and 112);
- `size: 'sm' | 'md' | 'lg'` (line 18);
- an 85vh cap with a scrolling body between a fixed title and a fixed footer.

T-0258, T-0263, T-0270 and T-0273 moved the other modal dialogs.

### Verified facts (do not re-derive)
- `apps/web/src/components/ExplorePage.tsx`:
  - line 85 has its own Escape `useEffect`;
  - lines 145-155 render a `role="dialog"` shell with `aria-label={PAGE_TITLE}`, a backdrop click that closes, and a `max-h-[80vh] max-w-md flex-col` panel with a "Explore" `h2`;
  - the search input has `autoFocus` at line 161;
  - the results list scrolls itself at line 199 (`min-h-0 flex-1 overflow-y-auto`).
  - Test: `apps/web/src/components/ExplorePage.test.tsx`.
- `apps/web/src/components/AvatarUploader.tsx`:
  - lines 321-336 render the crop `role="dialog"` with `aria-label="Crop your picture"`;
  - its backdrop click closes only when `!busy` (it revokes the preview URL, then sets the phase to idle);
  - there is no Escape handling today;
  - the panel is `max-w-sm … items-center gap-3` with an `h2` "Crop your picture", a crop area, a zoom slider, a hint, and Cancel / "Save picture" buttons.
  - Test: `apps/web/src/components/AvatarUploader.test.tsx` (lines 57 and 83 query `getByRole('dialog', { name: 'Crop your picture' })`).

### What to build
1. **ExplorePage** renders through the kit `Dialog`:
   - `title="Explore"`, `ariaLabel={PAGE_TITLE}` (line 10, `'Explore public groups and channels'`; the tests may query this name), and `size="md"`;
   - focus the search input through `initialFocusRef` instead of `autoFocus`;
   - delete its own Escape effect, backdrop and panel markup;
   - the results list still scrolls, and the dialog stays within the screen height. Keep the subtitle, input, filters, list, "Load more" and every text unchanged.
2. **AvatarUploader crop** renders through the kit `Dialog`:
   - `title="Crop your picture"`, `size="sm"`;
   - put the Cancel and "Save picture" buttons in `actions`;
   - closing (Escape or backdrop) does exactly what Cancel does today: revoke the preview URL and set the phase to idle. Pass `dismissable={!busy}` so nothing closes while saving;
   - keep the pointer handlers, the zoom slider and the texts unchanged.
3. **Tests:**
   - existing tests keep passing, changed only where they relied on the old markup;
   - add an Escape-closes test for each dialog;
   - for the crop dialog, also test that Escape revokes the preview URL (`URL.revokeObjectURL` is called).

### Read first
`AGENTS.md`, `apps/web/src/components/ui/dialog.tsx`, `work/T-0273-web-kit-dialogs-4.md` (Report), and the two files with their tests.

### Allowed files
`apps/web/src/components/ExplorePage.tsx`, `apps/web/src/components/ExplorePage.test.tsx`, `apps/web/src/components/AvatarUploader.tsx`, `apps/web/src/components/AvatarUploader.test.tsx`, `work/T-0274-web-kit-dialogs-5.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot ExplorePage AvatarUploader
pnpm gate
```

### Acceptance
- Neither file contains `role="dialog"` or its own Escape handler. Behaviour and texts are unchanged, except that Escape now closes the crop dialog when it is not busy.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

### Out of scope
- `StickerPanel` (a non-modal popover);
- the side panels: `GroupPanel`, `PinsPanel`, `TopicPanel`, `ChannelPanel` and `AiPanel`.

---

## Report (written by the worker when done)

## Review (written by Claude)

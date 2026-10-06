---
id: T-0274
title: "Web kit migration 7: the Explore overlay and the avatar crop dialog render through the kit Dialog"
status: merged
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

### What I did

Moved the Explore overlay and the avatar crop dialog onto the kit `Dialog`. Neither file keeps a `role="dialog"`, a backdrop, panel markup or a dialog Escape handler; the kit owns Escape, the focus trap and focus return.

- **`apps/web/src/components/ExplorePage.tsx`**
  - The overlay renders through `<Dialog open onClose={onClose} title="Explore" ariaLabel={PAGE_TITLE} size="md" initialFocusRef={searchRef}>`. The visible title stays `Explore`; `ariaLabel` keeps the old accessible name `Explore public groups and channels` (`PAGE_TITLE`), which the tests were already able to query.
  - The search input gets `ref={searchRef}` (`useRef<HTMLInputElement>`) instead of `autoFocus`; `initialFocusRef` focuses it on open.
  - The subtitle, input, Kind filter, results list, Retry, empty state, rows, "Show more" and its texts stayed byte-for-byte apart from re-indentation. The Close button moved from the old bottom row into the kit `actions` footer (still text `Close`, same handler).
  - Deleted the own Escape effect and both wrapper `div`s.
- **`apps/web/src/components/AvatarUploader.tsx`**
  - The crop overlay renders through `<Dialog open onClose={closeCrop} title="Crop your picture" size="sm" dismissable={!busy} actions={Cancel + Save picture}>`. All buttons, texts, the pointer handlers, the zoom slider and the hint are unchanged.
  - Added `closeCrop`, which is exactly the old Cancel/backdrop behaviour: revoke the preview URL when in the crop phase, then set the phase to idle. It is wired to both Cancel and the kit `onClose` (backdrop and Escape). `dismissable={!busy}` keeps Escape and the backdrop from closing while saving.
  - The old `cn(...)` on the Save button wrapped a single class string; replaced with a plain `className` and dropped the now-unused `cn` import.
- **Tests**
  - `ExplorePage.test.tsx`: `renderExplore` now takes an `onClose`; added `closes with Escape` (asserts the callback ran once).
  - `AvatarUploader.test.tsx`: added `closes the crop dialog with Escape and revokes the preview URL`. jsdom has no `URL.createObjectURL`, so the test stubs `URL` with `createObjectURL: () => 'blob:preview'` and a `revokeObjectURL` spy, then asserts the dialog is gone and `revokeObjectURL` was called with `blob:preview`. Added `afterEach(() => vi.unstubAllGlobals())` to restore it.
  - No existing assertion needed changing: both files still query `getByRole('dialog', { name: ... })` and still find the same accessible names.

### Files changed

`apps/web/src/components/ExplorePage.tsx`, `apps/web/src/components/ExplorePage.test.tsx`, `apps/web/src/components/AvatarUploader.tsx`, `apps/web/src/components/AvatarUploader.test.tsx`, `work/T-0274-web-kit-dialogs-5.md`.

`apps/web/src/components/ui/dialog.tsx` was not touched: `size="md"` matches the old `max-w-md` Explore panel and `size="sm"` the old `max-w-sm` crop panel, and `dismissable`/`initialFocusRef` already existed.

### Commands and real results

- `pnpm install`: exit 0; `pnpm-lock.yaml` untouched (`git status` clean before edits, lockfile not in the diff).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot ExplorePage AvatarUploader`: 2 files passed, 14 tests passed.
- `pnpm gate` first run: `FAIL format` on `apps/web/src/components/ExplorePage.tsx` (my hand re-indentation); ran `pnpm exec prettier --write apps/web/src/components/ExplorePage.tsx` (targeted, only that file) and re-ran the gate.
- `pnpm gate` (repo root), final:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (24.5s)
  PASS  lint  (2.5s)
  PASS  typecheck  (19.9s)
  PASS  tests @zilar/web  (45.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / open questions

- **Explore now scrolls as a body, not only the list.** The kit body (`min-h-0 flex-1 overflow-y-auto`) is the scroll container between the fixed title and the fixed `actions` footer, so the subtitle and filter row scroll with the list; before, only the results `div` scrolled. The spec explicitly describes the kit as taking "an 85vh cap with a scrolling body" and asks only that "the results list still scrolls, and the dialog stays within the screen height", which it does. No test depends on which element scrolls.
- **Visual deltas from the kit shell, no text/behaviour change:** the panel background is `bg-panel` (was `bg-background`) and the title is the kit's fixed `18px` row (crop's was `16px`); the crop dialog's backdrop is the kit's `z-40 bg-black/40` (was `z-50 bg-black/60`). Retry/Cancel/Save/Close are now in the kit footer (`mt-5 justify-end gap-2`) instead of their old inline rows.
- **Escape for the crop dialog is new** (there was none before), as the spec asks; it follows Cancel exactly, including revoking the preview URL, and is disabled while `busy`.

## Review (written by Claude)

**Approved.** The pre-review was clean with 0 nits, and there were no fix rounds.

- **Explore:** it is on the kit `Dialog` and focuses the search through `initialFocusRef`. Most of the diff is re-indentation.
- **Avatar crop:**
  - Cancel, Escape and the backdrop all call one `closeCrop`, which revokes the preview URL;
  - `dismissable={!busy}` stops a close while the picture saves.
- **Accent pill:** the "Save picture" pill is still hand-made. That is fine: it was outside this task's scope, and the next accent-button batch covers it.
- **Modal dialogs:** none hand-made is left in web. What remains is `StickerPanel`, a popover, and the side panels.

---
id: T-1239
title: "TG-4 composer, web: Ctrl/Cmd+B wraps the selection in **…**, Ctrl/Cmd+I in _…_, Ctrl/Cmd+E in `…` (toggle off when already wrapped; empty selection inserts the pair with the caret inside), and a one-line Formatting hint in the composer's help (no toolbar)"
status: merged
milestone: M5
branch: task/T-1239-web-format-shortcuts
model: auto
effort: default
depends_on: [T-1225]
estimate: 0.25 day
---

# T-1239: Formatting shortcuts in the web composer

## Spec (written by Claude, do not edit)

### Why
It's item 4 of the Telegram parity fix plan (`docs/audit/telegram-parity-audit.md` §4): "`**` and `` ` `` shortcuts in the web composer; one Formatting hint". T-1225 (merged) renders light Markdown for human messages through `packages/chat-core/src/light-markdown.ts`: bold `**…**`, italics `_…_`, inline code and code blocks. Read its exact marker rules (which italic marker is accepted, and whether `*…*` is italic) and use the markers it parses.

The composer's key handler is `onComposerKeyDown` (`apps/web/src/components/Composer.tsx:315`), with the value from `useDraftValue` (`:28`).

### What to build
1. **The new `apps/web/src/components/composer/formatShortcut.ts`:** a pure helper.
   - `applyFormat(value, selectionStart, selectionEnd, marker)` returns `{ value, selectionStart, selectionEnd }`.
   - **It wraps the selection** in `marker` on both sides and keeps the same text selected.
   - **It toggles off:** when the selection is already wrapped (the markers just outside it, or inside at both ends), the markers are removed instead.
   - **An empty selection** inserts the pair and puts the caret between.
2. **`Composer.tsx`:** in `onComposerKeyDown`, after the mention handling (`:322`), handle Ctrl or Cmd+B (bold), +I (italics) and +E (inline code) with no Shift or Alt, and `preventDefault`. Apply the helper to the textarea's selection, `setValue`, then restore the selection after the update (`requestAnimationFrame` or a layout effect; cite the existing caret-restore code if the mentions hook has one). **`Composer.tsx` is 394 lines and must stay at most 400**, so put the key-to-marker logic in the helper and add only a few lines here.
3. **The hint:** one muted line, "**bold**, _italic_, `code`, ``` for a block", where the composer already shows help, or as the textarea's `title`. Choose the smallest visible spot, cite it, and use no new toolbar and no emoji. It must not add height to the composer.
4. **Tests:** none. The helper is UI text editing, not the pipeline. Check the helper by hand and list the cases in the Report.

### Read first
`AGENTS.md`, `packages/chat-core/src/light-markdown.ts`, `apps/web/src/components/Composer.tsx`, `apps/web/src/components/composer/ComposerControls.tsx` and `apps/web/src/components/composer/useMentions.ts`.

### Allowed files
`apps/web/src/components/composer/formatShortcut.ts`, `apps/web/src/components/Composer.tsx`, `apps/web/src/components/composer/ComposerControls.tsx`, `work/T-1239-web-format-shortcuts.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, and `Composer.tsx` stays at most 400 lines.
- **The lead's check on the local web mock:**
  - select a word, then Cmd+B: it shows `**word**`, and pressing it again removes the markers;
  - Cmd+E with no selection puts the caret between backticks;
  - the sent message renders bold.

---

## Report (written by the worker when done)

### What I did

- New `apps/web/src/components/composer/formatShortcut.ts`:
  - `applyFormat(value, selectionStart, selectionEnd, marker)` — pure, total, returns `{ value, selectionStart, selectionEnd }`. Wraps the selection in `marker` on both sides keeping the same text selected; toggles off when the marker is just outside both ends or at both ends inside the selection (an empty caret between markers also unwraps); an empty selection inserts the pair with the caret between. Handles a reversed selection (start > end) and normalises it.
  - `markerFor` maps Ctrl/Cmd+B→`**`, +I→`_`, +E→`` ` `` (no Shift, no Alt; needs Ctrl or Cmd). Markers match `packages/chat-core/src/light-markdown.ts`: bold `**…**`, italic `_…_` (the underscore form, not `*…*`), inline code `` `…` ``.
  - `handleFormatShortcut(event, value, setValue)` — the DOM adapter: reads the textarea's selection, calls `applyFormat`, `preventDefault()`, `setValue(next.value)`, then restores the range in `requestAnimationFrame`. This is the same commit-then-restore idea as `pendingCaretRef` in `useMentions.ts:85-92`, but a frame is used because here the selection is a range, not a single caret. It returns `true` when it consumed the key.
- `apps/web/src/components/Composer.tsx`: added one import and folded the handler into the existing mention guard at `:323` — `if (mentions.onMentionKeyDown(event) || handleFormatShortcut(event, value, setValue))`. No other change; the file went 394 → **395 lines** (limit 400).
- Hint: added a `title` to the composer textarea in `apps/web/src/components/composer/ComposerControls.tsx:202` with the text

  ```
  **bold**, _italic_, `code`, ``` for a block
  ```

  This is the smallest visible spot that adds **zero** height to the composer (a tooltip); a rendered line would have added height, which the spec forbids. No toolbar, no emoji.

### Files changed

- `apps/web/src/components/composer/formatShortcut.ts` (new)
- `apps/web/src/components/Composer.tsx` (import + one guard)
- `apps/web/src/components/composer/ComposerControls.tsx` (textarea `title`)
- `work/T-1239-web-format-shortcuts.md` (this report)

### Commands I ran

- `pnpm install` — done, 16 workspace projects, no errors (one pre-existing peer-dependency warning in `apps/mobile`).
- Helper checked by hand with an inline Node import of the real module (no test files created). Cases and real output:
  - wrap a word: `applyFormat('hello world', 0, 5, '**')` → `{"value":"**hello** world","selectionStart":2,"selectionEnd":7}`
  - toggle off, markers outside: `applyFormat('**hello** world', 2, 7, '**')` → `{"value":"hello world","selectionStart":0,"selectionEnd":5}`
  - toggle off, markers inside the selection: `applyFormat('**hello**', 0, 9, '**')` → `{"value":"hello","selectionStart":0,"selectionEnd":5}`
  - empty selection inserts the pair: `applyFormat('hi', 1, 1, '`')` → `{"value":"h``i","selectionStart":2,"selectionEnd":2}`
  - italic wrap/toggle: `('hello world', 6, 11, '_')` → `hello _world_`; `('hello _world_', 7, 12, '_')` → `hello world`
  - caret between markers unwraps: `applyFormat('ab****cd', 4, 4, '**')` → `{"value":"abcd","selectionStart":2,"selectionEnd":2}`
  - empty text: `applyFormat('', 0, 0, '`')` → `` `` `` with caret 1
  - reversed indices: `applyFormat('hello world', 5, 0, '**')` → same as forward wrap
- `pnpm gate` (from the repo root), summary lines:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (1.2s)
  PASS  lint  (0.9s)
  PASS  typecheck  (3.2s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- No tests written, per spec ("none"): the helper is UI text editing, not the pipeline. No test files were run.

### Deviations / notes

- The spec said "Apply the helper to the textarea's selection, `setValue`" — done with `setValue`, not `mentions.onChange`.
- Known limitation (flagging, not blocking): the format shortcut changes the draft text through `setValue` only, so tracked mention ranges (`useMentions`'s `mentions`) are **not** rebased. If a message already contains a tracked `@Name` mention and the user wraps the whole text (e.g. Cmd+A then Cmd+B), the mention offsets become stale by the marker length. The typing path and the emoji path go through `mentions.onChange`, which rebases; this path does not. Happy to rebase via `rebaseMentions` if the lead wants it — it was outside the literal spec.
- The hint is a `title` tooltip, so it is not a visible muted line in the layout. That was the only option that satisfies the hard "must not add height to the composer" constraint; called out here so the lead can confirm.

### Security checklist

- No secrets, tokens or URLs touched. The composer text is user input and only goes back into the same draft store as before; no new logging, no new route, no new write, no server-side change.

### Round (fix round, 2026-10-12)

Fixed every must-fix and should-fix from `PREREVIEW.md` (must-fix=0, should-fix=1, nit=1). `PREREVIEW.md` was read but not staged, edited or deleted.

- **Finding 1 (should-fix) — mention ranges stale after a format key.** The format path called `setValue` directly, bypassing `mentions.onChange`, so tracked mention ranges were never rebased and the picker query stayed stale. `handleFormatShortcut` now hands the new value and selection to an `onApply` callback, and `Composer.tsx` passes `(next) => mentions.onChange(next.value, next.selectionEnd)`, so the format path uses the same rebase (`rebaseMentions`) and picker refresh as typing. `Composer.tsx` stayed at 398 lines (limit 400). Commit `656881a0f`.
- **Finding 2 (nit) — rAF comment.** Reworded the comment on the docstring Finding 1 already touched, to say the frame runs after React commits the new value instead of justifying it with "range, not a caret". Commit `3cf6bff1a`.
- **Tests:** none added. The finding names no test, the Spec says "Tests: none", and a test file (`apps/web/src/components/composer/formatShortcut.test.ts`) falls outside the task's Allowed files (the gate's scope check would list it), so none was created. The rebase behaviour itself is covered by `rebaseMentions` in `@zilar/chat-core`.
- `pnpm gate` (from the repo root), summary lines:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.3s)
  PASS  lint  (0.6s)
  PASS  typecheck  (2.8s)
  PASS  effect  (0.4s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Round 2 (lead fix round 2, 2026-10-12)

- **Problem (seen on the mock):** after a shortcut the text was right but the selection was not restored — select "bold", Cmd+B left nothing selected (and a second Cmd+B appended `****`), and an empty composer Cmd+E left the caret at 2, not 1. Cause: the `requestAnimationFrame` restore in `formatShortcut.ts` ran before React had committed the new value, so it set the range on the old text and the browser then left the default end caret.
- **Fix:** `formatShortcut.ts` now exports `useFormatShortcut(value, textareaRef, onChange)`. It stores the wanted range in a ref and applies it with `useLayoutEffect` on `value`, which runs after React has written the new text into the textarea but before the browser paints. The key handler still commits through `mentions.onChange`, so tracked mentions keep rebasing (round 1). `Composer.tsx` calls the hook and uses the returned handler; it is **397 lines** (limit 400).
- **Hand check in the mock** (`VITE_MOCK=1 pnpm --filter @zilar/web exec vite --port 5199`, driven in the browser on `#message-composer`):
  - `make this bold`, select "bold" (10–14), Cmd+B → `make this **bold**`, selection 12–16 ("bold" still selected); Cmd+B again → `make this bold`, selection 10–14 ("bold" selected).
  - empty composer, Cmd+E → `` `` `` with caret 1.
  - empty composer, Cmd+I → `__` with caret 1.
  - `make this italic`, select "italic" (10–16), Cmd+I → `make this _italic_`, selection 11–17 ("italic"); Cmd+I again → `make this italic`, selection 10–16 ("italic").
- `pnpm gate` (from the repo root), summary lines:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.3s)
  PASS  lint  (0.9s)
  PASS  typecheck  (2.7s)
  PASS  effect  (0.4s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Disagreements

None.

## Review (written by Claude)

**Lead, 2026-10-12: approved after the lead's fix round 2. Pre-review clean (2 nits).**
- **Lead's check on the local web mock, round 1:** the text was right, but the selection wasn't restored, so a second Cmd+B appended `****`, and Cmd+E left the caret at 2.
- **After round 2:**
  - "make this bold" with "bold" selected, then Cmd+B, gives `make this **bold**` with "bold" still selected; Cmd+B again gives `make this bold`, still selected;
  - Cmd+E on an empty composer gives "``" with the caret at 1;
  - the sent message renders inline code and **bold**.
- **The hint** is the textarea `title` ("**bold**, _italic_, `code`, ``` for a block"), so the composer gets no extra height.

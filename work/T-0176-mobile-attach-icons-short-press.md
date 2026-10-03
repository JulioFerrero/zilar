---
id: T-0176
title: Mobile: icons (not emoji) in the attach popup; a too-short press records nothing and says nothing
status: merged
milestone: M5
branch: task/T-0176-mobile-attach-icons-short-press
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: []
estimate: 0.5 day
---

# T-0176: Attach popup icons and the silent short press

## Spec (written by Claude, do not edit)

### Why
Julio, testing the Android build on his phone (2026-10-03):
1. "i see you used emojis inside the clip popup, use always icons for the UI not emojis". The attach sheet draws its rows and its header with emoji characters (`📎`, `🖼`, `📷`). The whole UI uses `lucide-react-native` icons; emoji are for message content only.
2. "doesn't make sense the too short error, just don't send anything or do anything, just a miss press". Holding the mic for under one second (an accidental touch) currently shows an error hint. It must do nothing visible: no message, no hint.

### What to build
1. **Attach sheet** (`apps/mobile/src/components/chat/attach-sheet.tsx`): replace every emoji character with a lucide icon, sized and coloured like the icons in the composer (`ICON[scheme]` from `@/lib/colors`, size 20): header paperclip `Paperclip`, "Photo or video" `Image`, "Take a photo" `Camera`, "File" `FileText`, the picked-attachment row `Image` for images and `FileText` for files. Look at how `composer.tsx` imports icons and reads the colour scheme. No emoji characters may remain in the file (a test pins this with a regex over the source for the emoji ranges `\p{Extended_Pictographic}`).
2. **Short press** (`apps/mobile/src/components/chat/voice-recorder.tsx` and `apps/mobile/src/lib/voice-native.ts`): when a recording is shorter than `VOICE_MIN_MS` (`@/lib/voice`), it is discarded silently: nothing is sent, `error` stays undefined, no hint appears. `runRecorderFinish` returns `undefined` for that case instead of `RECORD_TOO_SHORT_MESSAGE`. Delete `RECORD_TOO_SHORT_MESSAGE` and any use of it if nothing else needs it (search the whole app; update the tests that mention it). Keep the too-long and failure messages as they are. The recorded file of a discarded short press must not be left behind: if the recorder port offers a way to delete or cancel, use it (read `voice-native.ts`; `cancel()` discards the recording).
3. Tests (Vitest, same style as the existing ones): a sub-1-second recording sends nothing and returns no message; a 1-second recording still sends; the attach-sheet source contains no emoji; the lucide mock lists in the touched tests include the new icons.

### Read first
`AGENTS.md`, `docs/design/ui-style.md` (section 5, composer, and section 7), `apps/mobile/src/components/chat/attach-sheet.tsx`, `composer.tsx` (icon usage), `voice-recorder.tsx` and `voice-recorder.test.tsx`, `apps/mobile/src/lib/voice-native.ts`, `apps/mobile/src/lib/voice-recorder-seam.test.ts`, `attach-sheet.test.tsx`.

### Allowed files
`apps/mobile/src/components/chat/attach-sheet.tsx`, `attach-sheet.test.tsx`, `voice-recorder.tsx`, `voice-recorder.test.tsx`, `composer-layout.test.ts` (only if a pin there mentions the removed copy), `apps/mobile/src/lib/voice-native.ts`, `apps/mobile/src/lib/voice-recorder-seam.test.ts`, `work/T-0176-mobile-attach-icons-short-press.md`. Another task (T-0175) is editing `composer.tsx`, `sticker-panel.tsx` and `gif-panel.tsx`: do not touch those.

### Checks
```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/mobile test --maxWorkers=2 attach voice
```

### Acceptance
- No emoji character in `attach-sheet.tsx`; icons render in the sheet header, the three action rows and the picked-attachment row.
- A press shorter than one second sends nothing and shows nothing; longer still sends with the real waveform.
- `RECORD_TOO_SHORT_MESSAGE` is gone and nothing references it.

### Out of scope
The emoji, sticker and GIF panel (T-0175), any other screen.

---

## Report (written by the worker when done)

### What I did
- `apps/mobile/src/components/chat/attach-sheet.tsx`: replaced every emoji character with lucide icons at size 20 in `ICON[scheme]` (same as `composer.tsx`): header `Paperclip` in a row with the "Attach" title, `Image` for "Photo or video", `Camera` for "Take a photo", `FileText` for "File", `Image`/`FileText` for the demo list by `attachment.kind`, and an extension-based `Image`/`FileText` fallback in `PreviewThumb` when the thumbnail fails to load. Added a `nativewind` `useColorScheme` + `asColorScheme` read like `composer.tsx`/`edit-bar.tsx`. No emoji characters remain in the file.
- `apps/mobile/src/components/chat/voice-recorder.tsx`: `runRecorderFinish` now discards a sub-`VOICE_MIN_MS` recording silently — returns `undefined`, sends nothing, sets no error. The live duration is read via `recorder.currentDurationMs()` *before* `stop()` and, when below the floor, the take is discarded with `recorder.cancel()` (which discards the recording; `cancel()` after `stop()` would be a no-op since `stop()` consumes the native recorder). A post-`stop` duration guard stays as a fallback and also returns `undefined`. Updated the two comments that described the old "too short" refusal. A 1-second recording (exactly `VOICE_MIN_MS`) still sends with the real waveform.
- `apps/mobile/src/lib/voice-native.ts`: deleted `RECORD_TOO_SHORT_MESSAGE`. Verified no other app code references it (only this task file's spec mentions it).
- Tests: `voice-recorder.test.tsx` — sub-1s press asserts `undefined`, nothing sent, `stop` never called, `cancel` called once; new test that a 1000 ms recording still sends. `attach-sheet.test.tsx` — new test pins no `\p{Extended_Pictographic}` in `attach-sheet.tsx` source and that the sheet renders `Paperclip`/`Image`/`Camera`/`FileText`; lucide + `nativewind` + color-scheme mocks added. `voice-recorder-seam.test.ts` — dropped the removed constant, kept the too-long copy pin.
- Out of scope untouched: `composer.tsx`, `sticker-panel.tsx`, `gif-panel.tsx` (T-0175).

### Round 1 (review findings 1–3)
- Finding 1: extracted an exported `PreviewFallbackIcon` seam (`attach-sheet.tsx`) over the exported `isImageName` helper; the vacuous preview test now renders the seam directly and asserts `pic.png` → `<Image>` (and not `<FileText>`), `doc.pdf` → `<FileText>` (and not `<Image>`), plus `isImageName` branches. Mutation-checked: swapping the branches fails the test (1 failed, 5 passed in the temporary run).
- Finding 2 (scope widened by the lead): replaced the remaining paperclip glyphs — `attachment-message.tsx` file row → lucide `FileText`, `attachment-video.tsx` untrusted row → lucide `Video`, both size 20 in `ICON[scheme]` via the same `nativewind` + `asColorScheme` read as the attach sheet. The same pass also replaced the other glyph-drawn UI icons the `\p{Extended_Pictographic}` source pins caught in these two files: retry `↻` → `RotateCcw`, open `⤴` → `ArrowUpRight`, GIF badge `▶` → `Play` (badge still reads "GIF"). New source tests pin no emoji in either file; icon assertions added to both test files and the lucide mock lists extended. Neighbour `attachment-body.test.tsx` renders these components, so it needed `lucide`/`nativewind`/color-scheme mocks too (it broke with `SyntaxError: Unexpected token 'typeof'` from the unmocked `nativewind` chain once `attachment-message.tsx` imported it — my change, so I fixed it there rather than in the components; disclosed, not hidden).
- Finding 3: no change, as instructed.

### Round 1 files changed (in addition to the list above)
- `apps/mobile/src/components/chat/attachment-message.tsx`
- `apps/mobile/src/components/chat/attachment-video.tsx`
- `apps/mobile/src/components/chat/attachment-message.test.tsx`
- `apps/mobile/src/components/chat/attachment-video.test.tsx`
- `apps/mobile/src/components/chat/attachment-body.test.tsx` (missing-mock fix only)

### Round 1 commands (real results)
- Mutation check (branches swapped temporarily, then restored): attach-sheet suite 1 failed / 5 passed while mutated; final suite green.
- `pnpm format:check`: pass.
- `pnpm lint`: pass (oxlint, no findings).
- `pnpm typecheck`: pass (11 tasks successful).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 attach voice`: 18 files, 168 tests, all passed (was 165 before round 1).

### Files changed
- `apps/mobile/src/components/chat/attach-sheet.tsx`
- `apps/mobile/src/components/chat/voice-recorder.tsx`
- `apps/mobile/src/lib/voice-native.ts`
- `apps/mobile/src/components/chat/attach-sheet.test.tsx`
- `apps/mobile/src/components/chat/voice-recorder.test.tsx`
- `apps/mobile/src/lib/voice-recorder-seam.test.ts`
- `work/T-0176-mobile-attach-icons-short-press.md` (this report + status)

### Commands (real results)
- `pnpm install`: ok (1050 packages).
- `pnpm format:check`: pass ("All matched files use Prettier code style!").
- `pnpm lint`: pass (oxlint, no findings).
- `pnpm typecheck`: pass (11 tasks successful).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 attach voice`: 18 files, 165 tests, all passed.
### Security checklist
- No secrets touched, logged or committed.
- No permission/cap/rate-limit surface changed (pure UI + local recorder flow; no new routes).
- No deletes/updates beyond the local recorder discard via the existing `cancel()` seam.

## Review (written by Claude)

**Verdict:** Round 1: changes requested

Verified: scope is the Allowed files, the recorder logic (a press under 1 s is cancelled before `stop`, nothing sent, no hint), `RECORD_TOO_SHORT_MESSAGE` gone, checks pass per the pre-review.

### Findings
1. **Vacuous fallback-icon test** (`attach-sheet.test.tsx:121`). It only asserts the file name, which also renders on the thumbnail path. Make it fail when the icon is wrong or missing: render the failed-preview state (or test `isImageName` and the chosen icon through an exported seam) and assert the `FileText` icon for `doc.pdf` and the image icon for `pic.png`. Mutation-check it by swapping the branches.
2. **Julio asked for icons everywhere** ("always icons for the UI, not emojis"). `attachment-message.tsx:215` and `attachment-video.tsx:136` still render a paperclip glyph. Replace both with the lucide `FileText` (file) / `Video` (video) icon, same size and colour rules as the attach sheet, and add both files and their tests to this task's scope. Pin with a source test that no `\p{Extended_Pictographic}` character remains in either file.
3. *(No change needed.)* The post-`stop()` short guard at `voice-recorder.tsx:125` is unreachable on the real path; fine as a safety net.

### Round 1 result
**Verdict:** Approved. Findings 1 and 2 fixed (the icon choice is now a tested seam; the paperclip glyphs in `attachment-message.tsx` and `attachment-video.tsx` are icons, each pinned by a no-emoji source test). Re-ran format, lint, typecheck and `attach voice` tests after the rebase: 18 files, 168 tests passed. The post-`stop()` guard keeps a harmless leftover file only on an unreachable path.

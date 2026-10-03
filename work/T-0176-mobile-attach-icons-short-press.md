---
id: T-0176
title: Mobile: icons (not emoji) in the attach popup; a too-short press records nothing and says nothing
status: planned
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

## Review (written by Claude)

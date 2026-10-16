---
id: T-1675
title: "Size split of the web Composer.tsx (394 lines): move its voice-recording lifecycle (unmount cancel, chat-switch stop, the elapsed timer, the Escape backstop, onMicPointerUp and the document pointer listeners) into a new composer/useRecordingLifecycle.ts hook — a pure move, no behaviour change"
status: merged
milestone: M5
branch: task/T-1675-split-web-composer
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1675: Split the web composer's recording lifecycle into a hook

## Spec (written by Claude, do not edit)

### Why
`apps/web/src/components/Composer.tsx` is 394 of 400 lines, so the next composer change can't land. Its voice-recording lifecycle is a self-contained block.

### Facts (the lead read them on 2026-10-16)
- **`apps/web/src/components/Composer.tsx`:**
  - `export function Composer({…})` (`:13`);
  - `const voice = useVoiceRecorder({ chatId, replyTo, onCancelReply, storeApi, canSend })` (`:57`), destructured at `:61-74` (`pressRef`, `recorderRef`, `recordingRef`, `setRecording`, `setLocked`, `setCancelArmed`, `setElapsedMs`, `setVoiceError`, `recording`, `cancelRecording`, `finishRecording`, `onMicPointerMove`).
- **The block to move runs from `// Cancels any in-flight recording when the composer unmounts.` (`:119`) to the end of the document-listener effect (`}, []);` at `:261`):**
  - the unmount-cancel effect (`:119-132`);
  - the chat-switch stop effect (`:134-162`);
  - the elapsed-timer effect (`:164-179`);
  - the Escape backstop effect (`:181-197`);
  - `const onMicPointerUp` (`:199-236`);
  - the document `pointerup`/`pointermove` effect (`:238-261`), with its `eslint-disable` comment.
  - `onMicPointerUp` is used only inside this block (`:246`).
- **The folder `apps/web/src/components/composer/`** holds `AttachmentStrip.tsx`, `ComposerControls.tsx`, `formatShortcut.ts`, `useComposerAttachments.ts`, `useComposerFocus.ts`, `useDraftValue.ts`, `useMentions.ts` and `useVoiceRecorder.ts` (390 lines; **don't grow it**). There's no `useRecordingLifecycle.ts`.

### Steps
1. **Create `apps/web/src/components/composer/useRecordingLifecycle.ts`** exporting `useRecordingLifecycle(input)`.
   - `input` carries `chatId`, the `voice` object (or the fields the block uses) and anything else the block reads (read the block for its free variables, e.g. `finishRecording`, `stopTimer`, Effect imports).
   - Move the block **word for word**, comments and the `eslint-disable` line included. It returns nothing.
2. **In `Composer.tsx`:** call `useRecordingLifecycle({…})` where the block was, and drop the imports and destructured names that are no longer used.
3. **No behaviour change, no new tests.**

### Allowed files
- `apps/web/src/components/composer/useRecordingLifecycle.ts`
- `apps/web/src/components/Composer.tsx`
- `work/T-1675-split-web-composer.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **`Composer.tsx` is about 260 lines.** Hold-to-record, the lock, slide-to-cancel, Escape and the chat switch behave as before.
- **Typecheck, lint and the web build pass.**

---

## Report (written by the worker when done)

### What I did
- Created `apps/web/src/components/composer/useRecordingLifecycle.ts` (175 lines) exporting `useRecordingLifecycle({ chatId, voice })`. It holds the moved block word for word, comments and the `eslint-disable-next-line react-hooks/exhaustive-deps` line included: the unmount-cancel effect, the chat-switch stop effect, the elapsed-timer effect, the Escape backstop effect, `onMicPointerUp` and the document `pointerup`/`pointermove` effect. It returns nothing. `stopTimer` and `VoiceRecorderController` are imported from `./useVoiceRecorder`; `finishRecording` comes from the `voice` object.
- In `Composer.tsx`: replaced the block with `useRecordingLifecycle({ chatId, voice })` and dropped the names the block no longer needs. The `voice` destructure is now just `const { recordingRef, cancelRecording } = voice;` (both still used in `onComposerKeyDown`). Removed the now-unused `import { Effect, Schedule } from 'effect';` and changed the voice import to `import { useVoiceRecorder } from './composer/useVoiceRecorder';` (dropping `stopTimer`), adding `import { useRecordingLifecycle } from './composer/useRecordingLifecycle';`.
- No behaviour change, no new tests, no other files touched.

### Checks run
- `pnpm install` — Done (frozen lockfile satisfied).
- No test file renders `Composer` (searched `apps/web/src` for a test importing it: none), so there was no nearby single test to run.
- `pnpm gate` (from repo root) — summary:
  - `gate: 3 changed file(s) against main`
  - `PASS  install (frozen)  (3.9s)`
  - `PASS  format  (7.2s)`
  - `PASS  lint  (5.4s)`
  - `PASS  typecheck  (8.6s)`
  - `PASS  effect  (1.8s)`
  - `SKIP tests @zilar/web (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: ...`, `images: ...`, `size: every changed source file is within 400 lines`
  - `GATE PASS`
- Resulting sizes: `Composer.tsx` 239 lines, `useRecordingLifecycle.ts` 175 lines.

### Notes for the lead
- `Composer.tsx` is 239 lines, a bit under the "about 260" in the Acceptance; the moved block was 143 lines and the import/destructure cleanup removed the rest. All moved lines are accounted for in the new hook.
- The hook takes the whole `voice` object (allowed by the Spec: "the `voice` object (or the fields the block uses)") plus `chatId`.
- Behaviour is a pure move; no logic was edited. Hold-to-record, the lock, slide-to-cancel, Escape and the chat switch read the same refs and call the same functions as before.

## Review (written by Claude)

**Approved and merged.** A pure size split.

- **Pre-review:** clean, 0 nits.
- **The lead's check:** the removed lines equal the new hook's body (diff after stripping indentation and imports); only the hook header and closing brace are new.
- **Result:** web `Composer.tsx` drops from 394 to 239 lines, and `composer/useRecordingLifecycle.ts` is 175.


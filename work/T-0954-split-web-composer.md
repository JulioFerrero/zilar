---
id: T-0954
title: "Size split T13: apps/web/src/components/Composer.tsx (1,145 lines) into composer/{useVoiceRecorder,useComposerAttachments,useMentions}.ts + composer/ComposerControls.tsx, the old path the component"
status: merged
milestone: M5
branch: task/T-0954-split-web-composer
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0954: Split `Composer.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/Composer.tsx` is 1,145 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.1 #9 (task T13): the hooks `composer/useVoiceRecorder.ts`, `composer/useComposerAttachments.ts` and `composer/useMentions.ts`, plus `composer/ComposerControls.tsx`, under `apps/web/src/components/`.

`Composer.tsx` keeps the `Composer` component, which composes the hooks and controls, and every export it has today.

There are no web UI tests (Julio's rule). The lead checks the composer in Chrome in mock mode: text, mention, sticker, GIF, attachment and voice.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.1 #9, and `apps/web/src/components/Composer.tsx`.

### Allowed files
`apps/web/src/components/Composer.tsx`, `apps/web/src/components/composer/useVoiceRecorder.ts`, `apps/web/src/components/composer/useComposerAttachments.ts`, `apps/web/src/components/composer/useMentions.ts`, `apps/web/src/components/composer/ComposerControls.tsx`, `work/T-0954-split-web-composer.md`.

### Checks
```bash
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
The Checks pass, the Report has everything `split-rules.md` item 8 asks for, and the lead's Chrome check passes.

---

## Report (written by the worker when done)

### What I did

Split `apps/web/src/components/Composer.tsx` (1,145 → 394 lines) into the four
files the plan names, moving the code unchanged. `Composer.tsx` keeps the
`Composer` component (the composition glue) and still exports `Composer`. No
importer changed: `routes/ChatView.tsx` still imports `Composer` from
`@/components/Composer`.

- `components/composer/useVoiceRecorder.ts` — voice recorder state machine and
  gesture handlers (`ComposerFailure`, `fork`, `stopTimer`, `PressState`,
  `beginRecording`, `onRecorderFailed`, `onRecorderStarted`, `finishRecording`,
  `onMicClick`, `onMicPointerDown`, `onMicPointerMove`, `onMicPointerCancel`,
  `cancelRecording`).
- `components/composer/useComposerAttachments.ts` — `acceptFile`, preview/object
  URL, drag-drop, paste, sticker outside-click, `sendSticker`, `sendGif`.
- `components/composer/useMentions.ts` — mention tracking, picker state,
  `onChange`, `pickMention`, and the mention-specific key handling.
- `components/composer/ComposerControls.tsx` — presentational controls (mention
  picker, edit bar/reply preview, attachment preview, error rows, recording row,
  textarea, sticker panel, send/mic buttons) plus the textarea auto-resize
  effect.

### `wc -l`

```
old:           apps/web/src/components/Composer.tsx (main)      1145
apps/web/src/components/Composer.tsx (barrel)                    394
apps/web/src/components/composer/useVoiceRecorder.ts             390
apps/web/src/components/composer/useComposerAttachments.ts       253
apps/web/src/components/composer/useMentions.ts                  190
apps/web/src/components/composer/ComposerControls.tsx            284
```

Every new file and the barrel are ≤ 400 lines.

### Export list (before → after)

Before (`git show main:.../Composer.tsx | grep -E "^export"`):

```
export function Composer({
```

After (`grep -nE "^export"` on the barrel + new files):

```
Composer.tsx:13:                      export function Composer({
composer/useVoiceRecorder.ts:41:       export class ComposerFailure ...
composer/useVoiceRecorder.ts:46:       export const fork = ...
composer/useVoiceRecorder.ts:51:       export const stopTimer = ...
composer/useVoiceRecorder.ts:55:       export interface VoiceRecorderController {
composer/useVoiceRecorder.ts:77:       export function useVoiceRecorder({
composer/useComposerAttachments.ts:29: export interface ComposerAttachments {
composer/useComposerAttachments.ts:46: export function useComposerAttachments({
composer/useMentions.ts:24:            export interface Mentions {
composer/useMentions.ts:42:            export function useMentions({
composer/ComposerControls.tsx:17:       export interface ComposerEditor {
composer/ComposerControls.tsx:31:       export function ComposerControls({
```

The only export of the old file, `Composer` (a function value), is preserved with
the same name and kind. The new files export their own hook/component APIs; no
other module imported them before, and none does now.

### Commands run (real results)

- `pnpm install` — done, 15 workspace projects; only the pre-existing deprecated
  `uuid@7.0.3` and a `@types/react-dom` peer warning.
- `pnpm --filter @zilar/web build` — success (`✓ built in 951ms`); only the
  pre-existing ">500 kB chunk" warning.
- `pnpm gate` — `GATE PASS`:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (0.5s)
PASS  lint  (0.4s)
PASS  typecheck  (2.7s)
PASS  effect  (0.7s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

- Single test files run: none. `apps/web` has no composer tests and the gate's
  nearest-test step skipped the package ("no nearby test files"). Per AGENTS.md,
  UI code gets no tests.

### Deviations from the spec (split rules)

1. **Rule 4, `useVoiceRecorder` over 400.** With the plan's voice ranges
   (`useVoiceRecorder.ts` = constants/PressState/fork/timers + the lifecycle
   effects + all handlers) the hook came to ~426 lines. Rule 4 says to split it
   once more and report it, but the Allowed files name no fifth file. So the
   barrel `Composer.tsx` keeps the five voice lifecycle effects — the unmount
   cancel, the chat-switch cancel, the elapsed-time tick, the document Escape
   backstop, and the document pointer listeners (with the local `onMicPointerUp`
   release handler). `useVoiceRecorder` returns the refs/setters those effects
   need. This is the only place I moved code to the barrel instead of a named
   hook.
2. **`onComposerKeyDown` stays in the barrel.** It is cross-cutting (recording,
   mentions, attachment, edit, reply, send), so moving it whole into
   `useMentions` would have forced the mentions hook to depend on voice and
   attachments. Instead the mention-only key handling (picker navigation,
   Escape-close, and backspace-over-a-mention) moved into
   `useMentions.onMentionKeyDown`; the barrel calls it first and then runs the
   rest. The two key sets are disjoint (arrows/Enter/Tab/Escape-when-picker vs
   Backspace), so behaviour is unchanged.
3. The textarea auto-resize effect lives in `ComposerControls.tsx` (next to the
   textarea it sizes) rather than the barrel, to keep the barrel under 400 lines.

No `// effect-plain:` marker was needed; the gate's effect step passed.

### Problems hit and fixed

- First `pnpm gate` failed at `lint`:
  `react(refs)` flagged the two render-time ref writes
  (`chatIdRef.current = chatId`, `replyRef.current = replyTo`) and
  `react-hooks(exhaustive-deps)` flagged the stable values destructured from the
  hook returns. Fixed by writing those refs from a `useEffect`
  (`[chatId, replyTo]`) and adding the stable hook-returned setters/refs to the
  effect dependency arrays. Second gate: `GATE PASS`.

### Security checklist

This is an internal UI refactor: no secrets, no deletes/updates, no routes, no
caps, no audit entries. Nothing on the checklist applies. No dependency was
added; no check, test or lint rule was disabled (the single
`eslint-disable-next-line react-hooks/exhaustive-deps` on the document pointer
listener is the one that existed on `main`, kept verbatim).

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The split:** `Composer.tsx` (1,145 lines) is now 394 lines, plus `composer/useVoiceRecorder.ts` (390), `ComposerControls.tsx` (284), `useComposerAttachments.ts` (253) and `useMentions.ts` (190).
- **The lead checked `?mock=1` in Chrome:**
  - typing and the `@L` mention picker work (Luis @luis);
  - a sent message gets Dev-1's reply;
  - the Stickers, GIFs and Emoji panel opens.

  The attach and voice buttons were not tried: they open a native file dialog or need the microphone.
- **Check:** the gate passed, and so did the web build.

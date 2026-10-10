---
id: T-0997
title: "Size split T51: apps/mobile/src/components/chat/voice-message.tsx (631 lines) into chat/{voice-playback-source,use-voice-transcribe,voice-message-bars}; one TranscriptToggle"
status: merged
milestone: M5
branch: task/T-0997-split-mobile-voice-message
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-0997: Split the mobile voice message

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/components/chat/voice-message.tsx` is 631 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #47 (task T51): `components/chat/voice-playback-source.ts`, `chat/use-voice-transcribe.ts`, `chat/voice-message-bars.tsx`, under `apps/mobile/src/`. `voice-message.tsx` keeps the component and every export it has today.

The in-file Dedup is in scope: the two identical "Aa" transcript toggles become one `TranscriptToggle`.

The lead runs a phone smoke of a chat in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #47, and `apps/mobile/src/components/chat/voice-message.tsx`.

### Allowed files
`apps/mobile/src/components/chat/voice-message.tsx`, `apps/mobile/src/components/chat/voice-playback-source.ts`, `apps/mobile/src/components/chat/use-voice-transcribe.ts`, `apps/mobile/src/components/chat/voice-message-bars.tsx`, `work/T-0997-split-mobile-voice-message.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/mobile/src/components/chat/voice-message.tsx` (631 lines on main) into
the three files the plan names, moving code unchanged and keeping the barrel's
exports. No behaviour change; the only importer,
`apps/mobile/src/components/chat/message-bubble-content.tsx:20` (imports
`VoiceMessage`), is unchanged.

- `voice-playback-source.ts` — `resolvePlaySourceEffect`, `resolvePlaySource`,
  `sampleBars`, `resolved`, `isPromiseLike`, and the `BAR_COUNT` /
  `VOICE_MIN_WIDTH` constants (old 51–107).
- `use-voice-transcribe.ts` — the `useVoiceTranscribe` hook: the transcription
  state, the stored-transcript read effect, `showTranscribe`, and
  `runTranscribe` / `startTranscribe` / `confirmTranscribe` (old 158–191,
  249–390).
- `voice-message-bars.tsx` — the waveform + transport UI: `VoiceMessageBars`
  and `VoiceMessageFailedBars` (old 421–577).
- `voice-message.tsx` — keeps the `VoiceMessage` component (props unchanged),
  the playback subscription and `toggle`; it starts the transcribe hook and
  renders the bars plus the upload / error / transcript rows and the confirm
  sheet.

**Dedup (in scope):** the two identical "Aa" transcript toggles (old 529–547 and
560–576) are now one `TranscriptToggle` (`voice-message-bars.tsx:22`), rendered
from both spots. Its `key` still changes with the look, so the RN 0.86 Android
gradient-swap pitfall is untouched.

### Sizes (`wc -l`)

| file | lines |
| --- | --- |
| `apps/mobile/src/components/chat/voice-message.tsx` (old, main) | 631 |
| `apps/mobile/src/components/chat/voice-message.tsx` (new barrel) | 283 |
| `apps/mobile/src/components/chat/voice-playback-source.ts` | 62 |
| `apps/mobile/src/components/chat/use-voice-transcribe.ts` | 252 |
| `apps/mobile/src/components/chat/voice-message-bars.tsx` | 221 |

Every file is under 400 lines.

### Exports before / after (`grep -nE "^export"`)

Old `voice-message.tsx` (631):

```
61:export function resolvePlaySourceEffect(
84:export function resolvePlaySource(
136:export function VoiceMessage({
```

After — barrel:

```
apps/mobile/src/components/chat/voice-message.tsx
  30:export { resolvePlaySource, resolvePlaySourceEffect } from './voice-playback-source';
  59:export function VoiceMessage({
```

After — new files:

```
apps/mobile/src/components/chat/voice-playback-source.ts
   6:export const BAR_COUNT = 24;
   8:export const VOICE_MIN_WIDTH = 236;
  16:export function resolvePlaySourceEffect(
  39:export function resolvePlaySource(
  49:export const resolved = (): Promise<void> => Effect.runPromise(Effect.void);
  51:export const isPromiseLike = (value: unknown): value is PromiseLike<void> =>
  54:export function sampleBars(waveform: readonly number[], count: number): number[]:

apps/mobile/src/components/chat/use-voice-transcribe.ts
  21:export type VoiceTranscribeState = {
  41:export function useVoiceTranscribe(input: {

apps/mobile/src/components/chat/voice-message-bars.tsx
  22:export function TranscriptToggle({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  42:export function VoiceMessageFailedBars({
 101:export function VoiceMessageBars({
```

The three old public names keep their names and kinds: `VoiceMessage` is still
defined in the barrel; `resolvePlaySourceEffect` and `resolvePlaySource` are
re-exported from `voice-playback-source.ts`. The other new exports are new
internal APIs that no module imported before.

### Effect ratchet

No `// effect-plain:` marker was added. `voice-message.tsx`,
`voice-playback-source.ts` and `use-voice-transcribe.ts` import `effect` as a
value, so the map classifies them `effect`; `voice-message-bars.tsx` carries no
Effect signal and classifies `plain`. The gate's `PASS effect` confirms no new
or regressed `needs-effect` file.

### Commands run (real results)

- `pnpm install` — done in 21.4s; only the pre-existing deprecated `uuid@7.0.3`
  and the pre-existing `@types/react-dom` peer warning.
- `pnpm --filter @zilar/mobile typecheck` — passed (`tsc --noEmit`, no output).
- `pnpm exec prettier --write` on the four changed source files — `use-voice-transcribe.ts`
  reformatted, the other three already clean.
- `pnpm gate` — `GATE PASS`:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (1.2s)
PASS  lint  (1.0s)
PASS  typecheck  (3.5s)
PASS  effect  (1.7s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

- Single test files run: **none**. `apps/mobile/src/components/chat/` has no
  tests, so the gate's nearest-test step skipped the package ("no nearby test
  files"). Per AGENTS.md UI code gets no tests.

### Deviations / open questions

- None. `whistle` is passed into `useVoiceTranscribe` so the injectable test
  seam on `VoiceMessageProps` still works; `transcripts` and `onSaveTranscript`
  flow through the same way.
- The transcribe button condition in `VoiceMessageBars` uses the hook's
  `showTranscribe` (already `whistleAvailable && !hasTranscript && playable`),
  which is logically identical to the old
  `transcriptText === undefined && voice.transcript === undefined && showTranscribe`.

### Round (fix finding 1)

- Fixed finding 1 (must-fix): the gradient-swap `key` no longer remounted at the
  toggle, because it sat on `TranscriptToggle`'s single root where React ignores
  it for identity. The key now sits on the two call sites
  (`voice-message-bars.tsx:203`, `:222`) — the same position as main, where it
  was on the `Pressable` beside its row siblings — so flipping the look mounts a
  fresh view. The component's doc comment records why callers key it.
- Finding 2 is a nit that is byte-identical on main and outside the lines this
  round changes, so it was left as-is (per the fix-round rule and PREREVIEW's
  own note).
- Tests added: none. The finding names no test; `chat/` has no test files and
  AGENTS.md gives UI code no tests, and a new test file would fall outside this
  task's Allowed files. The lead's phone smoke covers the remount.
- Gate: `pnpm gate` → `GATE PASS`:

  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (1.4s)
  PASS  lint  (0.6s)
  PASS  typecheck  (2.7s)
  PASS  effect  (0.4s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean after 1 auto round, with 1 nit.**
- **The split:** `voice-message.tsx` (631 lines) is now 283 lines, plus `voice-playback-source` (62), `use-voice-transcribe` (252) and `voice-message-bars` (230). One `TranscriptToggle` replaces the two copies; round 1 fixed its React key.
- **The nit:** a staleness guard reads a frozen snapshot. That predates the split; it is on main too.
- **The lead's phone smoke** (mock build, Ana's chat opened with `zilar://chat/ana@zilar.test`):
  - the 0:18 voice bubble renders with its waveform, 1x and Aa;
  - Aa shows the transcript "This one is my favourite, the bridge gives me chills." and turns into "Hide transcript".
- **Same as main:** Play is disabled and the speed button does nothing, because the mock has no audio. `controls?.cycleSpeed()` needs a loaded player (`voice-message.tsx:521` on main).
- **Check:** the gate passed.

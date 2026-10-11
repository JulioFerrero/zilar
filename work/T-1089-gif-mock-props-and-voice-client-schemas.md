---
id: T-1089
title: "Cleanup: delete the unused mobile GifSheet and GifPanel's mockItems prop; web and mobile clients decode voice transcription with the contract schemas"
status: merged
milestone: M5
branch: task/T-1089-gif-mock-props-and-voice-client-schemas
model: auto
effort: default
depends_on: [T-1085, T-1088]
estimate: 0.1 day
---

# T-1089: Two small leftovers from T-1085 and T-1088

## Spec (written by Claude, do not edit)

### Why
The lead read main (2026-10-11).

**1. Mobile GIF mock props (the T-1085 follow-up):**
- `apps/mobile/src/components/chat/gif-panel.tsx` still has the `mockItems` prop and its branches (`:44`, `:57`, `:60`, `:62`, `:80`, `:155`, `:175`, `:190`). Since T-1085, nothing passes it except `GifSheet` (`apps/mobile/src/components/chat/gif-panel-sheet.tsx:16`, `:42`, 47 lines).
- **`GifSheet` itself is unused.** It is only re-exported at `gif-panel.tsx:23`, and no file imports `GifSheet` or `gif-panel-sheet`. `GifPanel`'s live users are `emoji-sheet.tsx:12` and `composer-sheet.ts:8` (for `probeGifsAvailability`).

**2. Voice-transcription client decoders (the T-1088 follow-up):** T-1088 moved `EnabledStatus` and `TranscriptResult` into `@zilar/api-contract` (`packages/api-contract/src/voice-transcription.ts`), but the clients still declare their own copies:
- web `apps/web/src/lib/api/settings.ts:67-68` uses `struct({ enabled: Schema.Boolean })`, and `:71-72` uses `struct({ text: Schema.String })`;
- mobile `apps/mobile/src/lib/integrations-api.ts:34` has `const VoiceTranscriptionStatusSchema = struct({ enabled: Schema.Boolean })`.

`struct` (`packages/protocol/src/common.ts:15-23`) only makes the keys mutable.

### What to build
1. **Delete `apps/mobile/src/components/chat/gif-panel-sheet.tsx` and its re-export** at `gif-panel.tsx:23`. First `grep -rn` across `apps/mobile` for `GifSheet` and `gif-panel-sheet`; if anything uses them, keep the file and say so.
2. **In `gif-panel.tsx`,** remove the `mockItems` prop and every branch that reads it, so the panel always loads through its client. Keep every other behaviour.
3. **Decode with the contract schemas:** web `settings.ts` decodes with `EnabledStatus` and `TranscriptResult`, and mobile `integrations-api.ts` with `EnabledStatus`, all imported from `@zilar/api-contract`. Each file already imports from that package. Keep the public return types (`{ enabled: boolean }`, `{ text: string }`). If `request` needs the mutable `struct` form to type-check, keep the local copy for that call and say why in the Report.
4. **No tests.** No other files change, and every file stays under 400 lines.

### Read first
`AGENTS.md` and the files named above.

### Allowed files
`apps/mobile/src/components/chat/gif-panel.tsx`, `apps/mobile/src/components/chat/gif-panel-sheet.tsx`, `apps/web/src/lib/api/settings.ts`, `apps/mobile/src/lib/integrations-api.ts`, `work/T-1089-gif-mock-props-and-voice-client-schemas.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.

---

## Report (written by the worker when done)

### What I did

**1. Deleted the unused mobile `GifSheet`.**
`grep -rn 'GifSheet|gif-panel-sheet'` across `apps/mobile` found only the two self-references: the re-export at `gif-panel.tsx:23` and the `gif-panel-sheet.tsx` file itself. No other file imports either. Deleted `apps/mobile/src/components/chat/gif-panel-sheet.tsx` and removed the re-export. `GifPanel`'s live users (`emoji-sheet.tsx:12`, `composer-sheet.ts:8`) are untouched.

**2. Removed the `mockItems` prop from `gif-panel.tsx`.**
Dropped `mockItems` from `GifPanelProps` and the destructured parameters; the panel now always loads through its client:
- `items` starts `[]`, `loading` starts `true`;
- removed the early `return` in `load` and the `mockItems` dependency (now `[client]`);
- unwrapped the effect branch so the first page always fires, with deps `[open, load]`.

Every other behaviour (debounce, abort, infinite scroll, empty/error/rate-limited states) is unchanged.

**3. Clients decode with the contract schemas.**
- web `apps/web/src/lib/api/settings.ts`: `getVoiceTranscriptionStatus` decodes with `EnabledStatus`, `getVoiceTranscript` with `TranscriptResult`, both imported from `@zilar/api-contract`. Public return types stay `{ enabled: boolean }` / `{ text: string }`.
- mobile `apps/mobile/src/lib/integrations-api.ts`: `EnabledStatus` imported from `@zilar/api-contract`, the local `VoiceTranscriptionStatusSchema` const deleted, and `getVoiceTranscriptionStatus` passes `EnabledStatus` to `voiceRequest`. Interface return type stays `Promise<{ enabled: boolean }>`.

No mutable `struct` copy was needed: `request<T>` (web) and `voiceRequest<T>` (mobile) take a `Schema.Codec<T, unknown>`, and a `Schema.Struct`'s readonly output type is assignable to the mutable `{ enabled: boolean }` / `{ text: string }` signatures. Typecheck confirms this. The remaining `struct`/`Schema` imports in both files are still used by the `{ ok: boolean }` and other schemas.

### Files changed

- `apps/mobile/src/components/chat/gif-panel.tsx` (modified)
- `apps/mobile/src/components/chat/gif-panel-sheet.tsx` (deleted, 47 lines)
- `apps/mobile/src/lib/integrations-api.ts` (modified)
- `apps/web/src/lib/api/settings.ts` (modified)
- `work/T-1089-...md` (this file)

All four code files are well under 400 lines.

### Commands and results

- `pnpm install`: done, "Done in 10.2s".
- `pnpm gate` (from repo root):
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (1.3s)
  PASS  lint  (0.8s)
  PASS  typecheck  (4.8s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/mobile  (1.5s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- No single test files were run separately: the spec says "No tests", and the touched files are UI/client code (the gate's nearest-test run for `@zilar/mobile` passed; `@zilar/web` had no nearby tests).

### Notes / deviations

- None. Spec followed as written.
- `git status --porcelain` shows only the five files above (four allowed code files plus this task file).

### Blocked / needs a decision

None.

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The change:**
  - deleted the unused mobile `gif-panel-sheet.tsx` (`GifSheet`, 47 lines) and its re-export;
  - removed `GifPanel`'s `mockItems` prop and its branches;
  - web `settings.ts` decodes voice transcription with the contract's `EnabledStatus` and `TranscriptResult`, and mobile `integrations-api.ts` with `EnabledStatus`.
- **No new smoke:** since T-1085, nothing passed `mockItems`, so the GIF panel already ran the remaining branch, the one the T-1085 phone smoke saw list results.
- **Check:** the gate passed, including typecheck on both apps and the `@zilar/mobile` tests.

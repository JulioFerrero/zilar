---
id: T-1089
title: "Cleanup: delete the unused mobile GifSheet and GifPanel's mockItems prop; web and mobile clients decode voice transcription with the contract schemas"
status: todo
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

## Review (written by Claude)

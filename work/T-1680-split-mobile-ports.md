---
id: T-1680
title: "Size split of apps/mobile/src/store/effects/ports.ts (393 lines): move the outgoing-media helpers (voicePortFor, pickedImageSize, bytesFor, voiceOutFor) into a new effects/ports-media.ts that resolvePorts imports — a pure move"
status: merged
milestone: M5
branch: task/T-1680-split-mobile-ports
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1680: Split the media helpers out of the phone store ports

## Spec (written by Claude, do not edit)

### Why
`apps/mobile/src/store/effects/ports.ts` is 393 of 400 lines, so the next port change can't land. The outgoing-media helpers are a self-contained block, used only by `resolvePorts`.

### Facts (the lead read them on 2026-10-16)
- **`ports.ts`:**
  - `AppStateLike :33`, `RealStoreDeps :38`, `PortsShape :80`, `class Ports :120`, `visibilityFor :131`, `onBackground :147` and `createMobileXmpp :179`;
  - **the block to move**, from the comment `// The voice pipeline (T-0154): …` (about `:204`) through `voicePortFor :207`, `pickedImageSize :222`, `bytesFor :242` and `voiceOutFor :294` to just before `export function resolvePorts :307`;
  - then `resolvePorts`, `PortsLive :350`, `unavailable :354` and `PortsTest :362`.
- **The imports at the top** include `OutgoingBytes` and `VoiceOut` from `@zilar/client-core/store`, `PickedFile`/`AttachmentUploader` from `../../lib/attachment-ports`, `attachmentDataFor`/`classifyMobileFile` from `../../lib/attachments`, and the voice helpers from `../../lib/voice`.
- **The folder `apps/mobile/src/store/effects/`** has no `ports-media.ts`.

### Steps
1. **Create `apps/mobile/src/store/effects/ports-media.ts`** and move the four functions **word for word** with their comments.
   - Export `voicePortFor`, `bytesFor` and `voiceOutFor` (and `pickedImageSize` only if `ports.ts` still needs it).
   - Import `RealStoreDeps` as a type from `./ports`; keep it a type-only import, so there's no value cycle.
   - Move only the imports the block needs.
2. **`ports.ts`** imports the helpers from `./ports-media`, and drops imports it no longer uses.
3. **No behaviour change, no new tests.**

### Allowed files
- `apps/mobile/src/store/effects/ports-media.ts`
- `apps/mobile/src/store/effects/ports.ts`
- `work/T-1680-split-mobile-ports.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **`ports.ts` is about 290 lines,** and `ports-media.ts` holds the four functions unchanged.
- **The mobile typecheck and tests pass.**

---

## Report (written by the worker when done)

### What I did
- Created `apps/mobile/src/store/effects/ports-media.ts` (117 lines) and moved the outgoing-media
  helpers word for word with their comments, in their original order: `voicePortFor`,
  `pickedImageSize`, `bytesFor`, `voiceOutFor`.
- Exported `voicePortFor`, `bytesFor` and `voiceOutFor`; kept `pickedImageSize` private (only
  `bytesFor` inside `ports-media.ts` uses it, `ports.ts` does not).
- `ports-media.ts` imports `RealStoreDeps` with a type-only import from `./ports`, and carries
  only the imports the block needs: `Effect` (effect), `OutgoingBytes`/`VoiceOut` types
  (`@zilar/client-core/store`), `API_URL`, `getSessionToken`, `PickedFile`, `attachmentDataFor`/
  `classifyMobileFile`, and `createVoicePort`/`VoiceError`/`ConvertedVoice`/`RecordedVoice`/
  `VoicePort` from `../../lib/voice`.
- `ports.ts` now imports `bytesFor` and `voiceOutFor` from `./ports-media`, and dropped the imports
  it no longer uses: `Effect`, `PickedFile`, `attachmentDataFor`/`classifyMobileFile`,
  `createVoicePort`/`VoiceError`/`ConvertedVoice`/`RecordedVoice`. It keeps `type { VoicePort }`
  (still used by `RealStoreDeps.voice`).
- No behaviour change, no new tests.

### Files changed
- `apps/mobile/src/store/effects/ports-media.ts` (new)
- `apps/mobile/src/store/effects/ports.ts` (now 285 lines, was 393)
- `work/T-1680-split-mobile-ports.md` (this report)

### Checks run
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/effects/send.test.ts`:
  1 file passed, 3 tests passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/real-store.send.test.ts`:
  1 file passed, 5 tests passed.
- `pnpm gate` from the repo root:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (1.3s)
  PASS  lint  (1.4s)
  PASS  typecheck  (4.2s)
  PASS  effect  (1.1s)
  PASS  tests @zilar/mobile  (3.1s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- `voicePortFor` is exported as the spec asked, but after the move only `voiceOutFor` (inside
  `ports-media.ts`) calls it; `ports.ts` imports just `bytesFor` and `voiceOutFor`. No lint
  error for the extra export.
- The `RealStoreDeps` ↔ `ports-media` edge is type-only, so there is no runtime import cycle.

### Blocked / needs a decision
None.

## Review (written by Claude)

**Approved and merged.** A pure size split.

- **Pre-review:** clean, 0 nits.
- **The lead's check:** the removed lines equal `ports-media.ts` exactly (diff after stripping imports and `export`).
- **Result:** `ports.ts` drops from 393 to 285 lines. The `RealStoreDeps` edge is type-only.

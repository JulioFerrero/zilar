---
id: T-2199
title: "Types declared twice with the same fields become one type (voice files, stored server images, group AI input, profile fields, composer mentions); no behaviour change"
status: merged
milestone: M5
branch: task/T-2199-type-twins
model: deepseek/deepseek-flash
effort: default
estimate: 25 min
---

# T-2199: One type per shape

## Spec (written by Claude, do not edit)

### Why
Each group below declares the same fields two or three times. A reader has to check that they really are the same. One declaration, plus a one-line alias where the second name says something useful, is shorter and clearer.

### Facts (the lead read these on 2026-10-19)
1. **Voice.** These three types are the same `{ uri; mimeType; size; durationMs }`:
   - `apps/mobile/src/lib/voice.ts:50-55` `RecordedVoice`;
   - `apps/mobile/src/lib/voice.ts:82-87` `ConvertedVoice`;
   - `apps/mobile/src/lib/voice-recorder.ts:14-19` `FinishedRecording`.
2. **Stored server images.** These three are the same `{ bytes: Uint8Array; mime: 'image/webp' | 'image/png'; size: number }`:
   - `apps/server/src/avatars/read.ts:10-14` `AvatarFile`;
   - `apps/server/src/backgrounds/service.ts:189-193` `BackgroundFile`;
   - `apps/server/src/stickers/storage.ts:340-344` `StickerFile`.
3. **Group AI input.** `apps/server/src/groups/schemas.ts:117-123` `AddGroupAiInput` and `:125-131` `RemoveGroupAiInput` have the same five fields.
4. **Profile fields.** `apps/mobile/src/app/settings/profile.tsx:63-68` `BioFieldProps` and `:100-105` `NameFieldProps` have the same four fields.
5. **Composer mentions.** In `apps/mobile/src/components/chat/composer-mentions.ts`, `PickedMention` (`:105`) and `BackspaceMention` (`:131`) have the same `{ text; caret; state }`.

### Steps
1. In each group, keep the first declaration.
2. Each other name becomes `type X = First` on one line, or uses the first name directly when the second name adds nothing. Import across files as needed. For group 2, `BackgroundFile` and `StickerFile` take `AvatarFile` from `apps/server/src/avatars/read.ts`.
3. Add no re-export lines (`export { … } from`). Change no runtime code.
4. Report the line counts per file.

### Allowed files
- `apps/mobile/src/lib/voice.ts`
- `apps/mobile/src/lib/voice-recorder.ts`
- `apps/server/src/avatars/read.ts`
- `apps/server/src/backgrounds/service.ts`
- `apps/server/src/stickers/storage.ts`
- `apps/server/src/groups/schemas.ts`
- `apps/mobile/src/app/settings/profile.tsx`
- `apps/mobile/src/components/chat/composer-mentions.ts`
- `work/T-2199-type-twins.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Types only: no runtime change.
- Product lines are at least 25 lower.

---

## Report (written by the worker when done)

### What I did

Replaced each duplicate declaration with a one-line alias to the first type of its group; no runtime code changed.

- Voice: `RecordedVoice` kept; `ConvertedVoice` and `FinishedRecording` now alias it.
- Stored server images: `AvatarFile` kept; `BackgroundFile` and `StickerFile` now alias it.
- Group AI input: `AddGroupAiInput` kept; `RemoveGroupAiInput` aliases it.
- Profile fields: `BioFieldProps` kept; `NameFieldProps` aliases it.
- Composer mentions: `PickedMention` kept; `BackspaceMention` aliases it.

### Files changed (git numstat, product files only)

```text
1	6	apps/mobile/src/app/settings/profile.tsx
1	5	apps/mobile/src/components/chat/composer-mentions.ts
2	6	apps/mobile/src/lib/voice-recorder.ts
1	6	apps/mobile/src/lib/voice.ts
2	5	apps/server/src/backgrounds/service.ts
1	7	apps/server/src/groups/schemas.ts
2	6	apps/server/src/stickers/storage.ts
```

Product lines: 10 added, 41 removed, net 31 lower (acceptance asks at least 25 lower). No re-export lines were added.

### Commands run and results

- `pnpm install --reporter=silent`: completed with no output/errors.
- `pnpm gate`: `GATE PASS`.
  ```text
  PASS  install (frozen)  (1.8s)
  PASS  format  (0.7s)
  PASS  lint  (1.1s)
  PASS  typecheck  (5.9s)
  PASS  effect  (1.1s)
  PASS  build @zilar/server  (0.5s)
  PASS  tests @zilar/mobile  (3.7s)
  PASS  tests @zilar/server  (24.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: no changed source file is over 800 lines
  comments: no task IDs in added comments
  GATE PASS
  ```

I ran no single test files separately; the only tests run were the mobile and server package tests inside `pnpm gate`, both passing.

### Problems

None.

### Deviations from the spec

None.

### Open questions

None.

## Review (written by Claude)

Approved; the pre-review was clean (0 findings). Net −31, types only, and no re-export lines.

Each twin now has one declaration, and each second name is a one-line alias:
- voice: `RecordedVoice`;
- stored server images: `AvatarFile`;
- group AI input: `AddGroupAiInput`;
- profile fields: `BioFieldProps`;
- composer mentions: `PickedMention`.

---
id: T-0802
title: "R4: mobile pure parses through chat-core helpers, tool-actions JSON.parse to Schema, and markers for the native probe, the dev whistle screen and the pitfalls scan tool"
status: todo
milestone: M5
branch: task/T-0802-mobile-r4-parse-markers
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0802: R4: mobile pure parses through chat-core helpers, tool-actions JSON.parse to Schema, and markers for the native probe, the dev whistle screen and the pitfalls scan tool

## Spec (written by Claude, do not edit)

### Why
This is part of `docs/audit/effect-100-plan.md`, accepted by Julio on 2026-10-09. It runs in **wave 1** of the batch mode Julio chose on 2026-10-09: the lead checks the whole wave once and sends every failure back. Plan row R4, line 314.

### Verified facts (do not re-derive)
- **The files, with their first hit** (plan appendix, lines 870-1121):
  - `apps/mobile/modules/zilar-whistle/src/ZilarWhistleModule.ts:28` (34 lines, a weak try/catch): the native probe, so give it a **marker**;
  - `apps/mobile/src/app/dev/whistle.tsx:65` (297 lines, async at 65, try at 67, a timer at 141): the dev-only screen, so give it a **marker**;
  - `apps/mobile/src/lib/native-pitfalls-scan.ts:1` (87 lines, a `node:` import): the scan tool, so give it a **marker**;
  - `apps/mobile/src/components/ais/tool-actions.ts:46` (try at 46, `JSON.parse` at 47): use a Schema decode, `Schema.decodeUnknownOption(Schema.UnknownFromJsonString)` or the 4.0.2 equivalent; check `node_modules/effect/dist/Schema.d.ts`;
  - `apps/mobile/src/components/chat/attachment-body.tsx:133`, `apps/mobile/src/components/settings/profile-logic.ts:216`, `apps/mobile/src/lib/attachments.ts:99`, `apps/mobile/src/lib/gifs.ts:118`, `apps/mobile/src/lib/markdown.ts:67`, `apps/mobile/src/lib/topics.ts:317`: each is a `try { new URL(x) } catch` or `decodeURIComponent` pure parse (plan line 80). Use `parseUrl` or `safeDecode` from `@zilar/chat-core` (`packages/chat-core/src/url.ts`, T-0765). Read each site; if one is not a pure parse, convert it with `Effect.try` and say so.
- **The marker** is `// effect-plain: <reason>` within the first 15 lines; see `apps/server/src/sandbox/ip-guard.ts:1`. The budget is 25 markers and 8 are used.
- **Whether mobile depends on `@zilar/chat-core`:** check `apps/mobile/package.json`. If it does not, add the dependency (`"@zilar/chat-core": "workspace:*"`) and run `pnpm install`; `package.json` and `pnpm-lock.yaml` are then in your Allowed files.

### What to build
Apply each change above. Behaviour must not change: for each parse, the same inputs give the same result.

Follow `docs/EFFECT_BRIEF.md` (the wave rules, the building blocks and the traps).

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, `packages/chat-core/src/url.ts`, the listed files and their tests.

### Allowed files
`apps/mobile/modules/zilar-whistle/src/ZilarWhistleModule.ts`, `apps/mobile/src/app/dev/whistle.tsx`, `apps/mobile/src/lib/native-pitfalls-scan.ts`, `apps/mobile/src/components/ais/tool-actions.ts`, `apps/mobile/src/components/chat/attachment-body.tsx`, `apps/mobile/src/components/settings/profile-logic.ts`, `apps/mobile/src/lib/attachments.ts`, `apps/mobile/src/lib/gifs.ts`, `apps/mobile/src/lib/markdown.ts`, `apps/mobile/src/lib/topics.ts`, `apps/mobile/package.json`, `pnpm-lock.yaml`, `work/T-0802-mobile-r4-parse-markers.md`.

### Checks (wave mode: your own tests and your package typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/lib/attachments src/lib/gifs src/lib/markdown src/lib/topics src/components/ais src/components/chat/attachment-body src/components/settings
pnpm --filter @zilar/mobile typecheck
```
Run the tests 3 times when the code has timers or concurrency. Run `pnpm exec prettier --write` on your changed files before committing.

### Acceptance
- Each listed source file is `effect` (or carries a valid marker where the task says so) in `pnpm effect:map`.
- Exported names, signatures, texts and behaviour are unchanged, or each difference is listed in the Report.
- Existing tests pass unchanged; new tests pass; the package typecheck is clean.
- Only Allowed files change.

---

## Report (written by the worker when done)

## Review (written by Claude)

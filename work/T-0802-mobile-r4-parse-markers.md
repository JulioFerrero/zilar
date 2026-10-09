---
id: T-0802
title: "R4: mobile pure parses through chat-core helpers, tool-actions JSON.parse to Schema, and markers for the native probe, the dev whistle screen and the pitfalls scan tool"
status: merged
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

- `effect:map` kinds after the change:
  - `apps/mobile/modules/zilar-whistle/src/ZilarWhistleModule.ts`: exempt (marker: native module probe, null not error)
  - `apps/mobile/src/app/dev/whistle.tsx`: exempt (marker: hidden dev-only spike screen)
  - `apps/mobile/src/lib/native-pitfalls-scan.ts`: exempt (marker: dev-time scan tool)
  - `apps/mobile/src/components/ais/tool-actions.ts`: effect
  - `attachment-body.tsx`, `profile-logic.ts`, `lib/attachments.ts`, `lib/gifs.ts`, `lib/markdown.ts`, `lib/topics.ts`: plain (no signal left, see unsure)
- Sites:
  - `tool-actions.ts`: `JSON.parse` in try/catch became `Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))` on the trimmed text (a `const RunInputJson` at module level); `None` gives the same invalid-JSON line, `Some(value)` gives `input` as before.
  - `new URL` try/catch became `parseUrl` from `@zilar/chat-core` in every such site of the six files, not only the first hit: attachments.ts (3: `safeHttpUrl`, `trustedMediaHosts`, `isTrustedMediaUrl`), attachment-body.tsx (2: `isFileTrusted`, `viewableUrl`), profile-logic.ts (2: `avatarImageSource`), gifs.ts (2), markdown.ts (1: `safeMarkdownUrl`), topics.ts (2: `httpsTopicUrl`, `topicLinkText`).
  - No `decodeURIComponent` in these files, so `safeDecode` is not used.
  - Mobile already depends on `@zilar/chat-core`: `package.json` and `pnpm-lock.yaml` unchanged.
- Tests (run once; the touched code has no timers): `pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/lib/attachments src/lib/gifs src/lib/markdown src/lib/topics src/components/ais src/components/chat/attachment-body src/components/settings`: 27 files, 342 tests passed, 0 failed. Before-count not measured. No test file changed.
- `pnpm --filter @zilar/mobile typecheck`: exit 0.
- `pnpm effect:map`: exit 0; markers 11 of 25 (8 before, 3 added), not over budget.
- Behaviour differences: none. Each `parseUrl` returns `undefined` exactly where the old `catch` returned its fallback, and the checks run in the same order. `safeHttpUrl`, `isTrustedMediaUrl`, `viewableUrl` and `isFileTrusted` keep their return values for every input; `topicLinkText` keeps `''` for a URL with an empty hostname (`??` only falls back on null or undefined).
- Unsure: the Acceptance asks that the six parse-only files be `effect`. After the change they have no signal, so the map shows them `plain`, which the plan (section 1.2 and the R3 row) allows for pure helpers. I did not add an unused `effect` import to make them `effect`. If you want that, say so and I will add it in a fix round.

## Review (written by Claude)

**2026-10-09, lead (wave 1):** approved. The lead reviewed the Report. The wave 1 combined check (all 12 branches on one tree, by hand) passed the whole-repo typecheck and every package suite: web 1916, server 2279, mobile 2222, xmpp-core 245, runner 63, runner-tunnel 71, devtools 796 after the T-0799 fix, chat-core 174, protocol 174.
- Worker: Haiku 5.5. The parses go through `parseUrl`, `tool-actions` uses a Schema JSON decode, and 3 markers are added (11 of 25); the parse-only files are plain, which is accepted.

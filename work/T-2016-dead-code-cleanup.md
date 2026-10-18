---
id: T-2016
title: "Code reduction: delete the dead files and unused dependencies the T-2013 scan confirmed, and drop the mobile copy of the @xmpp/client type declarations in favour of xmpp-core's"
status: merged
milestone: M5
branch: task/T-2016-dead-code-cleanup
model: deepseek/deepseek-flash
effort: default
estimate: 30 min
---

# T-2016: Dead code clean-up

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: make the codebase smaller. The scan `docs/audit/reduce-scan.md` (T-2013, knip 6.42.0 and jscpd 5.4.1) found files nothing imports, dependencies nothing uses, and one 97-line verbatim copy. This task removes the safe ones.

### Facts (from `docs/audit/reduce-scan.md` §1 and §2, read by the lead on 2026-10-18)
- **Dead files (174 lines in total):**

  | File | Lines | What it is |
  | --- | ---: | --- |
  | `apps/mobile/src/lib/whistle-last-voice.ts` | 18 | re-export shim |
  | `apps/web/src/components/ais/templates.ts` | 8 | re-export |
  | `apps/server/src/effect/logger.ts` | 93 | |
  | `apps/server/src/effect/runtime.ts` | 40 | |
  | `apps/server/src/voice-transcription/schemas.ts` | 11 | re-export |
  | `apps/server/src/xmpp/routes.ts` | 4 | re-export |

- **A dev tool with no script that runs it:** `apps/mobile/src/lib/native-pitfalls-scan.ts` (88 lines). Its header says it "never runs in the app".
- **Dependencies that look unused:**
  - `packages/mock-backend`: `@zilar/chat-core`;
  - `apps/server`: `@xmpp/client` (only comments and ambient types mention it);
  - `packages/client-core` dev dependencies: `@testing-library/dom`, `@testing-library/react`, `@types/react-dom`, `react-dom`.
- **Do not remove** `apps/server`'s `ws`: `@xmpp/component` may need it at runtime.
- **A verbatim copy (jscpd cluster 1, 97 lines):** `apps/mobile/src/types/xmpp.d.ts:6-102` copies `packages/xmpp-core/src/types/xmpp.d.ts:4-104`, the ambient `@xmpp/client` declarations.

### Steps
1. **Check, then delete.** Before deleting each file, `git grep` its path and its exported names across the repo, including tests, scripts, `package.json` files and configs. Delete it only if nothing uses it, and list what you checked in the Report.
2. **`native-pitfalls-scan.ts`.** Delete it only if `git grep native-pitfalls` finds no script, doc or `package.json` that runs it. Otherwise keep it and say why.
3. **Dependencies.** For each one, run `git grep` for the package name in the matching package (source, tests and configs). If nothing references it, remove it from that `package.json` and run `pnpm install` so the lockfile updates.
4. **The xmpp types.** Delete the mobile copy only if the mobile typecheck still passes without it, for example because `@zilar/xmpp-core` ships the declarations or mobile's `tsconfig` can include them. Otherwise make the mobile file a one-line `/// <reference path=…>` to the xmpp-core file, or keep it and explain.
5. **No behaviour change and no tests.** Every file stays at or under 400 lines.

### Allowed files
- `apps/mobile/src/lib/whistle-last-voice.ts`
- `apps/web/src/components/ais/templates.ts`
- `apps/server/src/effect/logger.ts`
- `apps/server/src/effect/runtime.ts`
- `apps/server/src/voice-transcription/schemas.ts`
- `apps/server/src/xmpp/routes.ts`
- `apps/mobile/src/lib/native-pitfalls-scan.ts`
- `apps/mobile/src/types/xmpp.d.ts`
- `apps/mobile/tsconfig.json`
- `packages/mock-backend/package.json`
- `apps/server/package.json`
- `packages/client-core/package.json`
- `pnpm-lock.yaml`
- `work/T-2016-dead-code-cleanup.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, including typecheck for every package.
- The Report lists each removal with the grep that proved it unused, and the lines removed.

---

## Report (written by the worker when done)

### What I did

Deleted the six files with no importer. For each, `git grep -n "<path>" -- ':!work' ':!docs'` returned no hits, and
`git grep -n "\b<exported name>\b" -- ':!work' ':!docs' ':!pnpm-lock.yaml'` found only the file itself (plus unrelated
same-named symbols where noted). Lines measured with `git show HEAD:<path> | awk 'END{print NR}'`.

| Deleted file | Lines | Grep evidence |
| --- | ---: | --- |
| `apps/mobile/src/lib/whistle-last-voice.ts` | 17 | Path: no hits. Exports (`downmixToMono`, `isSilentPcm`, `planWhistleChunks`, `planQuietCutChunks`, `quietestCut`, `resampleMonoTo16k`, `WHISTLE_*`, `WhistleChunk`): only the file and the real `apps/mobile/modules/zilar-whistle/src/chunks.ts`. |
| `apps/web/src/components/ais/templates.ts` | 7 | Path: no hits. Exports: only the file; the live copies are `packages/chat-core/src/ai-templates.ts` and mobile's own `@/components/ais/templates`. |
| `apps/server/src/effect/logger.ts` | 92 | Path: no hits. `makePinoLoggerLayer`: only the file. |
| `apps/server/src/effect/runtime.ts` | 39 | Path: no hits. `makeServerRuntime`/`ServerLayer`: only the file; the `ServerRuntime` hits are an unrelated same-named type in `packages/runner-tunnel`. |
| `apps/server/src/voice-transcription/schemas.ts` | 10 | Path: no hits. Re-exported names (`EnabledStatus`, `OkResult`, `TranscriptBody`, `TranscriptResult`, `VoiceSettingsBody`): importers use `@zilar/api-contract` directly. |
| `apps/server/src/xmpp/routes.ts` | 3 | Path: no hits. `TOKEN_RATE_LIMIT_MAX`/`TOKEN_RATE_LIMIT_WINDOW_MS`/`TOKEN_TTL_SECONDS`: only `apps/server/src/xmpp/api.ts` (the real definitions). |
| `apps/mobile/src/lib/native-pitfalls-scan.ts` | 87 | `git grep -n "native-pitfalls"` hits only `docs/audit/*` and older `work/*` reports, plus a comment in `apps/mobile/src/test/node-types.d.ts`. No `package.json`, `turbo.json` or script runs it; the `native-pitfalls.test.ts` that T-0194 mentions no longer exists in the tree. |

Source lines removed: 357.

Dependencies removed after `git grep` in each package (source, tests, configs, excluding `package.json`):

- `packages/mock-backend`: `@zilar/chat-core` — grep `@zilar/chat-core` in `packages/mock-backend`: no hits.
- `apps/server`: `@xmpp/client` — grep `@xmpp/client` in `apps/server`: only comments in `stop-types.ts`, `push/xmpp-component.d.ts`, `ai/catalog.ts`. Kept `ws` as instructed.
- `packages/client-core` dev dependencies: `@testing-library/dom`, `@testing-library/react`, `@types/react-dom`, `react-dom` — grep for those four strings in `packages/client-core`: no hits. `@zilar/chat-core` stays (used widely there).
- `pnpm install` after the edits updated `pnpm-lock.yaml` (18 deletions, only the five removed importers' entries).

`@xmpp/client` type declarations: deleted `apps/mobile/src/types/xmpp.d.ts` (102 lines) and added
`../../packages/xmpp-core/src/types/xmpp.d.ts` to `include` in `apps/mobile/tsconfig.json`, so mobile's
tsc program picks up xmpp-core's declaration directly (the solution the spec names as an example). I first tried the
one-line `/// <reference path=…>` form, but oxlint rejects triple-slash references
(`typescript(triple-slash-reference)`), so it cannot pass the gate.

No behaviour change and no tests added. The largest touched file is the 102-line deleted mobile declaration.

### Checks run

- `pnpm install` — initial install: done, 1299 packages resolved.
- `pnpm gate` (first run) — FAIL lint: `apps/mobile/src/types/xmpp.d.ts:1:1: error typescript(triple-slash-reference)`,
  all other stages passed.
- `pnpm install` after removing the dependencies — done; `pnpm-lock.yaml` changed by 18 deletions only.
- `pnpm gate` (second run) — summary:

```
gate: 14 changed file(s) against main
PASS  install (frozen)  (1.9s)
PASS  format  (1.0s)
PASS  lint  (1.1s)
PASS  typecheck  (13.6s)
SKIP effect (no source files changed)
SKIP tests @zilar/client-core (no nearby test files)
PASS  tests @zilar/mobile  (4.2s)
SKIP tests @zilar/mock-backend (no nearby test files)
PASS  tests @zilar/server  (8.5s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single test files were run separately; the gate ran the mobile and server suites it selected.

### Notes for the lead

- `apps/mobile/src/test/node-types.d.ts:2` has a stale comment naming the deleted
  `native-pitfalls-scan.ts`. It is outside the Allowed files, so I left it untouched; the shim itself is harmless.
- Measured line counts are one lower than the spec table for each file (e.g. `logger.ts` 92 vs 93). I used the
  measured values; the scan table likely counted a trailing blank line.
- `apps/mobile/src/types/` is now empty of this declaration; nothing else referenced it.


## Review (written by Claude)

Approved: a clean pre-review. It removes 382 lines and 6 unused dependencies:
- **Dead files:** 6 deleted, plus the retired `native-pitfalls-scan.ts`.
- **Mobile `xmpp.d.ts`:** the duplicate is gone, and mobile now uses xmpp-core's declarations through `tsconfig`.
- **Dependencies:** `@xmpp/client` is out of the server, `@zilar/chat-core` out of mock-backend, and the four unused client-core dev dependencies are gone.

Two stale comments, in the Kotlin whistle module and `node-types.d.ts`, are left for the next code-reduction slice.

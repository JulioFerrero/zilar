---
id: T-0829
title: "MU20: mobile chat sheets: group-roles, invite-links, invite, visibility-fields, visibility-sheet on Effect"
status: merged
milestone: M5
branch: task/T-0829-mobile-mu20
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0829 (MU20): mobile chat sheets: group-roles, invite-links, invite, visibility-fields, visibility-sheet on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task MU20), accepted by Julio on 2026-10-09. It runs in **wave 2** of the batch mode: the lead checks the whole wave once and sends every failure back.

### Verified facts (do not re-derive)
- **The files**, with each first non-Effect line from the plan appendix (re-read the file, because lines move):
  - `apps/mobile/src/components/chat/group-roles-sheet.tsx` (303 lines; first hit at line 72: async/await/Promise @72), tested in `group-roles-sheet.test.tsx`;
  - `apps/mobile/src/components/chat/invite-links-sheet.tsx` (363 lines; first hit at line 147: async/await/Promise @147; try/catch @154), tested in `invite-links-sheet.test.tsx`;
  - `apps/mobile/src/components/chat/invite-sheet.tsx` (185 lines; first hit at line 40: async/await/Promise @40; try/catch @78), tested in `invite-sheet.test.tsx`;
  - `apps/mobile/src/components/chat/visibility-fields.tsx` (335 lines; first hit at line 146: timer @146; async/await/Promise @151), tested in `visibility-fields.test.tsx`;
  - `apps/mobile/src/components/chat/visibility-sheet.tsx` (243 lines; first hit at line 113: timer @113; async/await/Promise @124), tested in `visibility-sheet.test.ts`;
- **The mobile Effect toolkit** (T-0800) is in `apps/mobile/src/lib/effect/`: `runtime.ts` (`runMobile`, `mobileAtomRuntime`), `errors.ts` (`ApiFailure`, `toApiFailure`), `api-effect.ts` (`fromApi`), `use-action.ts` and `use-query.ts`. They have the same API as the web hooks; read their header comments.
- **Mobile API modules** (`apps/mobile/src/lib/*-api.ts`) throw per-module errors with `status`, `code` and `message`; `fromApi` maps them to `ApiFailure`.
- **Native modules** (expo-*, react-native APIs) stay imported; their calls are wrapped with `Effect.tryPromise`, `Effect.try` or `Effect.callback`.
- **Expo inlines only a literal `process.env.EXPO_PUBLIC_*`.** Since R5 (T-0803), the mock env comes from `apps/mobile/src/mock/gate.ts`; if a file here still reads `process.env`, import from there when the constant exists, or leave the read (W7) and say so.

### What to build
Convert the listed files.

Use the rules in `docs/EFFECT_BRIEF.md` (Web UI applies to React Native too): `useAction` per row, store `Error` messages kept, the same texts and behaviour, timers as `Effect.sleep` or `Schedule` fibers interrupted on unmount, and permission prompts (microphone, camera, notifications) still started directly from the press handler.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, every file in `apps/mobile/src/lib/effect/`, the listed files and their tests.

### Allowed files
`apps/mobile/src/components/chat/group-roles-sheet.tsx`, `apps/mobile/src/components/chat/invite-links-sheet.tsx`, `apps/mobile/src/components/chat/invite-sheet.tsx`, `apps/mobile/src/components/chat/visibility-fields.tsx`, `apps/mobile/src/components/chat/visibility-sheet.tsx`, `work/T-0829-mobile-mu20.md`.

### Checks (wave mode: your own tests and the mobile typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/chat/group-roles-sheet src/components/chat/invite-links-sheet src/components/chat/invite-sheet src/components/chat/visibility-fields src/components/chat/visibility-sheet
pnpm --filter @zilar/mobile typecheck
```
Run `pnpm exec prettier --write` on your changed files before committing. Do not start the emulator or Metro; the lead runs `pnpm phone:smoke` for the wave.

### Acceptance
- Each listed file is `effect` in `pnpm effect:map`, or `plain` when no async work of its own is left (no added Effect import just for the label).
- The texts and behaviour are the same, or each difference is listed in the Report.
- Existing tests pass unchanged, new tests pass both before and after the conversion, and the mobile typecheck is clean.
- Only Allowed files change.

---

## Report (written by the worker when done)

- **effect:map kinds (after):** all five are `effect`, no signals left. Before: no Effect import and async/then/try signals, so `needs-effect` by the rule (not re-measured with the old code).
  - `group-roles-sheet.tsx`: effect
  - `invite-links-sheet.tsx`: effect
  - `invite-sheet.tsx`: effect
  - `visibility-fields.tsx`: effect
  - `visibility-sheet.tsx`: effect
- **Tests:** before 5 files, 40 passed. After 5 files, 40 passed, no test file touched. `visibility-fields` run 3 times: 12 passed each time (its timer test).
- **Typecheck:** `pnpm --filter @zilar/mobile typecheck` exit 0. Prettier run on the five files.
- **Pattern used:**
  - API calls (`onCreateRole`, `createInvite`, ...) through `fromApi` and `useAction` (`mode: 'replace'`).
  - `invite-sheet` request through `useQuery` on `[api, attempt]`; `failed` = failure and not waiting.
  - Copy and share bridge calls through `useAction`.
  - Timers (`visibility-fields` 300 ms debounce, `visibility-sheet` reset) through `Effect.runFork` + `Fiber.interrupt` in the effect cleanup.
- **Behaviour differences:**
  - A rejected store or bridge call (create, rename, delete, toggle, copy) was an unhandled rejection before; now it is a silent failure state. Nothing renders it, same as before for the user.
  - Share errors: ignored as before.
  - `mode: 'replace'`: a second tap starts at once. A superseded call still finishes in the store, but its local step (clear name, close rename/confirm, "Copied" flag) is skipped.
  - `invite-sheet` close or unmount now interrupts the request instead of ignoring its result. Same visible result.
  - `useHandleCheck` stays on `useState`/`useEffect`/`useRef` only, not `useAction`, because its test stubs only those hooks. Debounce, texts and rate-limit handling are unchanged.
  - Retry in `invite-sheet` now shows the loading line at once (same as before).
- **Unsure:**
  - The spec's line numbers did not match the files (e.g. `invite-links-sheet` had no async/await, only `.then`/`.catch`). I converted what the files contain.
  - No new tests added, since the Checks run only the existing five files. The conversion relies on those tests plus the typecheck.
  - Not run: `pnpm gate`, emulator, `pnpm phone:smoke` (wave mode).

## Review (written by Claude)

**2026-10-09, lead:** approved (wave 2). Worker: Haiku 5.5. The lead reviewed the Report.
- **Combined check:** all 25 wave 2 branches together pass lint, typecheck and the full mobile suite (`lead batch check`, report 20261009T172300Z). The remaining failures were server and web tests that pass on main, caused by load.
- **This task:** Roles, invite links and visibility sheets converted; no behaviour change reported.
- **Phone:** the wave branch is smoked on the emulator after the merge.

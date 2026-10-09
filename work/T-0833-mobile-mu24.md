---
id: T-0833
title: "MU24: mobile contacts: add-contact, blocks, people-search, requests, use-people-search on Effect"
status: merged
milestone: M5
branch: task/T-0833-mobile-mu24
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0833 (MU24): mobile contacts: add-contact, blocks, people-search, requests, use-people-search on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task MU24), accepted by Julio on 2026-10-09. It runs in **wave 2** of the batch mode: the lead checks the whole wave once and sends every failure back.

### Verified facts (do not re-derive)
- **The files**, with each first non-Effect line from the plan appendix (re-read the file, because lines move):
  - `apps/mobile/src/components/contacts/add-contact.ts` (120 lines; first hit at line 80: async/await/Promise @80), **no test** (write `apps/mobile/src/components/contacts/add-contact.test.ts` first);
  - `apps/mobile/src/components/contacts/blocks.ts` (81 lines; first hit at line 47: async/await/Promise @47; try/catch @52), tested in `blocks.test.ts`;
  - `apps/mobile/src/components/contacts/people-search.ts` (213 lines; first hit at line 61: timer @61; fetch/WebSocket @163; async/await/Promise @168), tested in `people-search.test.ts`;
  - `apps/mobile/src/components/contacts/requests.ts` (59 lines; first hit at line 39: async/await/Promise @39; try/catch @45), **no test** (write `apps/mobile/src/components/contacts/requests.test.ts` first);
  - `apps/mobile/src/components/contacts/use-people-search.ts` (176 lines; first hit at line 75: try/catch @75; async/await/Promise @113), **no test** (write `apps/mobile/src/components/contacts/use-people-search.test.ts` first);
- **The mobile Effect toolkit** (T-0800) is in `apps/mobile/src/lib/effect/`: `runtime.ts` (`runMobile`, `mobileAtomRuntime`), `errors.ts` (`ApiFailure`, `toApiFailure`), `api-effect.ts` (`fromApi`), `use-action.ts` and `use-query.ts`. They have the same API as the web hooks; read their header comments.
- **Mobile API modules** (`apps/mobile/src/lib/*-api.ts`) throw per-module errors with `status`, `code` and `message`; `fromApi` maps them to `ApiFailure`.
- **Native modules** (expo-*, react-native APIs) stay imported; their calls are wrapped with `Effect.tryPromise`, `Effect.try` or `Effect.callback`.
- **Expo inlines only a literal `process.env.EXPO_PUBLIC_*`.** Since R5 (T-0803), the mock env comes from `apps/mobile/src/mock/gate.ts`; if a file here still reads `process.env`, import from there when the constant exists, or leave the read (W7) and say so.

### What to build
1. **Tests first:** for each file marked "no test", write its test against the current code. Render it with the existing mocks the neighbouring tests use, and cover what it shows and its main actions' success and failure. A test for a screen under `src/app/` goes in `apps/mobile/src/components/screens/` (Expo Router makes every file in `src/app` a route) and imports the screen, the way `apps/mobile/src/components/stickers/stickers-screen.test.tsx` does. Commit them as "T-0833: tests before".
2. Convert the listed files.

Use the rules in `docs/EFFECT_BRIEF.md` (Web UI applies to React Native too): `useAction` per row, store `Error` messages kept, the same texts and behaviour, timers as `Effect.sleep` or `Schedule` fibers interrupted on unmount, and permission prompts (microphone, camera, notifications) still started directly from the press handler.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, every file in `apps/mobile/src/lib/effect/`, the listed files and their tests.

### Allowed files
`apps/mobile/src/components/contacts/add-contact.ts`, `apps/mobile/src/components/contacts/add-contact.test.ts`, `apps/mobile/src/components/contacts/blocks.ts`, `apps/mobile/src/components/contacts/people-search.ts`, `apps/mobile/src/components/contacts/requests.ts`, `apps/mobile/src/components/contacts/requests.test.ts`, `apps/mobile/src/components/contacts/use-people-search.ts`, `apps/mobile/src/components/contacts/use-people-search.test.ts`, `work/T-0833-mobile-mu24.md`.

### Checks (wave mode: your own tests and the mobile typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/contacts/add-contact src/components/contacts/blocks src/components/contacts/people-search src/components/contacts/requests src/components/contacts/use-people-search
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

- **effect:map kinds (after):** `add-contact.ts` effect (no signals); `blocks.ts` effect (W4 only, a false positive from `Effect.catch`); `requests.ts` effect (W4, same); `use-people-search.ts` effect (W4, same); `people-search.ts` effect with one H3 (tier B): the injected `this.frames.setTimeout(` seam call, which the existing tests drive with a manual clock, so it stays.
- **Tests before:** commit "T-0833: tests before" added 3 new files (add-contact.test.ts 17 tests, requests.test.ts 12, use-people-search.test.ts 12) and they passed on the unconverted code. Filtered run of the 5 contact folders: 72 passed (6 files, existing blocks/people-search included).
- **Tests after:** same filter, 72 passed, 3 runs in a row. Existing `blocks.test.ts` and `people-search.test.ts` unchanged.
- **Typecheck:** `pnpm --filter @zilar/mobile typecheck` exit 0. **Oxlint** on the 8 changed files: exit 0.
- **Exports:** every exported name keeps its signature and Promise return type; each now wraps an `*Effect` export (`actOnProfileRequestEffect`, `performRequestActionEffect`, `performBlockEffect`, `performUnblockEffect`) run with `Effect.runPromise`. Errors reach callers unchanged (runPromise rethrows the raw error).
- **Behaviour differences:**
  1. `people-search.ts` default clock: `Effect.sleep` in a fiber, cleared with `Fiber.interrupt` (was `setTimeout`/`clearTimeout`). The injected `SearchScheduler` seam is unchanged.
  2. `people-search.ts`: private method `fetch` renamed `runLookup` (internal; avoids a false H2 hit).
  3. `use-people-search.ts`: the shared action guard, busy state and error text are unchanged, but a thrown sync error inside a state setter now dies the fiber instead of setting `actionError`. Edge case only.
  4. None otherwise. Unmount still does not interrupt a running action (as before); the hook keeps one shared guard rather than `useAction`, because the actions share one busy flag.
- **Pre-existing bug, left as is (lead to decide):** `actOnProfileRequest` calls `onProfile(found)` then `onSentNone()`, and the hook's `onSentNone` is `controller.setFound(active, false)`. So after accept, decline or cancel the refreshed relation is overwritten with the pre-action profile and the card stays stale until the next lookup. This contradicts the comment in `add-contact.ts`. The new hook test does not assert the relation for this reason.
- **Unsure:** none on the API (checked in `node_modules/effect/dist/Effect.d.ts` and `internal/effect.js`). The default-clock fiber path is covered only through the hook test with a real 900 ms debounce.

## Review (written by Claude)

**2026-10-09, lead:** approved (wave 2). Worker: Haiku 5.5. The lead reviewed the Report.
- **Combined check:** all 25 wave 2 branches together pass lint, typecheck and the full mobile suite (`lead batch check`, report 20261009T172300Z). The remaining failures were server and web tests that pass on main, caused by load.
- **This task:** 41 new tests. Found an older bug, now a follow-up: after accept, decline or cancel the contact card shows the pre-action profile until the next lookup.
- **Phone:** the wave branch is smoked on the emulator after the merge.

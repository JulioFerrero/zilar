---
id: T-0848
title: "Mobile: the mock store, mock APIs and dev screens leave the release bundle"
status: merged
milestone: M5
branch: task/T-0848-mobile-mock-out-of-bundle
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0848: Mobile: the mock store, mock APIs and dev screens leave the release bundle

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Finding E-F3 in `docs/audit/simplify-2026-10-09/E-mobile.md`.
- **The imports:** `apps/mobile/src/store/chat-store-provider.tsx:19-20` imports `createChatStore` (the 1,595-line mock store) and `mock/gate`, and 16 files import `@/mock`. Each `use-X-api.ts` imports `createMockXApi` statically (for example `apps/mobile/src/components/ais/use-ais-api.ts:6`).
- **The gate:** `?mock=` is gated at run time by `__DEV__ || EXPO_PUBLIC_ZILAR_MOCK`, but the code is bundled either way.
- **The dev screens:** `apps/mobile/src/app/dev/kit.tsx` and `apps/mobile/src/app/dev/whistle.tsx` (574 lines) are file routes, so they are always bundled.
- **Size:** about 5.1k lines in the 13 MB Hermes bundle.

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Put every mock selection behind a constant that Metro folds in release builds. Read `apps/mobile/src/mock/gate.ts` and keep its dev and test behaviour; the env-flag build (`EXPO_PUBLIC_ZILAR_MOCK`) must still work. Load the mock modules with `require()` inside the branch, so release builds drop them.
2. Keep the dev screens out of release: make them render a redirect when `!__DEV__`, with no static import of the heavy parts, or another way Expo Router supports. Say which you chose.
3. **Measure:** run `npx expo export --platform android --output-dir <dir outside the repo, e.g. /private/tmp/claude-501/-Users-julio-personal-projects-galena/9686fd0a-230a-4af9-9695-0d5ca8d8e063/scratchpad/expo-t0848>` inside apps/mobile, before and after, and report the .hbc size.
4. The tests must pass unchanged.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`apps/mobile/src/store/chat-store-provider.tsx`, `apps/mobile/src/mock/**`, `apps/mobile/src/**/use-*-api.ts`, `apps/mobile/src/app/dev/**`, `apps/mobile/src/**/*.test.ts`, `apps/mobile/src/**/*.test.tsx`, `work/T-0848-mobile-mock-out-of-bundle.md`.

This task runs the whole mobile suite (16 s), because the mock touches many tests.

### Checks (wave mode)
```bash
pnpm --filter @zilar/mobile test --reporter=dot
pnpm --filter @zilar/mobile typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Every number the spec asks for (sizes, timings, counts) is in the Report, measured.
- Live check for Julio's single test: The phone smoke (lead) opens every screen with no crash.

---

## Report (written by the worker when done)

### What changed
- 13 `use-*-api.ts` hooks: the mock modules load by `require()` inside `if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK)`; release builds fold it to false and drop the modules. Scenario hooks use `import type` for the scenario types so no side-effect import is left. Env-flag builds keep the mock.
- `chat-store-provider.tsx`: `createMockStore()` requires `./chat-store` (the 1,595-line mock store) only when `NODE_ENV === 'test' || __DEV__ || EXPO_PUBLIC_ZILAR_MOCK`, then asks `isMockMode`.
- Dev screens: `dev/kit` is a thin route that requires `mock/dev-kit-screen.tsx` under `__DEV__`, else `<Redirect href="/" />`. `dev/whistle` is unchanged (fix round 1): it renders the real screen in all builds.

### Measured (npx expo export --platform android, .hbc)
- Before: 12,991,125 bytes. After: 12,818,688 bytes. Saved 172,437 bytes (1.3%).
- Kit catalog string gone from the bundle; chat-store strings 4 -> 1.

### Checks
- Mobile suite: 2760 passed, 2 skipped (296 files), 3 of 3 runs after the last commit. (One earlier run under load had 4 timeouts in 2 files; they pass alone.)
- typecheck clean; oxlint clean on changed files; prettier clean.

### Behaviour differences
- Release builds: `zilar://dev/kit` now redirects home. `dev/whistle` unchanged. Dev builds unchanged.
- Otherwise none.

### Not done / unsure
- Some mock data still ships: `app/chat/[id].tsx`, `app/(tabs)/index.tsx` and `components/chat/composer.tsx` statically import `@/mock/stickers|attachments|gifs|search`, and `mock/search.ts` imports `./index` (chats, messages). They are outside Allowed files, so the saving is only 1.3%. Making them lazy needs those files in scope. `store/chat-store.ts` still holds its own `isMockMode`; not touched.
- Hook bodies are not run in tests (screen tests mock the hooks), so the require path is verified by typecheck and the export only; the phone smoke should confirm.
- I used `git stash` once for a before/after check before the lead note; my tree was intact afterwards. `stash@{0}` belongs to the T-0862 worktree and I left it.

## Review (written by Claude)

**Lead, 2026-10-10: approved after fix round 1.**
- **What changed:** the mock APIs and store load through `require()` behind `__DEV__ || EXPO_PUBLIC_ZILAR_MOCK`, and the kit catalog is dev-only.
- **Fix round:** `zilar://dev/whistle` works in release again, as its header promises Julio.
- **Size:** Android bundle −172 kB (1.3%).
- **Still open:** the rest of the mock data comes in through static imports in 3 screens; that goes to T-0882.
- **Checks:** the combined check is clean and the phone smoke passes.

---
id: T-0882
title: "The last static mock imports leave the production bundles (mobile chat screen, chats tab, composer; web StickerPanel and AuthProvider)"
status: merged
milestone: M5
branch: task/T-0882-mock-imports-rest
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-0882: The last static mock imports leave the production bundles (mobile chat screen, chats tab, composer; web StickerPanel and AuthProvider)

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Follow-ups of T-0847 and T-0848; read both Reports in `work/`.
- **Mobile:** `apps/mobile/src/app/chat/[id].tsx`, `apps/mobile/src/app/(tabs)/index.tsx` and `apps/mobile/src/components/chat/composer.tsx` still statically import `@/mock/stickers`, `attachments`, `gifs` and `search`. `mock/search.ts` pulls in `mock/index` (the chats and messages fixtures).
- **Web:** `apps/web/src/components/StickerPanel.tsx` and `apps/web/src/auth/AuthProvider.tsx` still import `mock/helpers` and `mock/ids`.

Line numbers come from the audit and may have moved since: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
Apply the same gates T-0847 (web: a Vite build-time constant plus a dynamic import) and T-0848 (mobile: `require()` inside the `__DEV__ || EXPO_PUBLIC_ZILAR_MOCK` branch) used. Behaviour in dev, tests and mock mode stays the same.

Measure:
- **mobile:** the `.hbc` size, with `npx expo export --platform android --output-dir /private/tmp/claude-501/-Users-julio-personal-projects-galena/9686fd0a-230a-4af9-9695-0d5ca8d8e063/scratchpad/expo-t0882`;
- **web:** the main chunk size, with `pnpm --filter @zilar/web build`.

Both before and after.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), the audit section and task Reports cited above, and the files listed.

### Allowed files
`apps/mobile/src/app/chat/[id].tsx`, `apps/mobile/src/app/(tabs)/index.tsx`, `apps/mobile/src/components/chat/composer.tsx`, `apps/mobile/src/mock/**`, `apps/web/src/components/StickerPanel.tsx`, `apps/web/src/auth/AuthProvider.tsx`, `apps/web/src/mock/**`, `work/T-0882-mock-imports-rest.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/mobile test --reporter=dot
pnpm --filter @zilar/web test --reporter=dot
pnpm --filter @zilar/mobile typecheck
pnpm --filter @zilar/web typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit. The machine is shared, so note `uptime` next to any timing.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Lines removed (and every other number the spec asks for) are in the Report, measured.

---

## Report (written by the worker when done)

**Status: blocked.** The web part is done and green. The mobile part does not pass its tests, so I took it off this branch.

### Commits (branch task/T-0882-mock-imports-rest)
- `8d85387f`, `278f46c9`: web (`AuthProvider.tsx`, `StickerPanel.tsx`), net +19 / -2 lines. Mock branch folds out of a production build.
- Mobile: `f401b380`, `43938bfa` were reverted on this branch (`6e91a62e`, `7513559f`). The mobile change is kept on branch `task/T-0882-mobile-require-wip` (at `43938bfa`) for the lead to decide.

### Measured
- Web main chunk (`pnpm --filter @zilar/web build`): before 1,322,722 bytes (gzip 387.10 kB). After 1,321,534 bytes (-1,188 bytes, -0.09%). "Acme Announcements", "🐱 dancing" and "u-you" are gone from the chunk.
- Mobile `.hbc` (`npx expo export --platform android`): before 12,831,010 bytes. After 12,802,128 bytes (-28,882, -0.23%). Measured on `f401b380` (the `@/` version, before the path fix). Not re-measured after the relative-path fix. "mock-gif-1" and "Acme" are gone from the bundle.
- Load during runs: uptime load 75 to 230 (shared machine).

### Blocker (mobile)
- The spec's `require()` gate makes the test run (`NODE_ENV=test`) take the require path. Vitest's `require` is plain Node: it cannot load an extensionless `.ts` module, neither with the `@/` alias nor with a relative path. Plain `node -e "require('./src/mock/stickers')"` gives MODULE_NOT_FOUND too.
- Result: 46 failures (chat-id-screen, 1 more tabs-index), then 44 failures (`Cannot find module '../../mock/stickers'` / `'../../mock/search'`) in `chat-id-screen.test.tsx` and `tabs-index-screen.test.tsx`.
- Fixing it needs a test or vitest config change (outside Allowed files), or a different load path. Not done. Decision for the lead.
- Side finding: T-0848's `chat-store-provider.tsx` also does `require('./chat-store')` on the `NODE_ENV === 'test'` path. No test appears to run that path, so it passes today. It would fail the same way if one did.

### Checks (final branch state: web changes only, mobile tree = base 1ad69d83)
- Web tests: run 1 had 4 failures (AuthProvider.test mocks `@/mock/gate` without the new export; fixed by inlining the condition). Run 2: 1 failure, `Composer.voice.test.tsx` "Send voice message", which T-0847 already recorded as failing on its clean base. Run 3: 185 files, 1943 passed. Not 3 of 3 green.
- Mobile tests on final state: 296 files passed, 2 skipped; 2760 passed, 2 skipped (1 run).
- Typecheck clean (web and mobile). oxlint and prettier clean on changed files.

### Spec corrections
- `AuthProvider.tsx` never imported `mock/helpers`; it imported only `mock/gate` and `mock/ids`. Helpers was only StickerPanel's (`mockGifItems`).
- No dynamic import on web: `GifPanel` reads `mockItems` once at mount, so an async load needs a GifPanel change (not allowed). I used an inline build-time condition (`import.meta.env.DEV || MODE === 'test' || VITE_MOCK === '1'`) plus `isMockMode()`, which Vite folds. The condition is written inline per file, not exported from `mock/gate.ts`, because `AuthProvider.test.tsx` mocks that module with only two functions.

### Behaviour differences
- None intended on web (dev, tests and mock mode take the same paths).

### Unsure
- Mobile needs the decision above; the web-only branch is the state I would merge.
- Mobile half dropped by the lead (28 KB, test-config cost). Branch now: web only, merged with main at `033c4a43` (conflict: `use-invites-api.ts` removed, main's side). After that merge: the two web test files pass (28 tests) and web typecheck is clean, after `pnpm install` (main added `@zilar/api-contract`).

## Review (written by Claude)

**Lead, 2026-10-10: approved, web half only.**
- **Web:** AuthProvider and StickerPanel no longer pull mock strings into the main chunk (−1.2 kB).
- **Mobile half dropped by the lead:** it saved 28 kB (0.23%) but needed vitest config changes for `require()` of TS. That is not worth it.
- **Check:** the combined wave 4 check passes.

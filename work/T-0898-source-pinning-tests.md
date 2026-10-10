---
id: T-0898
title: "Replace the brittle mobile source-pinning tests with render tests or a lint rule (simplify plan 5.6, F-F7)"
status: todo
milestone: M5
branch: task/T-0898-source-pinning-tests
model: auto
effort: default
depends_on: []
estimate: 0.75 day
---

# T-0898: Replace the brittle mobile source-pinning tests with render tests or a lint rule (simplify plan 5.6, F-F7)

## Spec (written by Claude, do not edit)

### Why
Nine mobile tests read component source as text and assert strings in it, for example `expect(panel).toContain('loadingMoreRef')`. They break on a rename or reformat and prove nothing about behaviour. The audit is `docs/audit/simplify-2026-10-09/F-tests.md`, section F7. The files:
- `apps/mobile/src/components/chat/composer-layout.test.ts` (57 lines)
- `apps/mobile/src/components/chat/search-jump.test.ts` (90)
- `apps/mobile/src/components/chat/attach-sheet.test.tsx` (129)
- `apps/mobile/src/components/chat/attachment-video.test.tsx` (147)
- `apps/mobile/src/components/chat/group-roles-mounted.test.tsx` (164)
- `apps/mobile/src/components/chat/composer-gifs.test.tsx` (223)
- `apps/mobile/src/components/chat/attachment-message.test.tsx` (242)
- `apps/mobile/src/components/chat/gif-panel.test.tsx` (250)
- `apps/mobile/src/lib/hooks-guard.test.ts` (69)

Each rule was written for a real device bug (for example the 2026-10-03 Android layout), so keep one behaviour assertion per rule.

### What to build
1. **Mobile render tests.** For each source-pinned assertion in the files above, write a test that asserts the rule on rendered output instead. Mobile already renders components with `react-dom/server` in many tests; find a current example with `grep -rl "renderToStaticMarkup" apps/mobile/src`. For example, a layout rule like `behavior="padding"` is asserted on the rendered props. Assertions that already render stay as they are. Delete only the source-string reads.
2. **The hooks guard.** `hooks-guard.test.ts` reads `apps/mobile/src/app/chat/[id].tsx` as text. Check whether oxlint's `react` plugin (enabled in `.oxlintrc.json:3`) supports `react-hooks/rules-of-hooks` and whether the rule is on. If it covers the guarded bug, enable it and delete the test; otherwise replace the test with a render test of the keyed composer remount.
3. **Keep the rest:** the drift and style guards stay (`tokens-drift`, `pwa`, `no-solid-pill`, `no-accent-pill`, `gradient-swap`, `native-pitfalls`).
4. **Report:** for each removed assertion, name the test that now covers it, and give the line counts before and after.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; scratch files only in `<scratchpad>/<task id>/`), `docs/audit/simplify-2026-10-09/F-tests.md` (F7), and the nine test files with the components they read.

### Allowed files
The nine test files above, new `apps/mobile/src/components/chat/*.test.tsx` files, `apps/mobile/src/lib/hooks-guard.ts`, `.oxlintrc.json`, `work/T-0898-source-pinning-tests.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/chat src/lib/hooks-guard.test.ts
pnpm --filter @zilar/mobile typecheck
pnpm exec oxlint apps/mobile/src
pnpm exec prettier --check <your changed files>
```

### Acceptance
- The Checks pass.
- No test reads component source as text, except the kept guards.
- Every old rule has a behaviour assertion.
- No component code changes.

---

## Report (written by the worker when done)

## Review (written by Claude)

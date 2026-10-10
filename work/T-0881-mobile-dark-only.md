---
id: T-0881
title: "Mobile is dark-only: remove the dead light-theme branches (155 [scheme] lookups, 135 useColorScheme calls)"
status: merged
milestone: M5
branch: task/T-0881-mobile-dark-only
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0881: Mobile is dark-only: remove the dead light-theme branches (155 [scheme] lookups, 135 useColorScheme calls)

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Finding E-F4 in `docs/audit/simplify-2026-10-09/E-mobile.md`. The app is dark-only: `apps/mobile/src/app/_layout.tsx` forces dark. Yet there are 155 `[scheme]` lookups and 135 `asColorScheme(useColorScheme()…)` calls, so each of those components subscribes to the colour scheme and keeps a light branch nothing can reach.

Line numbers come from the audit and may have moved since: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Confirm in `_layout.tsx` (and in the native config, `app.json` `userInterfaceStyle`) that the app always renders dark.
2. Replace each `[scheme]` lookup with the dark value, and remove the `useColorScheme` calls. If a shared theme object has light and dark halves, keep only dark, and say what you removed.
3. Rendered output in dark must be identical; the screen tests and the phone smoke show it. Count the lines removed.
4. Do not touch `apps/mobile/src/store/**`.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), the audit section and task Reports cited above, and the files listed.

### Allowed files
`apps/mobile/src/**`, `apps/mobile/app.json`, `apps/server/src/handles/rules.ts`, `apps/web/src/components/TaskStrip.tsx`, `apps/web/src/components/ais/AiActivity.tsx`, `apps/web/src/components/ais/aiForm.ts`, `apps/web/src/components/ais/errors.ts`, `apps/web/src/components/ais/limits.ts`, `apps/web/src/components/ais/models.ts`, `apps/web/src/components/ais/templates.ts`, `apps/web/src/lib/attachments.ts`, `apps/web/src/lib/chatPrefs.ts`, `apps/web/src/lib/format.ts`, `apps/web/src/lib/handles.ts`, `apps/web/src/lib/routines.ts`, `apps/web/src/lib/sticker-images.ts`, `apps/web/src/lib/useSmoothText.ts`, `apps/web/src/store/effects/groupMembers.ts`, `apps/web/src/store/realStore.ts`, `packages/chat-core/src/**`, `packages/protocol/src/handles.test.ts`, `packages/protocol/src/handles.ts`, `packages/protocol/src/index.ts`, `packages/protocol/src/jid.test.ts`, `packages/protocol/src/jid.ts`, `packages/xmpp-core/src/jid.ts` (lead: carried by the merge of T-0876, which contains T-0874 and T-0875), `work/T-0881-mobile-dark-only.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/mobile test --reporter=dot
pnpm --filter @zilar/mobile typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit. The machine is shared, so note `uptime` next to any timing.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Lines removed (and every other number the spec asks for) are in the Report, measured.
- Live check for Julio's single test: The phone smoke (lead) screenshots must look the same.

---

## Report (written by the worker when done)

- Confirmed dark-only: `app.json:9` `userInterfaceStyle: "dark"`, `app/_layout.tsx:58` `colorScheme.set('dark')`, `ThemeProvider value={NAV_THEME.dark}`.
- `lib/colors.ts`: the six `Record<ColorScheme, ...>` constants (CHAT_BACKGROUND, BUBBLE_COLORS, ACCENT, ACCENT_FOREGROUND, MUTED_FOREGROUND, FOREGROUND, ICON) are now plain values (dark halves only; light and dark were identical). `lib/color-scheme.ts` deleted.
- `lib/theme.ts`: removed the unused `THEME.light` and `NAV_THEME.light` halves (only `.dark` was used).
- 57 source files: removed the `useColorScheme` and `asColorScheme` imports and calls, replaced `X[scheme]` by `X`. Removed the `scheme` prop of `FolderRow`, `AddConnectionForm`, `JoinBackground` and the `scheme` param of `hubIcon`.
- Tests (86 files): removed the dead `nativewind` `useColorScheme` and `@/lib/color-scheme` mocks, and changed the `@/lib/colors` mocks from `{dark, light}` records to plain values. Also fixed three `.dark` reads (`message-search-list.tsx:236`, `kit.test.tsx`, `switch.test.tsx`) that the `[scheme]` grep did not show.
- Numbers (`git diff HEAD~1 --numstat`): non-test +178 -465 (net -287), tests +99 -556, total +277 -1021 over 152 files. Left: 0 `useColorScheme`, 0 `asColorScheme`, 0 `[scheme]` in `apps/mobile/src`.
- Checks: `pnpm --filter @zilar/mobile typecheck` clean; `oxlint` on the 149 changed files clean; prettier applied. Tests 3 of 3 runs after the last commit: 296 files passed | 2 skipped, 2760 tests passed | 2 skipped (load average 170-190 on the shared machine). Before (first run, mid-edit, load 261): 32 failed from stale `@/lib/colors` test mocks and 5 s timeouts under load; all fixed or gone.
- Behaviour differences: none in dark. 8 test files had mocked `colorScheme: 'light'` (ai-activity, ai-memory-*, routines-section, tools-section, tool-detail-sheet, media-sheet, chat-header); they use real or identical values, so the output is unchanged.
- Not done / unsure: `global.css` comment about the inert `dark:` variant left as is. Did not run `pnpm gate` (wave mode) and did not run the phone smoke.

## Review (written by Claude)

**Lead, 2026-10-10: approved.**
- **What changed:** mobile is dark-only. There are 0 `useColorScheme`, `asColorScheme` or `[scheme]` uses left, the code is net −287 source and −457 test lines, and `color-scheme.ts` is deleted.
- **Merge with main:** the dark change now applies to `mock/dev-kit-screen.tsx`, after T-0848 moved the kit screen there.
- **Check:** the combined wave 4 check passes, and the phone smoke screenshots of the wave tree look the same.

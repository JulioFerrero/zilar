---
id: T-0854
title: "Mobile bundles only the 5 font faces it loads (not 36) and drops the unused Material Symbols font"
status: merged
milestone: M5
branch: task/T-0854-mobile-fonts
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-0854: Mobile bundles only the 5 font faces it loads (not 36) and drops the unused Material Symbols font

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Finding E-F5 in `docs/audit/simplify-2026-10-09/E-mobile.md`.
- **The imports:** `apps/mobile/src/app/_layout.tsx:4-5` imports named weights from `@expo-google-fonts/geist` and `@expo-google-fonts/geist-mono`.
- **What ships:** Metro emits all 36 TTFs (about 100 KB each, about 3.5 MB of the 4.4 MB assets), because each package index requires every font file. The app loads 5 (about `:33-39`).
- **Material Symbols:** `MaterialSymbols_400Regular.ttf` (967 KB) is also bundled. It is likely pulled in through `@expo/vector-icons`, and may be unused.

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Import each loaded face from its own file (for example `@expo-google-fonts/geist/400Regular`; check the package's real file layout in node_modules) so the index is not required.
2. Find who pulls in Material Symbols. If nothing in the app renders it, exclude it with the least invasive Metro or config change, and say how you checked it is unused.
3. **Measure:** run `npx expo export --platform android --output-dir /private/tmp/claude-501/-Users-julio-personal-projects-galena/9686fd0a-230a-4af9-9695-0d5ca8d8e063/scratchpad/expo-t0854` inside apps/mobile before and after, and report the asset count and size.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`apps/mobile/src/app/_layout.tsx`, `apps/mobile/metro.config.js`, `apps/mobile/app.json`, `apps/mobile/app.config.ts`, `apps/mobile/src/components/screens/root-layout-screen.test.tsx`, `work/T-0854-mobile-fonts.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/screens
pnpm --filter @zilar/mobile typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Every number the spec asks for (sizes, timings, counts) is in the Report, measured.
- Live check for Julio's single test: The phone smoke screenshots (lead) show the same fonts.

---

## Report (written by the worker when done)

**Changed files (all Allowed):** `apps/mobile/src/app/_layout.tsx`, `apps/mobile/metro.config.js`. No other file changed.

**Assets, `npx expo export --platform android` (CI=1), measured:**
- Before: 63 asset files, 4,495,130 bytes (36 Geist/GeistMono TTFs at about 100 KB each, plus one Material Symbols font at 966,544 bytes).
- After: 31 asset files, 498,262 bytes (the 5 loaded faces at about 90–101 KB each, nothing else).
- Net: 32 files and about 4.0 MB less. Export outputs are in the scratch folder (`expo-t0854-before`, `expo-t0854`), not in the repo.

**Font imports:** each loaded face is now imported from its own file (`@expo-google-fonts/geist/400Regular`, `/500Medium`, `/600SemiBold`, `geist-mono/400Regular`, `/500Medium`). I checked that each file exports the same name the layout uses.

**Material Symbols: removed, with evidence.**
- Who pulls it: `expo-router` → `withLayoutContext.js` → `native-tabs/NativeTabTrigger` → `utils/optionsIconConverter.android.js` → `utils/materialIconConverter.android.js` → `expo-symbols` → `@expo-google-fonts/material-symbols/<weight>`. The chain is confirmed by reading the files in `node_modules`.
- Unused: `grep -rn "expo-symbols\|SymbolView\|vector-icons\|MaterialSymbols" apps/mobile/src apps/mobile/app` returns nothing, and `apps/mobile/package.json` has no direct dependency on either package. The Material converter only runs for native tabs with a Material icon, and the app does not use native tabs.
- Exclusion: a Metro resolver stub in `metro.config.js`, the same pattern as the existing XMPP stubs. It maps `@expo-google-fonts/material-symbols` and its subpaths to the existing empty module. The font file is no longer in the export.

**Checks:**
- `pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/screens`: 318 passed (27 files), **3 of 3 runs clean**. A first run before the final check had 2 timeouts in `settings-approvals-screen.test.tsx`; both files passed on rerun in isolation, and the next three full runs were clean. The timeouts came from machine load (27 workers), not the font change.
- `pnpm --filter @zilar/mobile typecheck`: clean (`tsc --noEmit`, no output).
- `prettier --write` on both changed files: unchanged. `oxlint` on both changed files: clean, no output.

**Unsure / for the lead:**
1. The Allowed file `apps/mobile/src/components/screens/root-layout-screen.test.tsx` does not exist. The layout test is `_layout-screen.test.tsx`. I did NOT edit it (outside the literal Allowed list). Its `vi.mock('@expo-google-fonts/geist')` and `geist-mono` mocks target the package index, which the layout no longer imports, so those mocks no longer intercept. The test still passes because vitest loads the real per-weight modules. The mock is now dead code and should be updated in a follow-up if you want it clean.
2. The live check (same fonts on the phone) is the lead's phone smoke. I did not run the emulator.

## Review (written by Claude)

**Lead, 2026-10-10: approved.**
- **What changed:** the Android export assets go from 63 files and 4.50 MB to 31 files and 0.50 MB, and the unused Material Symbols font is gone.
- **Checks:** the combined check is clean, and the phone smoke screenshots show the same fonts.
- **Leftover:** the `geist` mocks in `_layout-screen.test.tsx` are now dead, a small follow-up.

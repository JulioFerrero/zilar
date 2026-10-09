---
id: T-0854
title: "Mobile bundles only the 5 font faces it loads (not 36) and drops the unused Material Symbols font"
status: todo
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

## Review (written by Claude)

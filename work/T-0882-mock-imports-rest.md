---
id: T-0882
title: "The last static mock imports leave the production bundles (mobile chat screen, chats tab, composer; web StickerPanel and AuthProvider)"
status: todo
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

## Review (written by Claude)

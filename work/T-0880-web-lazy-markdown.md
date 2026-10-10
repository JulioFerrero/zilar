---
id: T-0880
title: "Web: lazy-load the markdown stack (about 120 KB min) behind a plain-text fallback"
status: todo
milestone: M5
branch: task/T-0880-web-lazy-markdown
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0880: Web: lazy-load the markdown stack (about 120 KB min) behind a plain-text fallback

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Finding D-W3 (markdown part) in `docs/audit/simplify-2026-10-09/D-web.md`. The markdown stack is about 120 KB minified in the eager bundle. It is used only by `MessageBubble` (`apps/web/src/components/MessageBubble.tsx`, about :26 and :691) for AI replies and `markdownToPlain`. T-0862 made the routes lazy; T-0845 memoised `MessageBubble`.

Line numbers come from the audit and may have moved since: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Load `MarkdownText` and its markdown dependencies with `React.lazy`. Fall back to the plain text, so a bubble never shows empty. Keep `markdownToPlain` working synchronously: if it needs the markdown lib, use a light plain-text path, or keep it eager and say so.
2. Tests that render markdown synchronously may need `findBy`/`waitFor`. Change only that kind of line, and list each one.
3. Report the chunk sizes from `pnpm --filter @zilar/web build`, before and after, raw and gzip, including the total JS loaded at startup.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), the audit section and task Reports cited above, and the files listed.

### Allowed files
`apps/web/src/components/MessageBubble.tsx`, `apps/web/src/components/MarkdownText.tsx`, `apps/web/src/lib/markdown*.ts`, `apps/web/src/**/*.test.tsx`, `apps/web/src/**/*.test.ts`, `apps/web/vite.config.ts`, `work/T-0880-web-lazy-markdown.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/web test --reporter=dot
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/web build
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

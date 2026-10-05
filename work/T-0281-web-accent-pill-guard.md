---
id: T-0281
title: "Web guard: a test fails when a hand-rolled bg-accent button or link comes back outside the kit"
status: todo
milestone: M5
branch: task/T-0281-web-accent-pill-guard
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0281: accent pill guard

## Spec (written by Claude, do not edit)

### Why
T-0275 to T-0279 moved every hand-rolled accent `<button>` / `<Link>` in `apps/web/src` to the kit `Button`. `docs/audit/ui-kit-audit.md` lines 437-443 propose a check so they do not come back.

The gate only runs the tests of the packages that changed (`PASS tests @zilar/web`). So the guard must be a test inside `apps/web`, so that it runs whenever web code changes. Do not put it in `packages/devtools`.

### Verified facts (do not re-derive)
- `grep -rn 'bg-accent px-' apps/web/src`, excluding `components/ui/` and `*.test.*`, prints exactly two lines today, both `<span>` badges and not buttons:
  - `apps/web/src/components/FolderRail.tsx:124`: an unread-count `<span … bg-accent px-1 …>`;
  - `apps/web/src/routes/StickersPage.tsx:78`: the `VisibilityBadge` span's class string, inside the `<span className={…}>` that starts at line 75.
- Pattern to copy for a repo-scanning test: `packages/devtools/src/no-legacy-name.test.ts`, which lists files with `git ls-files` and reads each one.
- The kit lives in `apps/web/src/components/ui/`.

### What to build
1. Add `apps/web/src/components/ui/no-accent-pill.test.ts`. It scans every `*.tsx` under `apps/web/src`, skipping `components/ui/` and test files:
   - match only the **solid** class: `bg-accent` as a whole class token, preceded by start, whitespace, a quote or a backtick, and not followed by `/` or `-`. Tinted states such as `bg-accent/10` and `bg-accent/20` and prefixed ones such as `hover:bg-accent/90` are allowed. Today four buttons use tints legitimately: `components/SearchBar.tsx:50`, `components/ais/NewAiDialog.tsx:246`, `components/ais/AiPageShell.tsx:79` and `routes/SetupPage.tsx:232`;
   - for each matching line, find the JSX tag that line belongs to: the nearest `<Tag` at or above it, the same way a reader would;
   - fail when the tag is `button`, `a` or `Link`.
   - The failure message names `file:line` and says: "use the kit Button from '@/components/ui/button' (variant default = key-primary)".
   - A `<span>`, `<div>` or other non-interactive tag is allowed.
   - Keep it simple and readable, with no AST library.
2. Prove it bites:
   - the test file includes a small unit test of the matcher on inline sample strings: a button pill fails, a span badge passes, a `Link` pill fails, and a button with `bg-accent/10` passes;
   - say in the Report that you added a pill to a real file, saw the test fail, and reverted it.
3. Update the "Gate check proposal" paragraph in `docs/audit/ui-kit-audit.md` (lines 437-443) to say the guard now exists, and where.

### Read first
`AGENTS.md`, `packages/devtools/src/no-legacy-name.test.ts`, `apps/web/src/components/ui/button.tsx`, `docs/audit/ui-kit-audit.md` lines 430-450.

### Allowed files
`apps/web/src/components/ui/no-accent-pill.test.ts`, `docs/audit/ui-kit-audit.md`, `work/T-0281-web-accent-pill-guard.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot no-accent-pill
pnpm gate
```

### Acceptance
- The guard passes on today's tree, with the two `<span>` badges allowed, and fails on a hand-rolled accent `<button>` or `Link`.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

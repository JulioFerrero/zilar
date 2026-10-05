---
id: T-0281
title: "Web guard: a test fails when a hand-rolled bg-accent button or link comes back outside the kit"
status: merged
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

### What I did

- Added `apps/web/src/components/ui/no-accent-pill.test.ts`, a web-owned guard so
  it runs in the `PASS tests @zilar/web` gate step whenever web code changes.
  - Scans every `*.tsx` under `apps/web/src` except the kit (`components/ui/`)
    and `*.test.tsx` files.
  - Matches only the solid class with
    `/(^|[\s'"`])bg-accent(?![/-])/` — so `bg-accent/10`, `bg-accent/25`,
    `hover:bg-accent/10` and `bg-accent-foreground` are allowed.
  - Resolves the nearest `<Tag` at or above the matching line and fails when it
    is `button`, `a` or `Link`, printing
    `file:line: <tag> use the kit Button from '@/components/ui/button' (variant default = key-primary)`.
  - Unit-tests the matcher inline: a `<button>` pill fails, a `<span>` badge
    passes, a `<Link>` pill fails, and a `<button className="bg-accent/10">`
    passes; plus a multi-line tag-resolution case.
- Updated the "Gate check proposal" paragraph in `docs/audit/ui-kit-audit.md`
  (now line 437) to say the guard exists and where, replacing the old
  `rg 'bg-accent px-'` snippet.

### Files changed

- `apps/web/src/components/ui/no-accent-pill.test.ts` (new)
- `docs/audit/ui-kit-audit.md` (rewrote the gate-check paragraph)
- `work/T-0281-web-accent-pill-guard.md` (this report + status)

### Deviation from the spec (and why)

The spec said to copy `packages/devtools/src/no-legacy-name.test.ts` and list
files with `git ls-files`. That needs `node:child_process`, which the web
typecheck rejects: `apps/web/tsconfig.json` is DOM-only (`types: ["vite/client"]`)
and its local shim `apps/web/src/lib/node-builtins.d.ts` declares only `node:fs`,
`node:path` and `node:url`. Adding `child_process`/`Buffer` to that shim is
outside my Allowed files, so I listed files with Vite's `import.meta.glob`
(the same mechanism `apps/web/src/components/ui/fixtures.test.tsx` already
uses) and read each one with the shim's `readFileSync`. Behaviour is otherwise
as specified; one consequence is that the guard walks the working tree rather
than only tracked files (today the only untracked `.tsx` is none; the guard's
own file is `.ts` and excluded). Verified facts unaffected: the two `<span>`
badges (`FolderRail.tsx:124`, `StickersPage.tsx:78`), the `FolderTabs.tsx:82`
and `FolderEditorDialog.tsx:376` check spans, and the `ProgressCard.tsx:33`
div are all allowed because the nearest tag is not interactive.

### Commands and real results

- `pnpm install`: done, 1170 packages, exit 0.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot no-accent-pill`:
  `Test Files 1 passed (1)`, `Tests 4 passed (4)`, exit 0.
- Bite proof: temporarily added `bg-accent` to the `<button>` class in
  `apps/web/src/components/FolderTabs.tsx:70` and re-ran the test; it failed
  with
  `apps/web/src/components/FolderTabs.tsx:70: <button> use the kit Button from '@/components/ui/button' (variant default = key-primary)`
  (`Tests 1 failed | 3 passed`). Reverted with `git checkout -- apps/web/src/components/FolderTabs.tsx`; `git status` clean for that file.
- `pnpm gate` (from repo root): exit 0, summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (22.8s)
  PASS  lint  (0.6s)
  PASS  typecheck  (10.0s)
  PASS  tests @zilar/web  (3.3s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Open questions / problems

None. No new dependency added.

### Fix round 1 (lead review)

- Commit `beba5185`: the repo-scan test now asserts the scan actually read the
  tree — `findHandRolledPills` exposes `scanned` and the test requires
  `scanned > 50` (232 `*.tsx` files under `apps/web/src` today), so a broken
  glob fails instead of passing vacuously.
- Commit `d4564114`: `nearestTag` now attributes the class to the last `<Tag`
  at or before the `bg-accent` position on the matching line (walking upward as
  before), with a new unit case: `<span><button className="bg-accent px-2">`
  fails as `<button>`.
- Nit 1 (solid `hover:bg-accent`) left as requested.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot no-accent-pill`:
  `Test Files 1 passed (1)`, `Tests 4 passed (4)`, exit 0.
- `pnpm gate` (from repo root): exit 0 —
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (11.1s)
  PASS  lint  (0.5s)
  PASS  typecheck  (6.2s)
  PASS  tests @zilar/web  (1.9s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

## Review (written by Claude)

**Approved** after one lead fix round.
- **The scan cannot pass empty.** It now asserts that it read the web sources, so a broken glob fails the test.
- **The tag check is right.** A same-line `bg-accent` is attributed to the last tag before it.

**Accepted nits:**
- The upward search still takes the first tag on a line above. A formatter never produces that layout.
- A solid `hover:bg-accent` stays allowed, as the spec defines.

**Proof it works:** the worker planted a pill in a real file, saw the test fail, and reverted it.

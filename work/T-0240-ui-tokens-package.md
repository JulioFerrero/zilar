---
id: T-0240
title: "packages/ui-tokens: one source for colours, radius and the D24 depth recipes, with drift tests in web and mobile"
status: merged
milestone: M5
branch: task/T-0240-ui-tokens-package
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: [T-0236]
estimate: 0.5 day
---

# T-0240: Shared UI tokens package

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-05: one shared UI kit with React Cosmos. The rollout is audit, then tokens, kit and catalog, then gradual migration. The audit is merged: `docs/audit/ui-kit-audit.md`. Section 3 proposes `packages/ui-tokens`, and section 5 step 1 is this task. No visual change: every value stays exactly as it is today.

### Verified facts (do not re-derive)
- Workspace packages are plain TS with no build step: `packages/chat-core/package.json` (`"exports": { ".": "./src/index.ts" }`, scripts `typecheck` and `test`), `packages/chat-core/tsconfig.json` (extends `../../tsconfig.base.json`). `pnpm-workspace.yaml` already includes `packages/*`. Both apps already depend on a workspace package the same way (`apps/web/package.json` line 15, `apps/mobile/package.json` line 20, `"@zilar/chat-core": "workspace:*"`).
- Web palette: `apps/web/src/index.css` `:root` lines 66-133 (hex values plus `var(...)` aliases); radius scale lines 60-63; depth utilities `key-primary`, `key-icon`, `well-surface`, `raised-pill`, `segment-raised` at lines 186-284. The CSS writes numbers like `0.4` and spreads shadows over lines.
- Mobile palette: `apps/mobile/src/global.css` lines 12-58 (all literals). Literal colours: `apps/mobile/src/lib/colors.ts` lines 1-40. Depth constants (exact shadow and gradient strings, `ACCENT`, `EDGE`, `BORDER`, `WELL_BACKGROUND`, `ICON_COLOR` …): `apps/mobile/src/lib/depth.ts` lines 1-60.
- Known differences (audit section 3 table): web `--chat-background` is a dot grid, mobile is flat `#0a0a0a` and `CHAT_BACKGROUND` in `colors.ts` is `#000000`. Mobile has no `--key-text-shadow`, `--avatar-ring`, `--list-active-foreground`, `--voice-played`/`--voice-unplayed`, and no radius sm/md/lg/xl. **Keep every difference as it is**; the package records them (see step 1).

### What to build
1. **Package** `packages/ui-tokens/` (`package.json` named `@zilar/ui-tokens`, private, `type: module`, exports `./src/index.ts`, scripts `typecheck` and `test`; `tsconfig.json` like chat-core; no dependencies). `src/index.ts` exports plain data only (no DOM or React Native imports):
   - `palette`: every D24 hex value shared by both apps (page, panel, surface, surfaceRaised, well, border, borderStrong, edge, foreground, mutedForeground, subtleForeground, generatingForeground, accent, accentForeground, online, danger, badgeMuted, bubbleIn, bubbleOut, bubbleInMeta, bubbleOutMeta, destructiveForeground, iconColor `#d4d4d4`);
   - `radius` (`0.75rem` and the web sm/md/lg/xl formulas as strings);
   - `depth`: the gradient and shadow strings exactly as in `depth.ts` (KEY_PRIMARY_*, KEY_ICON_*, WELL_SHADOW, SEGMENT_*, PILL_*, BUBBLE_*);
   - `platformDifferences`: a typed list of the known differences above, each with its web value, its mobile value and a one-line note.
   Add `src/index.test.ts` that checks every palette value is a 6-digit lowercase hex.
2. **Mobile uses the package:** add `"@zilar/ui-tokens": "workspace:*"` to `apps/mobile/package.json`. `depth.ts` and `colors.ts` keep every exported name and value, but take the values from the package (for example `export const ACCENT = palette.accent;`, `export const WELL_SHADOW = depth.wellShadow;`). Callers do not change. `CHAT_BACKGROUND` stays `#000000` (a recorded difference).
3. **Drift tests** (fail when a file disagrees with the package):
   - `apps/web/src/lib/tokens-drift.test.ts` (new): reads `apps/web/src/index.css`.
     - Each palette value equals its `:root` variable.
     - Each depth string appears in its utility. Compare after normalising: remove all whitespace, and write numbers without trailing zeros (`0.40` → `0.4`).
     - Add `"@zilar/ui-tokens": "workspace:*"` to `apps/web/package.json`.
   - `apps/mobile/src/lib/tokens-drift.test.ts` (new): reads `apps/mobile/src/global.css` and checks each palette value equals its `:root` variable.
   - Both tests skip the recorded differences by name, reading them from `platformDifferences`.
4. No CSS value changes, no component changes, no codegen. Run `pnpm install` once to link the new package. Commit `pnpm-lock.yaml` only for the new workspace links. If the install flips the `bufferutil`/`utf-8-validate` peer entries, revert those lines.

### Read first
`AGENTS.md`, `docs/audit/ui-kit-audit.md` (sections 3 and 6), `packages/chat-core/package.json`, `packages/chat-core/tsconfig.json`, `apps/web/src/index.css` (lines 55-290), `apps/mobile/src/global.css`, `apps/mobile/src/lib/colors.ts`, `apps/mobile/src/lib/depth.ts`.

### Allowed files
`packages/ui-tokens/**` (new package: `package.json`, `tsconfig.json`, `src/index.ts`, `src/index.test.ts`), `apps/mobile/package.json`, `apps/mobile/src/lib/depth.ts`, `apps/mobile/src/lib/colors.ts`, `apps/mobile/src/lib/tokens-drift.test.ts` (new), `apps/web/package.json`, `apps/web/src/lib/tokens-drift.test.ts` (new), `pnpm-lock.yaml`, `work/T-0240-ui-tokens-package.md`.

### Checks
```bash
pnpm --filter @zilar/ui-tokens test --reporter=dot
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/lib/tokens-drift.test.ts
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/tokens-drift.test.ts
pnpm gate
```

### Acceptance
- `@zilar/ui-tokens` exists and is plain data; mobile `depth.ts` and `colors.ts` read from it with the same exported names and values.
- The drift tests pass on today's files and fail if a value in `index.css` or `global.css` changes (show this once in your Report by changing a value locally, running the test, and reverting).
- No visual change; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Kit components, React Cosmos, changing any value, fixing the recorded differences (Julio decides the dot-grid question later), codegen of CSS.

---

## Report (written by the worker when done)

### What I did
- New package `packages/ui-tokens/` (`package.json` named `@zilar/ui-tokens`,
  private, `type: module`, exports `./src/index.ts`, scripts `typecheck` and
  `test`; `tsconfig.json` like chat-core; no dependencies). `src/index.ts`
  exports plain data only: `palette` (23 D24 hex values), `radius` (base plus
  the web sm/md/lg/xl formulas as strings), `depth` (16 gradient/shadow
  strings exactly as in `depth.ts`), `platformDifferences` (11 typed entries:
  chat-background, chat-background-literal, key-text-shadow, avatar-ring,
  list-active-foreground, voice-played/unplayed, radius-sm/md/lg/xl, each with
  web value, mobile value and a one-line note). `src/index.test.ts` checks
  every palette value is a 6-digit lowercase hex.
- Mobile uses the package: `@zilar/ui-tokens: workspace:*` in
  `apps/mobile/package.json`; `depth.ts` and `colors.ts` keep every exported
  name with identical values, now read from `palette`/`depth`.
  `CHAT_BACKGROUND` stays `#000000` (a recorded difference).
- Drift tests: `apps/web/src/lib/tokens-drift.test.ts` reads `index.css`
  (palette vs `:root` with `var(--…)` aliases resolved, shadcn aliases pinned,
  radius scale, every depth string in its utility after whitespace/trailing-zero
  normalisation), plus `@zilar/ui-tokens` in `apps/web/package.json`.
  `apps/mobile/src/lib/tokens-drift.test.ts` reads `global.css`. Both skip the
  recorded differences by name from `platformDifferences`.
- `pnpm install` run once to link the package; `pnpm-lock.yaml` diff is only
  the two new workspace links plus the `packages/ui-tokens: {}` importer
  (8 insertions, no `bufferutil`/`utf-8-validate` flips).

### Files changed
`packages/ui-tokens/package.json`, `packages/ui-tokens/tsconfig.json`,
`packages/ui-tokens/src/index.ts`, `packages/ui-tokens/src/index.test.ts`
(new), `apps/mobile/package.json`, `apps/mobile/src/lib/depth.ts`,
`apps/mobile/src/lib/colors.ts`, `apps/mobile/src/lib/tokens-drift.test.ts`
(new), `apps/web/package.json`, `apps/web/src/lib/tokens-drift.test.ts` (new),
`pnpm-lock.yaml`, `work/T-0240-ui-tokens-package.md`.

### Commands and real results
- `pnpm install`: Done in 3.9s (only warning: pre-existing unmet peer
  `@types/react@^19.3.0` found 19.2.18).
- `pnpm --filter @zilar/ui-tokens test --reporter=dot`: 1 file, 5 passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot
  src/lib/tokens-drift.test.ts`: 1 file, 7 passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot
  src/lib/tokens-drift.test.ts`: 1 file, 2 passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot
  src/lib/depth.test.ts` (regression check on the rewritten `depth.ts`):
  1 file, 10 passed.
- Negative drift proofs (changed a value locally, ran, reverted with
  `git checkout`): web `--surface: #111111` → `#121212` fails with
  `--surface: expected '#121212' to be '#111111'` (1 failed, 6 passed);
  mobile `--edge: #050505` → `#060606` fails with
  `--edge: expected '#060606' to be '#050505'` (1 failed, 1 passed).
- `pnpm gate`: GATE PASS — install (frozen) PASS, format PASS, lint PASS,
  typecheck PASS, tests @zilar/mobile PASS, tests @zilar/ui-tokens PASS,
  tests @zilar/web PASS; "scope: every changed file is inside the Allowed
  files"; 12 changed files against main.

### Problems / deviations
- Two test-only fixes while converging (no CSS or value changed):
  `rootVariable` resolves `var(--…)` aliases (`--bubble-in-meta`); the radius
  sm/md/lg/xl vars are read via a whole-file lookup because they live in
  `@theme inline`, not `:root`; web `bubble-gen` has one extra drop shadow
  beyond the shared `BUBBLE_GEN_SHADOW`, so that one string is covered by a
  dedicated test (2 of 3 shared layers render verbatim plus the shared first
  layer) instead of an exact-contains check. The `bubble-gen` middle-layer
  difference (`rgba(0,0,0,0.5)` vs `0.4`) and the extra tail layer are
  pre-existing web/mobile recipe differences, kept as-is per spec; a future
  task may want them in `platformDifferences`.
- Security checklist: no secrets, no routes, no deletes/updates, no caps, no
  audit entries; drift tests read local CSS files only. N/A beyond that.

### Blocked / needs a decision
None.

## Review (written by Claude)

**Verdict:** Approved. The first pre-review was clean, with 4 nits, all about how tight the tests are; see the list below. The lockfile diff is only the three new workspace links, with no peer-entry churn. Mobile `depth.ts` and `colors.ts` keep their names and values and now read them from `@zilar/ui-tokens`.

Nits, for the next tokens touch:
- `iconColor` is checked against the whole web file;
- the `> 10` guards are loose;
- one mobile assertion checks nothing;
- the recorded `key-text-shadow` web value is not written exactly as in the CSS.

Next: mobile dot-grid chat background (Julio 2026-10-05), which removes that recorded difference; then the web kit P1 with React Cosmos.

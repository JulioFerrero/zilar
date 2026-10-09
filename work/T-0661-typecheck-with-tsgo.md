---
id: T-0661
title: "typecheck with the native compiler: upgrade typescript to 7.0.2 (stable, native tsc) everywhere; apps/mobile keeps the TS 6 API for Expo through the official @typescript/typescript6 alias"
status: merged
milestone: M5
branch: task/T-0661-typecheck-with-tsgo
model: auto
effort: low
depends_on: [T-0659]
estimate: 0.5 day
---

# T-0661: typecheck with tsgo

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-09: "use tsgo, please". T-0657 measured tsgo 7.0.0-dev.20260707.2 against tsc 6.0.3:
- the same result, 0 errors, on `apps/server` and `packages/protocol`;
- 1.9x faster on `apps/server` and 4.1x faster on `packages/protocol`.

The gate's typecheck step runs each package's `typecheck` script through Turbo (`packages/devtools/src/gate/plan.ts`), so switching the scripts switches the gate.

### Verified facts (do not re-derive)
- **The `typecheck` scripts:**

  | `package.json` | Script |
  | --- | --- |
  | `apps/mobile:11`, `apps/runner:7`, `apps/server:9` | `tsc --noEmit` |
  | `packages/devtools:10`, `packages/agent-drivers:10`, `packages/chat-core:10` | `tsc --noEmit` |
  | `packages/protocol:10`, `packages/ui-tokens:10`, `packages/runner-tunnel:10` | `tsc --noEmit` |
  | `apps/site:10` | `tsc --noEmit -p tsconfig.json` |
  | `apps/web:11` | `tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json` |
  | `packages/xmpp-core:10` | `tsc --noEmit && tsc --noEmit -p tsconfig.integration.json` |

- **TypeScript 7.0 is stable.** Since 2026-07-08 the npm `typescript` package (latest 7.0.2) ships the native compiler as `tsc`, the same compiler `tsgo` was. Julio's direction (2026-10-09, after this spec was first written): use the native compiler everywhere ("just tsgo, nothing of tsc"), and use TypeScript 7 itself, not the dev preview. **This replaces the earlier native-preview plan.** The `@typescript/native-preview` package must not be used.
- **TS 7.0 has no programmatic API.** Tools that import `typescript` need TS 6, through the official alias `@typescript/typescript6` (bin `tsc6`).

### What to build
1. **Upgrade `typescript` to exactly `7.0.2`** in the root `package.json` (`^6.0.3` today) and in `apps/mobile/package.json` (`~6.0.3`, the Expo pin).
2. **Every `typecheck` script keeps calling `tsc`,** which is now TS 7. Do not add `@typescript/native-preview` or use `tsgo`.
3. **In `apps/mobile` only,** where Expo needs the TS 6 API, use the official side-by-side setup:
   - `"typescript": "npm:@typescript/typescript6@6.0.2"`;
   - `"@typescript/native": "npm:typescript@7.0.2"`.

   That package's `tsc` must resolve to 7.0.2. Show it with `pnpm --filter @zilar/mobile exec tsc --version`.
4. **For each package, compare TS 6 with TS 7** (exit code, number of errors and seconds). If TS 7 reports errors that TS 6 did not, list them with file:line under Blocked and stop.
5. **In the Report,** run `pnpm exec turbo run typecheck --force --concurrency=2` once and paste its summary lines.

### Read first
`AGENTS.md`, `work/T-0657-tsgo-spike.md` (its Report), the `package.json` of each package listed above, and the root `package.json`.

### Allowed files
`package.json`, `pnpm-lock.yaml`, `apps/mobile/package.json`, `apps/runner/package.json`, `apps/server/package.json`, `apps/site/package.json`, `apps/web/package.json`, `packages/devtools/package.json`, `packages/agent-drivers/package.json`, `packages/chat-core/package.json`, `packages/xmpp-core/package.json`, `packages/protocol/package.json`, `packages/ui-tokens/package.json`, `packages/runner-tunnel/package.json`, `work/T-0661-typecheck-with-tsgo.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- `typescript` is exactly 7.0.2 at the root, and apps/mobile uses the official TS 6 / TS 7 alias pair.
- `@typescript/native-preview` and `tsgo` appear nowhere.
- The full `turbo run typecheck --force` passes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

> **Task history, 2026-10-09:** the first pass below shipped TypeScript 7.0.2 (native `tsc` everywhere). A fix round then switched to `@typescript/native-preview`/`tsgo`, but the Spec was rewritten (`spec now TypeScript 7.0.2`) to keep TS 7.0.2 and forbid the preview package, so that fix round was reverted. See `### Round 2` at the end; the sections below describe the intended, final TS 7 state.

### What I did
- Removed the `@typescript/native-preview` devDependency I had added in the first pass; it is not in the final diff.
- Upgraded `typescript` to exactly `7.0.2` in the root `package.json` (`^6.0.3` -> `7.0.2`) and in `apps/mobile/package.json` (`~6.0.3` -> `7.0.2`). TS 7's `tsc` is the native compiler.
- Kept every `typecheck` script calling `tsc` (reverted the `tsc` -> `tsgo` edits from the first pass). No script calls `tsgo`.
- Applied the official side-by-side setup in **`apps/mobile` only** (see "Expo / TS 6 programmatic API" below): `"typescript": "npm:@typescript/typescript6@6.0.2"` and `"@typescript/native": "npm:typescript@7.0.2"`. The `@typescript/typescript6` package ships bin `tsc6` (not `tsc`), so there is no bin clash: `tsc` in that package resolves to TS 7 via `@typescript/native`.
- Ran the old (TS 6) and new (TS 7) command for every package and compared exit code and error count. All packages: exit 0, 0 errors under both. No error differs, so nothing is listed under Blocked.
- Ran `pnpm exec turbo run typecheck --force --concurrency=2` once and `pnpm gate`.

### Versions
- TS 6 baseline: `tsc 6.0.3` (root declared `^6.0.3`; measured before the upgrade).
- TS 7: `tsc 7.0.2`.

### Timing table (TS 6.0.3 vs TS 7.0.2, seconds)
Each row is one `tsc --noEmit` invocation (`pnpm exec tsc ...`, wall time). `apps/web` and `packages/xmpp-core` run two projects, so they have two rows.

| Package | Command | TS 6.0.3 s | TS 7.0.2 s | Result |
| --- | --- | --- | --- | --- |
| apps/mobile | `tsc --noEmit` | 5.22 | 1.05 | same, 0 errors both |
| apps/runner | `tsc --noEmit` | 4.32 | 0.97 | same, 0 errors both |
| apps/server | `tsc --noEmit` | 5.70 | 1.29 | same, 0 errors both |
| apps/site | `tsc --noEmit -p tsconfig.json` | 0.96 | 0.31 | same, 0 errors both |
| apps/web | `tsc --noEmit -p tsconfig.json` | 4.98 | 0.97 | same, 0 errors both |
| apps/web | `tsc --noEmit -p tsconfig.node.json` | 0.67 | 0.29 | same, 0 errors both |
| packages/devtools | `tsc --noEmit` | 1.61 | 0.34 | same, 0 errors both |
| packages/agent-drivers | `tsc --noEmit` | 1.11 | 0.30 | same, 0 errors both |
| packages/chat-core | `tsc --noEmit` | 0.85 | 0.28 | same, 0 errors both |
| packages/protocol | `tsc --noEmit` | 0.79 | 0.31 | same, 0 errors both |
| packages/ui-tokens | `tsc --noEmit` | 0.41 | 0.25 | same, 0 errors both |
| packages/runner-tunnel | `tsc --noEmit` | 0.98 | 0.32 | same, 0 errors both |
| packages/xmpp-core | `tsc --noEmit` | 1.06 | 0.35 | same, 0 errors both |
| packages/xmpp-core | `tsc --noEmit -p tsconfig.integration.json` | 1.15 | 0.36 | same, 0 errors both |

TS 7 is faster on every package, and no package produced a deprecated-option error (no `baseUrl`, `moduleResolution: node` or `downlevelIteration` complaint).

### Expo / TS 6 programmatic API (why mobile keeps the side-by-side pair)
- The tool is **Expo CLI's `@expo/require-utils`** (pulled in by `@expo/cli` / `expo`; `pnpm why typescript` in `apps/mobile` shows `@expo/require-utils -> @expo/cli -> expo -> @zilar/mobile`). It calls `require('typescript')` and uses the programmatic compiler API (`ts.transpileModule`, `ts.ModuleKind`, `ts.ScriptTarget`) to transpile TS config/plugins. Its own source says: "typescript v7 ships without the necessary compiler/public APIs to use it".
- Concrete evidence of the API gap:
  - root `require('typescript')` -> `7.0.2 transpileModule=undefined`
  - `apps/mobile` `require('typescript')` -> `6.0.3 transpileModule=function`
- So `apps/mobile` declares `typescript` as the TS 6 alias and `@typescript/native` as the TS 7 alias. Its `typecheck` script is unchanged (`tsc --noEmit`) and runs TS 7: `pnpm --filter @zilar/mobile exec tsc --version` -> `Version 7.0.2`, while `tsc6 --version` -> `6.0.3`.
- `pnpm why typescript` at the root shows only the root devDependency; no other workspace package or tool imports the TypeScript programmatic API (a repo-wide grep for `from 'typescript'` / `require('typescript')` in `apps`, `packages`, `scripts` found nothing). So the side-by-side pair is needed only in `apps/mobile`.
- Honesty note: I did not run a full Expo build/`expo start` (heavy, and it is a build/daemon path). The side-by-side decision rests on `pnpm why typescript` plus the `@expo/require-utils` source and the runtime `transpileModule` check above, exactly the trigger in the direction ("anything `pnpm why typescript` shows importing `typescript`").

### Files changed
- `package.json` (root): `typescript` `^6.0.3` -> `7.0.2`.
- `apps/mobile/package.json`: `typescript` -> `npm:@typescript/typescript6@6.0.2`, added `@typescript/native` -> `npm:typescript@7.0.2`.
- `pnpm-lock.yaml` (dependency swap / aliases).
- `work/T-0661-typecheck-with-tsgo.md` (this file).
- `git status --porcelain` shows exactly those four files; all are in the Allowed files. The other package.json files match their original content (script edits were reverted), so they are not in the diff.

### Commands run (real results)
- `pnpm install`: clean; only the pre-existing `@types/react` peer warning (`apps/mobile`, `@types/react-dom` wants `^19.3.0`, found `19.2.18`). No TypeScript peer warning.
- TS 6 baseline: `pnpm exec tsc --version` -> `6.0.3`; every package exit 0, 0 errors.
- After upgrade: `pnpm exec tsc --version` -> `7.0.2`; every package exit 0, 0 errors.
- `pnpm exec turbo run typecheck --force --concurrency=2`:
  ```
   Tasks:    12 successful, 12 total
  Cached:    0 cached, 12 total
    Time:    4.453s
  ```
- `pnpm gate`:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (12.2s)
  PASS  lint  (0.8s)
  PASS  typecheck  (5.8s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- No package test file was run individually (this task changes no source).

### Blocked / needs a decision
None. TS 7 reported no errors that TS 6 did not, so no tsconfig change was needed.

### Open questions
- `@typescript/typescript6@6.0.2` resolves to a compiler that self-reports version `6.0.3` (`tsc6 --version` -> `6.0.3`, package.json version -> `6.0.2`). This is the official alias package as named in the direction; flagging it in case the exact reported patch matters.

### Round (fix round)
Findings addressed: PREREVIEW findings 1 and 2 (should-fix). Findings 3 and 4 are nits; both describe the TypeScript 6/7 alias pair that the finding-2 revert removes, so neither applies any more (the mobile `@typescript/native` alias and the `@typescript/typescript6` alias are gone).

**Fix finding 2 - keep TypeScript 6.x.** Reverted the TypeScript 7.0.2 upgrade: the root `package.json` `typescript` is `^6.0.3` again and `apps/mobile/package.json` is back to `typescript: ~6.0.3` with the `@typescript/native` alias removed. Both files are byte-identical to `main` (`git diff main -- package.json apps/mobile/package.json` is empty). This restores the T-0001 decision to stay on TS 6.x, so tsx, Vitest, oxlint and Expo keep the compiler they were built against; the "tool support under TS 7" risk the finding raised no longer exists.

**Fix finding 1 - use `tsgo` as the Spec says.** Added `@typescript/native-preview` at exactly `7.0.0-dev.20260707.2` (no caret) to the root `package.json` devDependencies, and replaced `tsc` with `tsgo` in all 12 `typecheck` scripts, keeping every flag and `-p` project. pnpm puts the root bin on the path for workspace scripts, verified before editing the rest: `pnpm --filter @zilar/server exec tsgo --version` -> `Version 7.0.0-dev.20260707.2`. No package differed from `tsc`, so every package keeps `tsgo`.

**Tests.** No test file is in this task's Allowed files (only the `package.json`s, `pnpm-lock.yaml` and this task file), and neither finding names a test, so no test was added or adjusted. The behaviour is verified by running each package's exact `typecheck` command under both compilers and by the full forced Turbo run below.

**Comparison, `tsc 6.0.3` vs `tsgo 7.0.0-dev.20260707.2`** (one invocation after the other, real seconds from `/usr/bin/time -p`, all values even though one is a warm-cache run):

| Package | Project | tsc 6.0.3 s | tsgo s | Exit / errors |
| --- | --- | --- | --- | --- |
| apps/mobile | `--noEmit` | 5.47 | 1.28 | 0 / 0 both |
| apps/runner | `--noEmit` | 3.72 | 0.92 | 0 / 0 both |
| apps/server | `--noEmit` | 5.76 | 1.24 | 0 / 0 both |
| apps/site | `-p tsconfig.json` | 1.02 | 0.35 | 0 / 0 both |
| apps/web | `-p tsconfig.json` | 5.63 | 1.03 | 0 / 0 both |
| apps/web | `-p tsconfig.node.json` | 0.64 | 0.31 | 0 / 0 both |
| packages/devtools | `--noEmit` | 1.52 | 0.43 | 0 / 0 both |
| packages/agent-drivers | `--noEmit` | 1.09 | 1.27 | 0 / 0 both |
| packages/chat-core | `--noEmit` | 0.97 | 0.36 | 0 / 0 both |
| packages/protocol | `--noEmit` | 0.80 | 0.32 | 0 / 0 both |
| packages/ui-tokens | `--noEmit` | 0.40 | 0.27 | 0 / 0 both |
| packages/runner-tunnel | `--noEmit` | 0.98 | 0.32 | 0 / 0 both |
| packages/xmpp-core | `--noEmit` | 1.16 | 0.43 | 0 / 0 both |
| packages/xmpp-core | `-p tsconfig.integration.json` | 1.99 | 0.56 | 0 / 0 both |

No package produced a difference (same exit code, same 0 errors, all flags and `-p` projects accepted). `apps/agent-drivers` was the one row where `tsgo` (1.27s) was slower than `tsc` (1.09s) on this measurement; every other row is faster. This is a timing wobble, not a result difference, so the package still uses `tsgo`.

**Commands run (real results):**
- `pnpm install`: clean; only the pre-existing `@types/react` peer warning. Added `@typescript/native-preview 7.0.0-dev.20260707.2`.
- `pnpm --filter @zilar/server exec tsgo --version`: `Version 7.0.0-dev.20260707.2`.
- The 14 `tsc` / `tsgo` pairs above: all exit 0, 0 errors.
- `pnpm exec turbo run typecheck --force --concurrency=2`:
  ```
   Tasks:    12 successful, 12 total
  Cached:    0 cached, 12 total
    Time:    5.572s
  ```
- `pnpm gate`:
  ```
  gate: 15 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (17.6s)
  PASS  lint  (0.9s)
  PASS  typecheck  (10.4s)
  SKIP tests @zilar/<every package> (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- No package test file was run individually (this task changes no source).

### Disagreements
None.

### Round 2
The Spec was rewritten (commit "spec now TypeScript 7.0.2"), so the fix round's changes were wrong. Restored the TS 7.0.2 state per the updated Spec:
- Reverted my two fix-round commits: `git revert --no-edit 5baaa69c 01635d6d` (clean, no `pnpm-lock.yaml` conflict).
- `git diff 7f2dbc30 -- '*package.json'` is empty; `git grep -n "native-preview\|tsgo" -- '*.json'` finds nothing.
- State: root `typescript` is `7.0.2`; `apps/mobile` has `typescript` = `npm:@typescript/typescript6@6.0.2` and `@typescript/native` = `npm:typescript@7.0.2`. `pnpm exec tsc --version` -> `7.0.2`; `pnpm --filter @zilar/mobile exec tsc --version` -> `7.0.2`; `pnpm --filter @zilar/mobile exec tsc6 --version` -> `6.0.3`.

**Commands run (real results):**
- `pnpm install`: clean; only the pre-existing `@types/react` peer warning.
- `pnpm exec turbo run typecheck --force --concurrency=2`:
  ```
   Tasks:    12 successful, 12 total
  Cached:    0 cached, 12 total
    Time:    5.27s
  ```
- `pnpm gate`:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (13.9s)
  PASS  lint  (0.6s)
  PASS  typecheck  (0.7s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- No package test file was run individually (this task changes no source).

## Review (written by Claude)

Approved by the lead, 2026-10-09. TypeScript is now 7.0.2, the stable native compiler, at the root. `apps/mobile` keeps the TS 6 API for Expo through `@typescript/typescript6@6.0.2`; its `tsc` resolves to the native 7.0.2 through `@typescript/native`. I checked that no native-preview or tsgo remains and that the package.json files match 7f2dbc30. The forced typecheck passed in 12 of 12 packages in 5.27s. The pre-review nit (the tsc6 bin reports 6.0.3 while its package says 6.0.2) is an upstream packaging quirk, so I accepted it. Round 1 lesson: the autofix undid the redirect because the Spec was stale (now a pitfall in LEAD_HANDOFF.md).

**2026-10-09, lead:** approved.
- **Pre-review:** clean. The packet head is 8b46d4ae, the current HEAD.
- **Result:**
  - `typescript` is 7.0.2 (native `tsc`) at the root;
  - apps/mobile uses the official pair: `typescript` = typescript6 for Expo's `@expo/require-utils`, which needs `transpileModule`, and `@typescript/native` = 7.0.2 for its typecheck;
  - every package gives the same 0 errors and is 2-5x faster;
  - no other code imports the TS API.
- **Follow-up:** the next `pnpm phone:smoke` confirms the Expo build on the alias. No full Expo build was run here.
- **Note:** the first fix round reverted the work, because the pre-reviewer read the old native-preview spec. The lead rewrote the spec and the worker restored it.

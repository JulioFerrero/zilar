---
id: T-0965
title: "Size split T16: packages/devtools/src/lead/policy.ts (1,111 lines) into lead/policy/{types,shell-parse,rm,curl,filters,rules,classify}.ts, the old path a barrel"
status: merged
milestone: M5
branch: task/T-0965-split-lead-policy
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0965: Split `lead/policy.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `packages/devtools/src/lead/policy.ts` is 1,111 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

This file decides which worker shell commands the autopilot approves on its own. It is security code, and no test covers it.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.1 #12 (task T16): `lead/policy/types.ts`, `lead/policy/shell-parse.ts`, `lead/policy/rm.ts`, `lead/policy/curl.ts`, `lead/policy/filters.ts`, `lead/policy/rules.ts`, `lead/policy/classify.ts`, under `packages/devtools/src/`. `lead/policy.ts` becomes the barrel.

- **Moved byte-identical.** Skip the entry's Dedup (`insideOwnWorktree`): no logic changes in this file, not even a dedup.
- **Prove it in the Report:** for every moved function, a `diff` of the old range against its new home, allowing only the added `export` keyword and import lines.
- **One behaviour run:** a throwaway script, deleted before the commit, that imports the barrel and classifies about 15 sample commands. Run it on main and on the branch, and show both outputs side by side. Use the sample commands from this session's autopilot log: `ls`, `pnpm gate`, `git status`, `rm -rf node_modules`, a `curl` to localhost, `curl` to an outside host, `pnpm dlx jscpd@4 …`, `git push`, `node -e …`, `sed -i …`, `mktemp -d …`, `cat file | grep x`, `npx prettier --write x`, `git merge main`, `cd .. && rm -rf x`. The outputs must be identical.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.1 #12, and `packages/devtools/src/lead/policy.ts`.

### Allowed files
`packages/devtools/src/lead/policy.ts`, `packages/devtools/src/lead/policy/types.ts`, `packages/devtools/src/lead/policy/shell-parse.ts`, `packages/devtools/src/lead/policy/rm.ts`, `packages/devtools/src/lead/policy/curl.ts`, `packages/devtools/src/lead/policy/filters.ts`, `packages/devtools/src/lead/policy/rules.ts`, `packages/devtools/src/lead/policy/classify.ts`, `work/T-0965-split-lead-policy.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.
- The Report also has the range diffs and the identical classification outputs.

---

## Report (written by the worker when done)

### What I did

Split `packages/devtools/src/lead/policy.ts` (1,111 lines on main) into the seven
files of `docs/audit/size-plan.md` §2.1 #12, under
`packages/devtools/src/lead/policy/`. `policy.ts` is now a 2-line barrel that
re-exports the same eight names, with the same kinds, that it exported before.
Code was moved byte-identical. The entry's Dedup (`insideOwnWorktree`,
`mentionsForbiddenDotfile`) was **skipped** on purpose, as the spec says.

No importer changed: `lead/decide.ts` (`classifyPermission`, `type PermissionRequest`)
and `lead/session.ts` (`extractCommands`) still import from `./policy.js` and the
barrel keeps them working. `lead/policy.ts` used only the package's own files.

### Files changed

- `packages/devtools/src/lead/policy.ts` — barrel (was the 1,111-line source).
- `packages/devtools/src/lead/policy/types.ts` — new.
- `packages/devtools/src/lead/policy/shell-parse.ts` — new.
- `packages/devtools/src/lead/policy/rm.ts` — new.
- `packages/devtools/src/lead/policy/curl.ts` — new.
- `packages/devtools/src/lead/policy/filters.ts` — new.
- `packages/devtools/src/lead/policy/rules.ts` — new.
- `packages/devtools/src/lead/policy/classify.ts` — new.
- `work/T-0965-split-lead-policy.md` — this Report and the status change.

### Sizes (`wc -l`) — split-rules item 8

| File | Lines |
| --- | ---: |
| `packages/devtools/src/lead/policy.ts` (old, main) | 1,111 |
| `packages/devtools/src/lead/policy.ts` (barrel now) | 2 |
| `.../policy/types.ts` | 42 |
| `.../policy/shell-parse.ts` | 212 |
| `.../policy/rm.ts` | 119 |
| `.../policy/curl.ts` | 302 |
| `.../policy/filters.ts` | 104 |
| `.../policy/rules.ts` | 201 |
| `.../policy/classify.ts` | 162 |

Every new file and the barrel are well under 400 lines.

### Export list before / after — split-rules item 8

Before (`grep -nE '^export'` on main `policy.ts`):

```
4:export type Verdict = 'allow' | 'reject' | 'escalate';
6:export interface Classification {
12:export interface PermissionRequest {
22:export interface PolicyContext {
1058:export function allowAllEnabled(env: Record<string, string | undefined> = process.env): boolean {
1062:export function classifyPermission(request: PermissionRequest, ctx: PolicyContext): Classification {
1094:export function extractCommands(resources: unknown): string[] {
1109:export function tmpdir(): string {
```

After (barrel `policy.ts`):

```
1:export { allowAllEnabled, classifyPermission, extractCommands, tmpdir } from './policy/classify.js';
2:export type { Classification, PermissionRequest, PolicyContext, Verdict } from './policy/types.js';
```

Same eight names, same kinds. The submodules additionally export the helpers that
were module-private before (so the other halves of the split can import them):
`types.ts` — `JULIO_SIMULATOR_UDIDS`, `SHELL_ACTION`, `Rule`; `shell-parse.ts` —
`normalize`, `splitSegments`, `stripEnvPrefix`, `firstWord`, `gitRest`,
`gitMatches`, `isBareShell`, `splitArgs`; `rm.ts` — `mentionsSecretEnv`,
`containsJulioUdid`, `classifyRmRf`; `curl.ts` — `isReadOnlyCurl`,
`isReadOnlyWget`; `filters.ts` — `hasHiddenEffects`, `FILTER_ALLOW`,
`isReadOnlySed`, `isRehearsalDocker`, `isRehearsalCurl`; `rules.ts` —
`REJECT_RULES`, `ALLOW_PATTERNS`, `GIT_ALLOW_PATTERN`. These are not re-exported
by the barrel, so the public surface is unchanged.

### Range diffs — old range vs its new home

Each module's old ranges were extracted from `git show main:.../policy.ts`
(`$S` below uses the main blob; note `policy.ts` is now the barrel). `diff <old-range> <new-file>`
keeping only changed lines, then a normalised diff with import lines removed and
the leading `export ` stripped. The normalised diff is **empty for all seven**,
so the only changes are the added `export` keyword and import lines.

```
=== diff old range -> policy/types.ts ===
< const JULIO_SIMULATOR_UDIDS = [
> export const JULIO_SIMULATOR_UDIDS = [
< const SHELL_ACTION = 'shell';
> export const SHELL_ACTION = 'shell';
< interface Rule {
> export interface Rule {
  normalised: IDENTICAL
=== diff old range -> policy/shell-parse.ts ===
< function normalize(command: string): string {
> export function normalize(command: string): string {
< function splitSegments(command: string): string[] {
> export function splitSegments(command: string): string[] {
< function stripEnvPrefix(segment: string): string {
> export function stripEnvPrefix(segment: string): string {
< function firstWord(segment: string): string {
> export function firstWord(segment: string): string {
< function gitRest(segment: string): string | null {
> export function gitRest(segment: string): string | null {
< function gitMatches(segment: string, pattern: RegExp): boolean {
> export function gitMatches(segment: string, pattern: RegExp): boolean {
< function isBareShell(segment: string): boolean {
> export function isBareShell(segment: string): boolean {
< function splitArgs(segment: string): string[] {
> export function splitArgs(segment: string): string[] {
  normalised: IDENTICAL
=== diff old range -> policy/rm.ts ===
> import path from 'node:path';
> 
> import { stripEnvPrefix } from './shell-parse.js';
> import { JULIO_SIMULATOR_UDIDS, type Classification, type PolicyContext } from './types.js';
> 
< function mentionsSecretEnv(segment: string): boolean {
> export function mentionsSecretEnv(segment: string): boolean {
< function containsJulioUdid(segment: string): boolean {
> export function containsJulioUdid(segment: string): boolean {
< function classifyRmRf(segment: string, ctx: PolicyContext): Classification | null {
> export function classifyRmRf(segment: string, ctx: PolicyContext): Classification | null {
  normalised: IDENTICAL
=== diff old range -> policy/curl.ts ===
< function isReadOnlyCurl(args: string[]): boolean {
> export function isReadOnlyCurl(args: string[]): boolean {
< function isReadOnlyWget(args: string[]): boolean {
> export function isReadOnlyWget(args: string[]): boolean {
  normalised: IDENTICAL
=== diff old range -> policy/filters.ts ===
> import { splitArgs, stripEnvPrefix } from './shell-parse.js';
> import type { PolicyContext } from './types.js';
> 
< function hasHiddenEffects(segment: string): boolean {
> export function hasHiddenEffects(segment: string): boolean {
< const FILTER_ALLOW =
> export const FILTER_ALLOW =
< function isReadOnlySed(segment: string): boolean {
> export function isReadOnlySed(segment: string): boolean {
< function isRehearsalDocker(segment: string): boolean {
> export function isRehearsalDocker(segment: string): boolean {
< function isRehearsalCurl(segment: string, ctx: PolicyContext): boolean {
> export function isRehearsalCurl(segment: string, ctx: PolicyContext): boolean {
  normalised: IDENTICAL
=== diff old range -> policy/rules.ts ===
> import { containsJulioUdid, mentionsSecretEnv } from './rm.js';
> import { gitMatches, isBareShell } from './shell-parse.js';
> import type { Rule } from './types.js';
> 
< const REJECT_RULES: Rule[] = [
> export const REJECT_RULES: Rule[] = [
< const ALLOW_PATTERNS: RegExp[] = [
> export const ALLOW_PATTERNS: RegExp[] = [
< const GIT_ALLOW_PATTERN =
> export const GIT_ALLOW_PATTERN =
  normalised: IDENTICAL
=== diff old range -> policy/classify.ts ===
> import os from 'node:os';
> import path from 'node:path';
> 
> import { isReadOnlyCurl, isReadOnlyWget } from './curl.js';
> import {
>   FILTER_ALLOW,
>   hasHiddenEffects,
>   isReadOnlySed,
>   isRehearsalCurl,
>   isRehearsalDocker,
> } from './filters.js';
> import { classifyRmRf } from './rm.js';
> import { ALLOW_PATTERNS, GIT_ALLOW_PATTERN, REJECT_RULES } from './rules.js';
> import {
>   firstWord,
>   gitRest,
>   normalize,
>   splitArgs,
>   splitSegments,
>   stripEnvPrefix,
> } from './shell-parse.js';
> import {
>   SHELL_ACTION,
>   type Classification,
>   type PermissionRequest,
>   type PolicyContext,
> } from './types.js';
> 
  normalised: IDENTICAL
```

### Behaviour run — classification on main vs branch

A throwaway `tsx` script (kept outside the repo, in the session temp dir, and
deleted) imported the barrel on the branch and the main `policy.ts` blob, and
classified the 15 sample commands with `ctx = { worktree: <repo root>, task: 'T-0965' }`.
Output, main vs branch:

```
CMD | MAIN | BRANCH
ls | {"verdict":"allow"} | {"verdict":"allow"} 
pnpm gate | {"verdict":"escalate"} | {"verdict":"escalate"} 
git status | {"verdict":"allow"} | {"verdict":"allow"} 
rm -rf node_modules | {"verdict":"allow"} | {"verdict":"allow"} 
curl http://localhost:3188/health | {"verdict":"allow"} | {"verdict":"allow"} 
curl https://example.com | {"verdict":"escalate"} | {"verdict":"escalate"} 
pnpm dlx jscpd@4 apps packages --min-lines 30 | {"verdict":"escalate"} | {"verdict":"escalate"} 
git push | {"verdict":"reject","message":"Pushing is the lead's job after review. Commit on your branch and set status: review."} | {"verdict":"reject","message":"Pushing is the lead's job after review. Commit on your branch and set status: review."} 
node -e "console.log(1)" | {"verdict":"escalate"} | {"verdict":"escalate"} 
sed -i "s/a/b/" file.ts | {"verdict":"escalate"} | {"verdict":"escalate"} 
mktemp -d /tmp/x.XXXX | {"verdict":"escalate"} | {"verdict":"escalate"} 
cat file | grep x | {"verdict":"allow"} | {"verdict":"allow"} 
npx prettier --write x | {"verdict":"reject","message":"No npx for tools this repo already has. From the repo root use: pnpm exec prettier --write <files>, pnpm lint, pnpm format:check, pnpm typecheck, and for tests only pnpm --filter <package> test --maxWorkers=2 <path>. Then continue."} | {"verdict":"reject","message":"No npx for tools this repo already has. From the repo root use: pnpm exec prettier --write <files>, pnpm lint, pnpm format:check, pnpm typecheck, and for tests only pnpm --filter <package> test --maxWorkers=2 <path>. Then continue."} 
git merge main | {"verdict":"reject","message":"Merging is the lead's job. Stay on your branch."} | {"verdict":"reject","message":"Merging is the lead's job. Stay on your branch."} 
cd .. && rm -rf x | {"verdict":"escalate"} | {"verdict":"escalate"} 
IDENTICAL: all 15 classifications match
```

Per AGENTS.md I ran no test file directly (there is no test for `policy.ts`; the
nearest tests are `lead/merge.test.ts` and `gate/gate.test.ts`, which `pnpm gate`
ran). I did run `pnpm exec prettier --write` on the eight files so the gate's
format check would pass.

### Gate — `pnpm gate` from the repo root

```
gate: 9 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (0.5s)
PASS  lint  (0.4s)
PASS  typecheck  (2.4s)
PASS  effect  (1.7s)
PASS  tests @zilar/devtools  (23.6s)
scope: every changed file is inside the Allowed files
GATE PASS
```

(The first run failed lint on one unused `PolicyContext` import in the new
`rules.ts`; I removed that import and re-ran to the pass above.)

### Deviations / notes

1. The plan left `isBareShell` (main lines 213–231) unassigned between the
   `shell-parse` range (169–211) and the `rm` range (233–307). It is a shell
   tokenizer, so I placed it in `shell-parse.ts` with `firstWord`/`splitArgs`.
2. The plan's `rm.ts` first range (`126–167`) overlapped the `gitRest` leading
   comment (`165–168`). I moved `126–163` into `rm.ts` and moved the comment with
   `gitRest` into `shell-parse.ts`, so nothing was duplicated or orphaned.
3. Effect ratchet: `packages/devtools/` is an exempt path in
   `effect-map/generate.ts`, so no new file needs the `// effect-plain:` marker.
   The gate's `effect` step passed.
4. The entry's Dedup was skipped exactly as the spec requires; that work is a
   separate F task.

No open questions, no blocked items.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `lead/policy.ts` (1,111 lines) becomes a barrel plus 7 files under `lead/policy/`, the largest `curl.ts` at 302.
- **The moved code is byte-identical:** the normalised range diff is IDENTICAL for all seven files.
- **The behaviour run:** all 15 sample commands classify the same on main and on the branch, including the rejections for `git push`, `npx` and `git merge`.
- **Note:** the running autopilot keeps the code it loaded at start; the split takes effect at its next restart.
- **Check:** the gate passed.

---
id: T-0272
title: "Tooling: pnpm install stops flipping the bufferutil/utf-8-validate peer entries in pnpm-lock.yaml"
status: merged
milestone: M5
branch: task/T-0272-lockfile-peer-flip
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0272: stable lockfile

## Spec (written by Claude, do not edit)

### Why
In most tasks, the worker's first `pnpm install` rewrites `pnpm-lock.yaml`, adding or removing two `transitivePeerDependencies` entries (`bufferutil`, `utf-8-validate`) under the `metro-runtime` area. Every worker then has to revert it by hand (`git checkout -- pnpm-lock.yaml`), and `lead merge` refuses when one forgets. `work/NOW.md` has recorded this since 2026-10-05: T-0203 added the entries and T-0204 removed them, so the result depends on the worktree's state.

### Verified facts (do not re-derive)
- `package.json` line 6: `"packageManager": "pnpm@10.32.1"`; the local pnpm is 10.32.1.
- `pnpm-lock.yaml` today has `bufferutil` / `utf-8-validate` peer entries around lines 6852-6877.
- The gate runs `pnpm install --frozen-lockfile` first (`PASS install (frozen)` in every gate summary), and it passes with or without the two entries.
- Workers' reports (T-0247, T-0250, T-0251, T-0258, T-0263, T-0265, T-0268) all describe the same two-line change after `pnpm install`.

### What to do
1. **Reproduce:** in this worktree, run `pnpm install` twice and record the lockfile diff after each run. Then delete `node_modules` (root and packages) and run `pnpm install` again, and record that diff too. Report exactly which lines change and when.
2. **Find the cause.** Look at:
   - the `ws` / `metro-runtime` optional peers;
   - `auto-install-peers`, `dedupe-peer-dependents` and `resolve-peers-from-workspace-root` in `.npmrc` or `pnpm-workspace.yaml`;
   - whether a hoisted or isolated `node_modules` state changes the peer resolution.
   Quote the pnpm docs or changelog you rely on.
3. **Fix, the smallest thing that makes a fresh install and a repeat install both leave the lockfile unchanged.** For example, pin the setting that decides it in `pnpm-workspace.yaml` or `.npmrc`, or add `peerDependencyRules` / `packageExtensions` for the two optional peers, then commit the resulting lockfile once. Prove it: after the fix, `pnpm install` run twice and once from an empty `node_modules` produces no lockfile diff, and `pnpm install --frozen-lockfile` passes.
4. Write a short note in `docs/LEAD_HANDOFF.md` under pitfalls: what the cause was and what to do if it comes back.

### Read first
`AGENTS.md`, `package.json`, `pnpm-workspace.yaml`, `.npmrc` (if present), `docs/LEAD_HANDOFF.md` (the pitfalls section).

### Allowed files
`pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `package.json`, `docs/LEAD_HANDOFF.md`, `work/T-0272-lockfile-peer-flip.md`.

### Checks
```bash
pnpm install --frozen-lockfile
pnpm gate
```

### Acceptance
- A fresh install and a repeat install both leave `pnpm-lock.yaml` unchanged, shown in the Report with real command output.
- No dependency version changes, other than what the fix strictly needs (list any in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
1. Reproduced the flip and traced its cause: pnpm 10 resolves peer dependencies **path-dependently** for packages inside a dependency cycle. `@react-native/metro-config` -> `metro-config` <-> `metro` (a cycle) -> `ws`, whose optional peers are `bufferutil` / `utf-8-validate`. Whether pnpm writes those two into `transitivePeerDependencies` depends on whether `node_modules` already exists, so the lockfile was a function of the install path, not of the graph.
2. Fixed it with a targeted `packageExtensions` entry in `pnpm-workspace.yaml` that declares the two as optional peers of `@react-native/metro-config`, and committed the resulting lockfile.

### Repro (pnpm 10.32.1, before the fix)
- `pnpm install` (1st) and `pnpm install` (2nd): `git diff pnpm-lock.yaml` empty.
- `rm -rf node_modules packages/*/node_modules apps/*/node_modules && pnpm install`: empty (lockfile stayed without the two entries).
- Reverse test: after manually adding the two entries, that same fresh install **removed** them again.
- `pnpm install --lockfile-only` (full re-resolution): **added** the two entries.
- A with/without-`node_modules` matrix confirmed the resolution output itself depends on the `node_modules` state, i.e. two code paths produced two different lockfiles. This is why plain `pnpm install` in a clean worktree looked stable while workers saw flips.

### Cause (quoted)
- pnpm 11.8 release notes: "Fixed lockfile churn where `transitivePeerDependencies` could be dropped or shifted when a package participates in a dependency cycle (#5108)."
- pnpm docs, "How peers are resolved" -> "Cyclic dependencies": the path-independent cycle cut is v12-only; "In pnpm v11, where the cut depends on the order the graph is walked, the same dependencies can produce different lockfiles depending on the order projects and dependencies are listed."
- Settings I tested that did **not** remove the state dependence (each checked with and without `node_modules`): `autoInstallPeers: false`, `dedupePeerDependents: false`, `resolvePeersFromWorkspaceRoot: false`, `optimisticRepeatInstall: false`, `peerDependencyRules.ignoreMissing`, `ignoredOptionalDependencies`, `overrides: {'ws>bufferutil': '-', ...}`, and `packageExtensions` on `ws`. pnpm 10.34.6 still churns. pnpm 11.8.0 does stop the churn but its `--frozen-lockfile` fails with `ERR_PNPM_IGNORED_BUILDS` (esbuild build scripts), so a toolchain major bump needs more work than this task allows.

### Fix
- `pnpm-workspace.yaml`: added a `packageExtensions` block (with a comment) declaring `bufferutil` and `utf-8-validate` as optional peers of `@react-native/metro-config`.
- `pnpm-lock.yaml`: one-time diff of **10 insertions, 0 deletions, no version changes**: `packageExtensionsChecksum` plus `peerDependencies` / `peerDependenciesMeta` on the `@react-native/metro-config@0.86.3` package entry.

### Proof (after the fix, pnpm 10.32.1; sha256 prefix of `pnpm-lock.yaml`)
```
first install:                        dab510e5c5f8
repeat install:                       dab510e5c5f8
install --lockfile-only (resolution): dab510e5c5f8
fresh install (empty node_modules):   dab510e5c5f8
install --frozen-lockfile:            PASS
```
All four installs leave the lockfile at the same hash; the two entries are now stable.

### Commands run
`pnpm install` (several), `pnpm install --lockfile-only`, `pnpm install --frozen-lockfile`, the settings matrix above, and finally `pnpm gate`:
```
gate: 4 changed file(s) against main
PASS  install (frozen)  (2.2s)
PASS  format  (40.4s)
PASS  lint  (1.9s)
PASS  typecheck  (1.3s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Files changed
- `pnpm-workspace.yaml` (the fix + one explanatory comment)
- `pnpm-lock.yaml` (10 insertions, no version changes)
- `docs/LEAD_HANDOFF.md` (pitfall note)
- `work/T-0272-lockfile-peer-flip.md` (this report + status)

### Notes / open question
- The `packageExtensions` declares two peers the package does not really have; both are `optional`, stay uninstalled and the lockfile shows no version changes. This is a deliberate, documented workaround for the pnpm resolver.
- Open question for the lead: keep this workaround, or schedule a pnpm 11.8+/12 upgrade (with the `onlyBuiltDependencies`/build-scripts config fix it needs) and then drop the extension? I chose the workaround because it is config-only and keeps the lockfile diff at 10 lines.

## Review (written by Claude)

**Verdict:** approved. The pre-review was clean, with no fix rounds. The fix touches config only:
- `packageExtensions` declares the two optional peers on `@react-native/metro-config`;
- the lockfile changes once: 10 added lines, no version changes.

**Proof:** the lockfile hash is the same after four install paths: first install, repeat install, `--lockfile-only` and a fresh install. `--frozen-lockfile` passes.

**Caveat:** the lead has not checked the pnpm 11.8 / v12 changelog and docs quotes. Treat the "drop after pnpm >= 11.8" note in `docs/LEAD_HANDOFF.md` as a lead to verify when we upgrade pnpm.

**Answer to the worker's question:** keep the workaround. A pnpm major upgrade is a separate task, later.

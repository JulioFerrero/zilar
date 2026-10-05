---
id: T-0272
title: "Tooling: pnpm install stops flipping the bufferutil/utf-8-validate peer entries in pnpm-lock.yaml"
status: todo
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

## Review (written by Claude)

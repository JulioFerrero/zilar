---
id: T-0965
title: "Size split T16: packages/devtools/src/lead/policy.ts (1,111 lines) into lead/policy/{types,shell-parse,rm,curl,filters,rules,classify}.ts, the old path a barrel"
status: todo
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

## Review (written by Claude)

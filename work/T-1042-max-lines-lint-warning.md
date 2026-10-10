---
id: T-1042
title: "Lint: oxlint max-lines warning at 400 for source files; tests, mocks, the emoji table and .d.ts files are off"
status: todo
milestone: M5
branch: task/T-1042-max-lines-lint-warning
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.1 day
---

# T-1042: The 400-line lint warning

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file. Most of the size-plan splits are merged, so the remaining files over 400 should show up in every lint run. That keeps the list from growing again. The plan is `docs/audit/size-plan.md` §3, which verified that oxlint 1.85 has `max-lines`. A warning does not fail `pnpm lint` (`package.json:14`, `oxlint .`) or the gate's lint step (`packages/devtools/src/gate/plan.ts:144`).

### What to build
Only `.oxlintrc.json` changes. Keep everything in it and add the following.

1. A top-level `"rules"` object: `"max-lines": ["warn", { "max": 400, "skipBlankLines": false, "skipComments": false }]`.
2. One more entry in the existing `"overrides"` array that sets `"max-lines": "off"` for test and generated files:
   - `**/*.test.ts`, `**/*.test.tsx`, `**/*.spec.ts`, `**/*.spec.tsx`;
   - `**/*.test-harness.ts`, `**/test-support.ts`, `**/test-support/**`;
   - `**/*.d.ts`.
3. One more entry that sets `"max-lines": "off"` for mocks and data:
   - `apps/mobile/src/mock/**` and `packages/mock-backend/**`;
   - `apps/mobile/src/store/chat-store.ts`, which the mock rebuild replaces;
   - `apps/mobile/src/lib/emoji-data.ts`, a hand-kept emoji table.
4. Leave the existing `apps/mobile/src/app/**/*.tsx` `react/rules-of-hooks` override as it is.

### Read first
`AGENTS.md`, `docs/audit/size-plan.md` §3, and `.oxlintrc.json`.

### Allowed files
`.oxlintrc.json`, `work/T-1042-max-lines-lint-warning.md`.

### Checks
```bash
pnpm lint
pnpm gate
```

### Acceptance
- `pnpm lint` exits 0.
- The Report pastes the `max-lines` warning lines. Each file named is a source file over 400 lines (`wc -l`), and no test, mock or `emoji-data.ts` file appears among them.
- The Report also gives the count of those warnings.

---

## Report (written by the worker when done)

## Review (written by Claude)

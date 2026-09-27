---
id: T-0012
title: Tooling cleanups from the T-0001 review
status: todo
milestone: M0
branch: task/T-0012-tooling-cleanups
model: deepseek/deepseek-v4-flash
depends_on: [T-0001]
estimate: 1–2 hours
---

# T-0012: Tooling cleanups from the T-0001 review

## Spec (written by Claude, do not edit)

### Goal
Fix the small tooling issues found in the review of T-0001 (see the Review section of `work/T-0001-monorepo.md`, findings 1–4 and 6). No behaviour changes.

### Read first
- `AGENTS.md` (mandatory)
- `work/T-0001-monorepo.md`, the **Review** section

### Allowed files
- Root `package.json` (only the `@types/node` version) and `pnpm-lock.yaml`
- `apps/web/package.json`, `apps/web/tsconfig.json`, new `apps/web/tsconfig.node.json`
- `.github/workflows/ci.yml`
- `.prettierignore`

### Steps
1. **`@types/node` to match Node 24.** In the root `package.json`, change `@types/node` to `^24` (the latest 24.x) and reinstall.
2. **Split the web tsconfig:**
   - `apps/web/tsconfig.json`:
     - `include: ["src"]`
     - `lib: ["ES2023", "DOM", "DOM.Iterable"]`
     - `jsx: "react-jsx"`
     - `types: ["vite/client"]`, with **no `node`**
   - `apps/web/tsconfig.node.json`:
     - extends the base
     - `include: ["vite.config.ts"]`
     - `types: ["node"]`
   - Update the web `typecheck` script to check both: `tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json`.
   - **Prove the split works** before reverting the probe: temporarily add `const x = process.env;` in `src/App.tsx`, confirm `typecheck` now **fails**, then remove it. Describe this in the Report.
3. **Declare the testing peer.** Add `@testing-library/dom` (latest) as a devDependency of `@galena/web`.
4. **CI runs once per PR.** In `ci.yml`, change the trigger to:
   ```yaml
   on:
     push:
       branches: [main]
     pull_request:
   ```
5. **`.prettierignore` comment.** Replace the first comment block with:
   `# Hand-formatted documents (plans, specs, reports). Permanently excluded: reflowing them creates noisy diffs.`
   Keep the same four entries under it.

### Acceptance criteria
- [ ] `@types/node` resolves to 24.x in the lockfile.
- [ ] The web typecheck covers both tsconfigs and fails on `process` usage inside `src/` (the probe is described in the Report and removed).
- [ ] `@testing-library/dom` is an explicit devDependency of `@galena/web`.
- [ ] CI triggers on push to `main` and on pull requests only.
- [ ] All checks pass.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### Out of scope
- Anything else, including T-0002's infra work. **This task must be merged before T-0002 starts,** because both touch the root `package.json` and `pnpm-lock.yaml`.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

---

## Review (written by Claude)

**Verdict:**

### Findings
-

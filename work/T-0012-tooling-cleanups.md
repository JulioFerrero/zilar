---
id: T-0012
title: Tooling cleanups from the T-0001 review
status: merged
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

1. **`@types/node` to Node 24.** Changed the root `package.json` devDependency from `"@types/node": "^26.6.3"` to `"@types/node": "^24"` and reinstalled. `pnpm install` resolved it to **24.19.0**, the latest 24.x at the time (2026-09-27).
2. **Split the web tsconfig.**
   - `apps/web/tsconfig.json`: `include: ["src"]`, `lib: ["ES2023", "DOM", "DOM.Iterable"]`, `jsx: "react-jsx"`, `types: ["vite/client"]` (no `node`).
   - New `apps/web/tsconfig.node.json`: extends `../../tsconfig.base.json`, `include: ["vite.config.ts"]`, `types: ["node"]`.
   - `apps/web/package.json` `typecheck` is now `tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json`.
   - **Probe:** temporarily added `const x = process.env;` to `apps/web/src/App.tsx`. `pnpm --filter @galena/web typecheck` then failed with:
     ```
     src/App.tsx(4,9): error TS6133: 'x' is declared but its value is never read.
     src/App.tsx(4,13): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
     ```
     Removed the line; `git diff -- apps/web/src/App.tsx` is empty and the typecheck passes again. This proves `process` is no longer typed in `src/`.
3. **Declared the testing peer.** Added `@testing-library/dom@^10.4.2` (latest, and it satisfies `@testing-library/react` 16.3.3's `^10` peer range) as a devDependency of `@galena/web`.
4. **CI runs once per PR.** `.github/workflows/ci.yml` now triggers only on `push` to `main` and on `pull_request`.
5. **`.prettierignore` comment.** Replaced the first two-line comment block with the exact single line requested; the four entries (`AGENTS.md`, `README.md`, `docs/`, `work/`) and the rest of the file are unchanged.
6. Ran `pnpm exec prettier --write` on the two new/changed tsconfig files because `format:check` flagged them; their content still matches the spec exactly.

### Files changed

- `package.json` (root): `@types/node` `^26.6.3` → `^24` (only that line).
- `pnpm-lock.yaml`: re-resolved `@types/node` to 24.19.0 and added `@testing-library/dom@10.4.2`.
- `apps/web/package.json`: `typecheck` script; added `@testing-library/dom` devDependency.
- `apps/web/tsconfig.json`: `include: ["src"]`, `types: ["vite/client"]`.
- `apps/web/tsconfig.node.json`: new file.
- `.github/workflows/ci.yml`: `push.branches: [main]`.
- `.prettierignore`: first comment block.
- `work/T-0012-tooling-cleanups.md`: status + this Report.

### Commands run and real results

- `pnpm install` → PASS. Resolved `@types/node` 24.19.0 (`-@types/node 26.6.3` / `+@types/node 24.19.0`).
- `pnpm install --frozen-lockfile` → PASS ("Lockfile is up to date, resolution step is skipped").
- `pnpm format:check` → PASS ("All matched files use Prettier code style!").
- `pnpm lint` → PASS ("Found 0 warnings and 0 errors", 12 files, 127 rules).
- `pnpm typecheck` → PASS (turbo "3 successful, 3 total"; web runs both tsconfigs: `tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json`).
- `pnpm test` → PASS (turbo "3 successful, 3 total": protocol 6 tests / 1 file, server 2 tests / 1 file, web 3 tests / 1 file).
- `pnpm build` → PASS (turbo "1 successful, 1 total"; web `vite build`: `index.html` 0.39 kB, CSS 6.19 kB, JS 303.85 kB).
- Probe (before/after): `pnpm --filter @galena/web typecheck` failed with TS2591 `Cannot find name 'process'` with the probe present; passed after removal.
- `.github/workflows/ci.yml` parsed with Ruby `YAML.safe_load`: `on` resolves to `{"push" => {"branches" => ["main"]}, "pull_request" => nil}` (the `nil` is the YAML 1.1 `on`→`true` key quirk, not an error).
- `git status` / `git diff`: only the allowed files above; `apps/web/src/App.tsx` has no diff.

### Problems, deviations from the spec, open questions

1. **The lockfile still contains a transitive `@types/node@26.6.3`.** `pnpm why -r @types/node` shows two versions: `24.19.0` (root devDependency, and what vitest uses) and `26.6.3` for `vite@8.3.1 peer` under `apps/web` (`vite`, `@tailwindcss/vite`, `@vitejs/plugin-react`). This is pnpm's default `autoInstallPeers: true` auto-installing the *latest* `@types/node` to satisfy vite's optional peer in the web package; `apps/web` does not declare `@types/node` itself, so it does not dedupe to the root's 24.x. I confirmed it is not a stale entry: `pnpm dedupe` reports "Already up to date", and deleting `pnpm-lock.yaml` and re-running `pnpm install --lockfile-only` produced a byte-identical lockfile. The root dependency and the web typecheck both use 24.19.0 (the web `tsconfig.node.json` `types: ["node"]` resolves `@types/node` from the root, since `apps/web/node_modules/@types` has no `node`), so no Node 26-only types are in play for the web code. Fully collapsing the lockfile to a single 24.x would require either declaring `@types/node` in `apps/web` or a `pnpm.overrides` entry — both outside the steps/"only the `@types/node` version" limit of this task, so I did not do either. **Question:** do you want the web tooling peer pinned too (e.g. `@types/node` added to `apps/web`), or is the root pin enough?
2. **`@types/node` specifier is literally `^24`** (as the spec asked phrase-for-phrase), rather than a full `^24.19.0` like the other entries. The lockfile pins 24.19.0.
3. **`pnpm exec prettier --write` on `apps/web/tsconfig.json` and `apps/web/tsconfig.node.json`** was needed for `format:check` to pass; this only touched whitespace/EOF newline in those two allowed files.
4. No behaviour changes; no dependencies added beyond the two the spec lists (`@types/node` version bump and `@testing-library/dom`).


---

## Review (written by Claude)

**Verdict: approved.** Merged by Claude with Julio's standing authorization.

### What I verified myself (on commit 6a7cadd)
- `pnpm install --frozen-lockfile`, `format:check`, `lint`, `typecheck`, `test` (6 + 2 + 3) and `build`: all PASS.
- An independent probe: adding a new file in `apps/web/src/` that uses `process.env` makes `pnpm --filter @galena/web typecheck` fail. So the tsconfig split works. Probe removed.
- The diff touches only allowed files, and the Spec section is unchanged.

### Findings
1. **(accepted) All five steps were done exactly as specified.** The report is precise and includes the before and after probe.
2. **(answer to open question 1)** The transitive `@types/node@26` comes from vite's optional peer, which pnpm auto-installs in `apps/web`. It doesn't affect our code, but we want a single version across the repo, so we'll add a workspace-wide override `@types/node: ^24` in `pnpm-workspace.yaml` (`overrides:`). This is folded into **T-0011**, which edits `pnpm-workspace.yaml` for Expo anyway.
3. **(accepted)** The literal `^24` specifier is fine, since the lockfile pins 24.19.0.
4. **(note)** Running `prettier --write` on the two tsconfigs was the right move.

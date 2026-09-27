---
id: T-0001
title: Monorepo scaffold (pnpm + Turborepo, TypeScript strict, lint, tests, CI)
status: todo
milestone: M0
branch: task/T-0001-monorepo
model: deepseek/deepseek-v4-pro
depends_on: []
estimate: 1 day
---

# T-0001: Monorepo scaffold

## Spec (written by Claude, do not edit)

### Goal
Create the empty but working monorepo that every later task builds on. Specifically:
- a root pnpm workspace with Turborepo
- strict TypeScript
- linting and formatting
- tests
- a GitHub Actions CI

Add three real, minimal packages so the tooling is proven end to end:
- `@galena/protocol`: shared zod schemas
- `@galena/server`: a Hono API with a health endpoint
- `@galena/web`: a Vite + React page

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md`:
  - §17 Tech stack
  - §18 Repository layout
  - §9.5 Delegation (the handoff JSON you will turn into a zod schema)

### Allowed files
Create or edit only these:
- `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.nvmrc`, `.editorconfig`, `.prettierrc.json`, `.prettierignore`, `.oxlintrc.json`, `pnpm-lock.yaml`
- `.github/workflows/ci.yml`
- `packages/protocol/**`
- `apps/server/**`
- `apps/web/**`
- `README.md`, only the `## Development` section

Do not create `apps/mobile`, `apps/runner` or `infra`. Those are separate tasks.

### Tooling decisions (already made, follow them)
| Thing | Choice |
|---|---|
| Node | 24 LTS (`.nvmrc` = `24`). Root `engines.node` = `>=24` |
| Package manager | pnpm 10. Root `packageManager` field set to the installed version (`pnpm --version`, currently 10.32.1) |
| Monorepo runner | Turborepo 2.x |
| TypeScript | Latest stable 5.x/6.x. `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `moduleResolution: "bundler"`, `module: "ESNext"`, `target: "ES2023"`, `skipLibCheck`, `isolatedModules` |
| Lint | **oxlint**, config in `.oxlintrc.json`, with the default correctness rules plus the `typescript` and `react` plugins |
| Format | **Prettier**: 2 spaces, single quotes, semicolons, trailing commas `all`, print width 100 |
| Tests | **Vitest**, per package |
| Modules | ESM everywhere (`"type": "module"`) |
| Package names | `@galena/<name>`. All packages `"private": true` |

### Allowed dependencies
Use the latest stable version of each at install time, and record the versions you got in the Report.
- **Root dev dependencies:** `turbo`, `typescript`, `oxlint`, `prettier`, `vitest`, `@types/node`
- **`@galena/protocol`:** `zod` (v4)
- **`@galena/server`:** `hono`, `@hono/node-server`. Dev: `tsx`
- **`@galena/web`:**
  - `react`, `react-dom`
  - dev: `vite`, `@vitejs/plugin-react`, `tailwindcss` (v4), `@tailwindcss/vite`, `@types/react`, `@types/react-dom`, `jsdom`, `@testing-library/react`

Nothing else. If you believe something else is required, explain it in the Report.

### Steps and hints
1. **Root.**
   - `package.json` with scripts:
     - `dev: turbo dev`
     - `build: turbo build`
     - `typecheck: turbo typecheck`
     - `lint: oxlint .`
     - `format: prettier --write .`
     - `format:check: prettier --check .`
     - `test: turbo test`
   - `pnpm-workspace.yaml` with `apps/*` and `packages/*`.
   - `turbo.json`:
     - tasks `build` (with `dependsOn: ["^build"]`), `dev` (`cache: false`, `persistent: true`), `typecheck`, `test`
     - outputs: `dist/**` for build
2. **`packages/protocol`.**
   - `src/handoff.ts`: a zod schema `HandoffSchema` and its type `Handoff`, matching the JSON in plan §9.5:
     - `task_id`, `from`, `to`, `objective`, `context_summary`, `acceptance`, `constraints`, `artifacts`, `budget`, `return_format`, `reply_to`
     - `from`/`to` are JIDs: a non-empty string containing `@`
     - `artifacts[].kind` is one of `message | screenshot | pr | preview | file | report`
     - `budget` is `{ currency: 'EUR' | 'USD', max: positive number }`
     - `context_summary` has a max of 2000 characters
   - `src/index.ts` re-exports it.
   - Tests:
     - the plan's example parses
     - a missing `objective` fails
     - a negative budget fails
     - an unknown artifact kind fails
     - a `from` without `@` fails
   - Scripts: `typecheck` (`tsc --noEmit`), `test` (`vitest run`).
   - Other packages consume it from source (point `exports` at `./src/index.ts`), so no build step is needed yet.
3. **`apps/server`.**
   - `src/app.ts` exports a Hono `app` with `GET /health` returning `{ ok: true, name: 'galena-server', version }`. The version comes from package.json.
   - `src/index.ts` starts it with `@hono/node-server` on `PORT`, defaulting to 3000.
   - Test with `app.request('/health')`, without starting a real server.
   - Scripts: `dev` (`tsx watch src/index.ts`), `typecheck`, `test`.
4. **`apps/web`.**
   - Vite + React + Tailwind 4, using the `@tailwindcss/vite` plugin and `@import "tailwindcss";` in the CSS.
   - The page shows the word **Galena** centered, with a one-line subtitle "People and AIs, together." Use Tailwind classes.
   - The dark background comes from the system color scheme (`prefers-color-scheme`).
   - Test with Vitest + jsdom + Testing Library: it renders "Galena".
   - Scripts: `dev`, `build`, `typecheck`, `test`.
5. **CI** in `.github/workflows/ci.yml`:
   - Triggers on push and pull_request.
   - `pnpm/action-setup`, `actions/setup-node` with `node-version-file: .nvmrc` and pnpm cache.
   - Steps: `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
6. **README `## Development`.** Prerequisites (Node 24, pnpm 10), install, dev, and the check commands.

### Acceptance criteria
- [ ] `pnpm install` works on a clean clone and produces `pnpm-lock.yaml`.
- [ ] `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` all pass.
- [ ] `HandoffSchema` has at least the 5 tests listed, all passing.
- [ ] `pnpm --filter @galena/server dev` runs, and `curl localhost:3000/health` returns the JSON above.
- [ ] `pnpm --filter @galena/web dev` shows the Galena page.
- [ ] `apps/server` and `apps/web` both import something from `@galena/protocol`, to prove workspace linking. For example, the server's health handler can include `protocolVersion`, exported by the protocol package.
- [ ] No `any`, no `@ts-ignore`, no secrets, no files outside "Allowed files".
- [ ] The CI workflow is valid YAML and uses only the steps above.

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
- Mobile app, runner, infra and docker-compose (later tasks).
- shadcn/ui setup, routing, auth, database (later tasks).
- Publishing packages or Docker images.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Dependency versions installed
-

### Commands run and real results
- `pnpm test`:

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
-

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-

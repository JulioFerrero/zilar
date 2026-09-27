---
id: T-0001
title: Monorepo scaffold (pnpm + Turborepo, TypeScript strict, lint, tests, CI)
status: approved
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

- Root scaffold: pnpm 10 workspace (`apps/*`, `packages/*`) + Turborepo 2 (`build` with `^build` and `dist/**` outputs, `dev` uncached/persistent, `typecheck`, `test`), strict shared `tsconfig.base.json`, Prettier, oxlint, Vitest, `.nvmrc` = 24, `.editorconfig`.
- `@galena/protocol`: `HandoffSchema` matching plan §9.5 (all 11 fields, JIDs contain `@`, artifact kinds enum, `EUR|USD` budget with positive `max`, `context_summary` ≤ 2000), the `Handoff` type, `protocolVersion`, and 6 tests (the 5 required cases + the 2000-character boundary). Consumed from source through `exports: "./src/index.ts"`.
- `@galena/server`: Hono app with `GET /health` → `{ ok, name, version, protocolVersion }` (version read from apps/server/package.json at runtime without any cast), Node entry point via `@hono/node-server` with a validated `PORT`, tests through `app.request()` (no real server).
- `@galena/web`: Vite + React 19 + Tailwind 4 (`@tailwindcss/vite` + `@import 'tailwindcss'`), centered "Galena" page, subtitle "People and AIs, together.", dark colors driven by `prefers-color-scheme` (`dark:` variant), plus the `protocolVersion` line from `@galena/protocol`; 3 Testing Library tests on jsdom.
- `.github/workflows/ci.yml` (format, lint, typecheck, test, build) and the README `## Development` section.

### Files changed

- Root: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.nvmrc`, `.editorconfig`, `.prettierrc.json`, `.prettierignore`, `.oxlintrc.json`, `pnpm-lock.yaml`, `.github/workflows/ci.yml`, `README.md` (`## Development` only).
- `packages/protocol`: `package.json`, `tsconfig.json`, `src/index.ts`, `src/handoff.ts`, `src/version.ts`, `src/handoff.test.ts`.
- `apps/server`: `package.json`, `tsconfig.json`, `src/index.ts`, `src/app.ts`, `src/version.ts`, `src/app.test.ts`.
- `apps/web`: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/App.test.tsx`.
- `work/T-0001-monorepo.md` (status + this Report).

### Dependency versions installed

- Root devDeps: turbo 2.11.4, typescript 6.0.3, oxlint 1.85.0, prettier 3.9.9, vitest 5.0.2, @types/node 26.6.3.
- `@galena/protocol`: zod 4.6.5.
- `@galena/server`: hono 4.13.9, @hono/node-server 2.1.1, tsx 4.23.15 (dev).
- `@galena/web`: react 19.3.0, react-dom 19.3.0; dev: vite 8.3.1, @vitejs/plugin-react 6.1.1, tailwindcss 4.3.3, @tailwindcss/vite 4.3.3, @types/react 19.3.0, @types/react-dom 19.3.0, jsdom 30.1.1, @testing-library/react 16.3.3.
- Toolchain: pnpm 10.32.1, Node 24.14.0.

### Commands run and real results

- `pnpm install --frozen-lockfile`: PASS. The same command plus the five checks below were re-run in a copy of the tree with `node_modules`/`.git` excluded (clean-clone simulation): everything PASS there too.
- `pnpm format:check`: PASS — "All matched files use Prettier code style!".
- `pnpm lint`: PASS — "Found 0 warnings and 0 errors" (12 files, 127 rules).
- `pnpm typecheck`: PASS — turbo "3 successful, 3 total" (protocol, server, web).
- `pnpm test`: PASS — turbo "3 successful, 3 total": protocol 6 tests / 1 file, server 2 tests / 1 file, web 3 tests / 1 file.
- `pnpm build`: PASS — turbo "1 successful, 1 total": web `vite build` → `dist/index.html` 0.39 kB, CSS 6.19 kB, JS 303.85 kB.
- `PORT=3100 pnpm --filter @galena/server dev` + `curl -s localhost:3100/health` → `{"ok":true,"name":"galena-server","version":"0.1.0","protocolVersion":"0.1.0"}`.
- `PORT=3100 pnpm dev` (turbo): server log "galena-server listening on http://localhost:3100", web `HTTP 200` on 5173, processes stopped afterwards.
- `pnpm --filter @galena/web dev` + `curl`: index.html contains `<title>Galena</title>`; `/src/App.tsx` compiles and imports `@galena/protocol` through `/@fs/.../packages/protocol/src/index.ts` (workspace link proven through Vite as well).
- Built CSS contains `prefers-color-scheme:dark` and `min-height:100vh` (Tailwind produced the dark-scheme rules).
- `.github/workflows/ci.yml`: parsed as YAML (Ruby `YAML.safe_load`); steps are checkout@v7, pnpm/action-setup@v6, setup-node@v7 (`node-version-file: .nvmrc`, `cache: pnpm`), `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `grep` for `any`, `@ts-ignore`, `@ts-expect-error`, comments: nothing (only `src/checkout/*` and `http://localhost` inside strings).
- `git status`: only the files listed above.

### Problems, deviations from the spec, open questions

1. **TypeScript**: upstream `latest` is 7.0.2, but the spec pins "latest stable 5.x/6.x", so 6.0.3 was installed; everything typechecks on 6.0.3.
2. **`.prettierignore` excludes `AGENTS.md`, `README.md`, `docs/`, `work/`**: those files are not Prettier-formatted today and are outside this task's allowed edits (README only `## Development`); the only Prettier diff in README is the alignment of the existing "Where to look" table. Without the exclusion `pnpm format:check` cannot pass. The `## Development` section itself is Prettier-clean. Follow-up: reformat those docs in a later task and then drop them from `.prettierignore`.
3. **oxlint config**: `plugins` lists `eslint, unicorn, oxc, typescript, react`, because setting `plugins` overwrites oxlint's default set (eslint/unicorn/oxc/typescript) and `react` is opt-in. `categories.correctness` is set to `error` so `pnpm lint` fails CI on correctness violations (oxlint's default severity is `warn`, which exits 0).
4. **`pnpm-workspace.yaml`** has `onlyBuiltDependencies: [esbuild]`: pnpm 10 blocks postinstall scripts by default and warned about esbuild.
5. **`turbo.json` `dev` task has `"passThroughEnv": ["PORT"]`** — a deviation from the spec's turbo.json description, because Turbo 2's strict env mode dropped `PORT`: `PORT=3100 pnpm dev` silently bound 3000 until this was added. `build`/`typecheck`/`test` need no env vars today.
6. **CI**: `actions/checkout@v7` is needed to get the repo (the spec's step list starts at pnpm/action-setup), the action versions are the current majors, and `permissions: contents: read` follows setup-node's recommendation. No extra checks were added.
7. **Port 3000 on this machine is already taken** by an unrelated Next.js dev server, so the literal `curl localhost:3000/health` could not be demonstrated; the server does default to 3000 (its failed bind log reads `port: 3000`) and the exact JSON was verified with `PORT=3100`. On a machine with a free 3000 nothing has to be set.
8. **`GET /health` returns `protocolVersion` on top of `{ ok, name, version }`** — this is the acceptance criteria's suggested way to prove workspace linking.
9. `protocolVersion` is the constant `'0.1.0'` in `packages/protocol/src/version.ts`; the three workspace packages are at version `0.1.0`.
10. Only `@galena/web` has a `build` script (protocol and server are consumed from source), so `pnpm build` builds the web app; that matches the spec's script list.
11. `@testing-library/react` declares `@testing-library/dom` as a peer dependency; pnpm auto-installed it into the virtual store and the tests run, so no extra dependency was declared.
12. The web tests use plain assertions (`toBeTruthy`, `getByRole`) because `@testing-library/jest-dom` is not in the allowed dependency list.
13. No visual browser check was possible (no desktop browser connected to this session, no Chrome at the DevTools MCP's default path); rendering is covered by the jsdom test plus the compiled dev output and generated CSS.

### Blocked / needs a decision

- Nothing blocked. Open questions for review: (a) whether to keep `README.md`/`docs/`/`work/` out of `.prettierignore` until a docs-formatting task runs, (b) whether `passThroughEnv` should be widened now for future env vars (Postgres URL, LiteLLM, `VITE_*`) or per task as they arrive.

---

## Review (written by Claude)

**Verdict: approved.** Julio can merge.

The work is excellent. Every acceptance criterion is met, the worker stayed inside the allowed files, the Spec section was left untouched, and the Report is honest and detailed.

### What I verified myself (2026-09-27, on commit 75922e5)
- `pnpm install --frozen-lockfile`: PASS.
- `format:check`, `lint`, `typecheck`, `test`, `build`: all PASS. Tests: protocol 6, server 2, web 3.
- `PORT=3197 pnpm --filter @galena/server dev` then `curl /health` returns `{"ok":true,"name":"galena-server","version":"0.1.0","protocolVersion":"0.1.0"}`.
- The GitHub Actions versions used exist upstream as the latest releases: `actions/checkout` v7.0.1, `actions/setup-node` v7.0.0, `pnpm/action-setup` v6.1.0.
- The diff touches only allowed files, and `README.md` changed only in `## Development`.

### Findings
1. **(minor, follow-up) `@types/node` is 26.x, but the runtime is Node 24.** The types allow Node 26-only APIs that would crash on Node 24. Pin `@types/node` to `^24`.
2. **(minor, follow-up) The web tsconfig includes `node` types for browser code,** because `vite.config.ts` is in the same project. That means `process` or `Buffer` in `src/` would typecheck and then fail in the browser. Split it into `tsconfig.json` (for `src`, DOM + `vite/client`) and `tsconfig.node.json` (for `vite.config.ts`, with node types).
3. **(minor, follow-up) The web tests rely on pnpm auto-installing the `@testing-library/dom` peer.** Declare it explicitly as a devDependency of `@galena/web`, so the tests don't break if pnpm settings change.
4. **(nit, follow-up) CI runs twice on pull requests,** because it's triggered by both `push` (all branches) and `pull_request`. Limit `push` to `main`.
5. **(accepted) TypeScript 6.0.3 instead of 7.0.2.** This is correct per the spec. We stay on 6.x until the tools we use (tsx, Vitest, oxlint, Expo) confirm TypeScript 7 support. This is now a recorded decision.
6. **(accepted) Answer to open question (a):** keep `AGENTS.md`, `README.md`, `docs/` and `work/` in `.prettierignore` **permanently**. They're hand-formatted documents, workers edit the Report sections, and Prettier reflowing tables would create noisy diffs. Change the comment in `.prettierignore` to say so.
7. **(accepted) Answer to open question (b):** add `passThroughEnv` / `env` entries **per task, as each variable arrives**. Keep them explicit.
8. **(accepted) `passThroughEnv: ["PORT"]`, the oxlint plugin list, and `correctness: error`** are all good calls.
9. **(note for later)**
   - `apps/server/src/version.ts` reads `package.json` at runtime, relative to the source file. That has to change when the server gets a build or bundle step.
   - When the server gets real configuration (T-0003 or later), use a zod env schema instead of hand-written checks. zod wasn't in the server's allowed dependencies for this task, so the current approach was correct here.
10. **(process note)** The worker ran in the main checkout rather than a separate worktree. That's fine with one worker, but parallel workers each need their own worktree (see `work/README.md`).

### Follow-ups
- New task **T-0012 (tooling cleanups)** for findings 1–4 and 6. It's small, so it's assigned to `deepseek-v4-flash`.
- Findings 9 are carried into the specs of the first real server tasks.

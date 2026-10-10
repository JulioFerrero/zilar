---
id: T-0900
title: "Dependency alignment: effect ^4.0.2 everywhere and a pnpm catalog for the repeated packages (simplify plan 6.5, G-F9)"
status: todo
milestone: M5
branch: task/T-0900-deps-catalog
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-0900: Dependency alignment

## Spec (written by Claude, do not edit)

### Why
`effect` is `^4.0.2` in most packages but `^4.0.0` in three: `apps/runner/package.json:13`, `packages/devtools/package.json:17` and `packages/runner-tunnel/package.json:15`. The audit (`docs/audit/simplify-2026-10-09/G-deadcode.md`, section F9) also lists identical versions repeated across packages: vitest, `@effect/atom-react`, better-auth, tsx, vite, clsx, cva, tailwind-merge, `@xmpp/client` and scheduler.

### What to build
1. **effect:** set it to `^4.0.2` in those three packages.
2. **The catalog:** add a `catalog:` section to `pnpm-workspace.yaml` for `effect` and for each package that is repeated with the same version. Check the current versions with grep; the audit is a day old. Switch those dependencies to `catalog:`.
3. **Leave alone:** react, react-dom and `@types/react` (Expo pins them in mobile), tailwindcss (3 for NativeWind against 4 on web), and the TypeScript alias in mobile.
4. **Lockfile:** run `pnpm install` and check that the lockfile resolves one `effect` version (`grep -c "^  effect@" pnpm-lock.yaml` or the equivalent). Report the lockfile line count before and after.
5. **Check the production Dockerfiles:** `grep -rn "pnpm-workspace\|catalog" deploy apps/*/Dockerfile*`. They must still install, because they copy `pnpm-workspace.yaml`. Look and report; do not build images.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; scratch files only in `<scratchpad>/<task id>/`), `docs/audit/simplify-2026-10-09/G-deadcode.md` (F9), `pnpm-workspace.yaml`, and every `package.json`.

### Allowed files
`pnpm-workspace.yaml`, `pnpm-lock.yaml`, `package.json`, `apps/*/package.json`, `packages/*/package.json`, `work/T-0900-deps-catalog.md`.

### Checks (wave mode)
```bash
pnpm install --frozen-lockfile
pnpm -r typecheck
pnpm --filter @zilar/api-contract exec vitest run --reporter=dot
pnpm exec prettier --check pnpm-workspace.yaml
```

### Acceptance
- The Checks pass, and one `effect` version is resolved.
- The catalog is used for every repeated same-version dependency.
- The Report gives the lockfile lines before and after.

---

## Report (written by the worker when done)

## Review (written by Claude)

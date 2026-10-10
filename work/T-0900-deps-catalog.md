---
id: T-0900
title: "Dependency alignment: effect ^4.0.2 everywhere and a pnpm catalog for the repeated packages (simplify plan 6.5, G-F9)"
status: merged
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

**Catalog** (`pnpm-workspace.yaml`, versions read from the package.json files on this branch):
- `effect` ^4.0.2 (runner, devtools, runner-tunnel moved from ^4.0.0 to catalog; api-contract, protocol, server, web, mobile, client-core, xmpp-core also catalog)
- `@effect/atom-react` 4.0.2 (mobile, web, client-core dependencies and devDependencies; client-core peerDependency also `catalog:`)
- `better-auth` ^1.7.6 (mobile, web, server)
- `tsx` ^4.23.15 (runner, devtools, server)
- `vite` ^8.3.1 (web, site)
- `vitest` ^5.0.2 (root, runner)
- `clsx` ^2.1.1, `class-variance-authority` ^0.7.1, `tailwind-merge` ^3.7.0 (mobile, web)
- `@xmpp/client` ^0.14.0 (server, devtools, xmpp-core)
- `scheduler` ^0.27.0 (mobile, web, client-core)

Not changed: react, react-dom, @types/react, tailwindcss, the mobile typescript alias. `apps/mobile/modules/zilar-whistle/package.json:16` still has `effect: ^4.0.2` (not in Allowed files, left as is).

**Lockfile** (`pnpm-lock.yaml`): 14646 lines before, 14682 after. `effect@4.0.2` is the only effect version (two lines, the package entry and the snapshot entry, both 4.0.2). A `catalogs:` section was added.

**Checks:**
- `pnpm install` ran and added the catalog to the lockfile. It printed a peer warning: `apps/mobile` `@types/react-dom 19.3.0` wants `@types/react@^19.3.0`, found 19.2.18. No `@types/react` line changed in the lockfile diff, so this is not from this change (not compared against main).
- `pnpm install --frozen-lockfile`: passes ("Done").
- `pnpm -r typecheck`: exit 0, all packages done.
- `pnpm --filter @zilar/api-contract exec vitest run --reporter=dot`: 3 files, 11 tests passed.
- `pnpm exec prettier --check pnpm-workspace.yaml`: passes.
- `pnpm gate` not run (wave mode).

**Dockerfiles** (`grep -rn "pnpm-workspace\|catalog" deploy apps/*/Dockerfile*`): `apps/server/Dockerfile:23`, `apps/web/Dockerfile:21`, `apps/site/Dockerfile:15` each `COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ...`. Nothing under `deploy/` matches. They copy the workspace file and the lockfile, so the catalog resolves there too. I did not build the images or read the RUN lines beyond this grep.

## Review (written by Claude)

**Lead, 2026-10-10: approved.**
- **Catalog:** `pnpm-workspace.yaml` has a catalog of 11 entries, and every repeated same-version dependency uses it.
- **effect:** one version resolves, 4.0.2.
- **Untouched:** react, tailwind and the mobile TypeScript alias.
- **Dockerfiles:** they copy `pnpm-workspace.yaml`, so the catalog resolves in images.
- **Follow-up:** `apps/mobile/modules/zilar-whistle/package.json` still lists `effect ^4.0.2` directly. That is harmless, because it is the same range.
- **Check:** the combined wave 6 check passes.

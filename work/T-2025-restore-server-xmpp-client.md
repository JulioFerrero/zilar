---
id: T-2025
title: "Fix the broken deploy: put @xmpp/client back in apps/server's production dependencies (the server bundle pulls it in through @zilar/xmpp-core), and make the gate run the server production build so this can't merge again"
status: merged
milestone: M5
branch: task/T-2025-restore-server-xmpp-client
model: deepseek/deepseek-flash
effort: default
estimate: 20 min
---

# T-2025: Restore `@xmpp/client` for the server build

## Spec (written by Claude, do not edit)

### Why
- **The failed deploy.** The Coolify deploy of `6ab3d50f0` (2026-10-18 16:11 UTC) failed at `RUN pnpm --filter @zilar/server build`.
- **The local repro** on main: `pnpm --filter @zilar/server build` fails with "The bundle imports packages that are not production dependencies of @zilar/server: @xmpp/client".
- **The cause.** T-2016 removed `@xmpp/client` from `apps/server/package.json`, because no server file imports it directly. The server bundle includes `@zilar/xmpp-core` (the AI gateway uses `createXmppCore`), and that package imports `@xmpp/client`.
- **Why the gate missed it.** `pnpm gate` passed because it does not run the server production build.
- **Impact.** Production still runs `330d36482`, but every push fails until this is fixed.

### Facts (read by the lead on 2026-10-18)
- T-2016's merge commit `8736d7004` removed one `@xmpp/client` line from `apps/server/package.json` and updated `pnpm-lock.yaml`.
- The bundle check that throws lives in the server's build script. Find it with `git grep -n "not production dependencies" apps/server`.
- `pnpm gate` runs `pnpm --filter @zilar/devtools exec tsx src/gate/cli.ts --base main` (root `package.json:28`). Its step list is in `packages/devtools/src/gate/plan.ts`, and it runs from `packages/devtools/src/gate/cli.ts`. Tests live in `packages/devtools/src/gate/gate.test.ts`.

### Steps
1. **Restore the dependency.** Put `@xmpp/client` back in `apps/server/package.json` `dependencies`, at the exact version it had before `8736d7004`. Use `git show 8736d7004 -- apps/server/package.json`. Run `pnpm install` so the lockfile matches.
2. **Prove the build.** `pnpm --filter @zilar/server build` must succeed. Paste its last lines in the Report.
3. **Gate the build.** Make the gate also run `pnpm --filter @zilar/server build`, only when files under `apps/server/`, `packages/` or a `package.json` changed, if the gate already scopes its steps that way. If it doesn't, run it always. Keep it under `nice` like the other heavy steps. If this needs a gate file outside the Allowed files, add it and say so.

### Allowed files
- `apps/server/package.json`
- `pnpm-lock.yaml`
- `packages/devtools/src/gate/plan.ts`
- `packages/devtools/src/gate/cli.ts`
- `packages/devtools/src/gate/gate.test.ts`
- `work/T-2025-restore-server-xmpp-client.md`

### Checks
```bash
pnpm --filter @zilar/server build
pnpm gate
```

### Acceptance
The server production build succeeds, and the gate passes and now includes the build.

---

## Report (written by the worker when done)

### What I did

- Restored `"@xmpp/client": "catalog:"` in `apps/server/package.json` dependencies — the exact
  entry `8736d7004` removed. The catalog resolves it to `^0.14.0`, the lockfile now pins
  `0.14.0` for the server importer, and `pnpm install` was run so the lockfile matches.
- Gate: added a `build @zilar/server` step in `packages/devtools/src/gate/plan.ts`, running
  `pnpm --filter @zilar/server build` after `effect` and before the test steps. It triggers
  only when a changed file is under `apps/server/`, under `packages/`, or is named
  `package.json`; otherwise it reports a skip. No `cli.ts` change was needed: the gate already
  wraps every non-merge step in `nice -n 10`, so the build runs under `nice` like the others.
- Added gate tests for when the build runs and when it is skipped, and updated the two
  existing label lists in `gate.test.ts` that now include the build step.
- Files changed: `apps/server/package.json`, `pnpm-lock.yaml`,
  `packages/devtools/src/gate/plan.ts`, `packages/devtools/src/gate/gate.test.ts`,
  `work/T-2025-restore-server-xmpp-client.md`.

### Checks run

- `pnpm --filter @zilar/server build`: passed. Last lines:
  ```
  dist/index.mjs             1.9mb ⚠️
  dist/tool-worker.mjs      20.7kb
  dist/index.mjs.map         4.7mb
  dist/tool-worker.mjs.map  40.8kb
  ⚡ Done in 229ms
  ```
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/gate/gate.test.ts`:
  51 passed (1 file).
- `pnpm gate` (first run): GATE FAIL, only the `format` step — `gate.test.ts` was not
  Prettier-formatted. I ran `pnpm exec prettier --write packages/devtools/src/gate/gate.test.ts`
  and re-ran the gate; no check was disabled.
- `pnpm gate` (final):
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (1.1s)
  PASS  lint  (1.2s)
  PASS  typecheck  (6.1s)
  PASS  effect  (0.5s)
  PASS  build @zilar/server  (0.4s)
  PASS  tests @zilar/devtools  (0.7s)
  SKIP tests @zilar/server (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- The build step does not trigger on a `pnpm-lock.yaml`-only change, following the spec's
  trigger list; a lockfile normally changes together with a manifest, which does trigger it.
- The tests step for `@zilar/server` is skipped because this branch changes no server source
  file with a nearby test; the new build step already proves the server bundle.


## Review (written by Claude)

Approved: a clean pre-review.
- **The fix.** `@xmpp/client` is back in the server's dependencies, and `pnpm --filter @zilar/server build` passes.
- **The gate.** It gained a "build @zilar/server" step, which runs when `apps/server/`, any `packages/` file or any `package.json` changes.
- **The cause.** T-2016 removed the dependency on knip's word. knip can't see bundling through workspace packages.

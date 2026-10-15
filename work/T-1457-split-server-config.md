---
id: T-1457
title: "400-line rule: split apps/server/src/config.ts (524) into config/ modules behind the same barrel, and bring ais/api.ts (403) under 400; no behaviour change"
status: merged
milestone: M5
branch: task/T-1457-split-server-config
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1457: Split server config

## Spec (written by Claude, do not edit)

### Why
Julio's rule (2026-10-10): at most 400 lines per source file. The plan for `config.ts` is `docs/audit/size-plan.md` item #81 (line 183). Its line numbers are older, so split by the sections it names.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/server/src/config.ts`** is 524 lines. It exports:
  - `ConfigError` (`:4`);
  - `ServerConfig` (the type `:466` and the service `:471`);
  - `ServerConfigLive` (`:473`), `loadServerConfig` (`:477`) and `loadServerConfigOrExit` (`:514`);
  - possibly more, so check with grep.
  - 63 files import from it by relative path (`./config`, `../config`, …).
- **`apps/server/src/ais/api.ts`** is 403 lines. The gate refuses any growth of a file over 400, and this task must bring it to 400 or fewer.

### What to build
1. **Split `config.ts`** into `apps/server/src/config/schema-helpers.ts`, `config/server-schema.ts`, `config/mail.ts` and `config/load.ts` (plan #81).
   - `apps/server/src/config.ts` stays as the barrel, re-exporting every name it exports today, so **none of the 63 importers change**.
   - Note: a folder `config/` next to a file `config.ts` is fine for TypeScript; the barrel stays `config.ts`.
2. **`ais/api.ts`:** move one self-contained handler group, or a helper block, into a new file under `apps/server/src/ais/` so the file is at 390 lines or fewer. Routes, paths and behaviour don't change.
3. **No behaviour change**: the same env parsing, defaults, error messages and exit behaviour. Every file is at 400 lines or fewer.

### Tests
None new. Existing tests that touch config and AIs must pass: `apps/server/src/config*.test.ts`, if present, and `src/ais`.

### Allowed files
- `apps/server/src/config.ts`
- new files under `apps/server/src/config/`
- `apps/server/src/ais/api.ts` and one new file under `apps/server/src/ais/` (name it in the Report)
- `work/T-1457-split-server-config.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/ais src/config --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes.
- After deploy the lead checks `/health` (boot reads config) and that the AI routes answer.

---

## Report (written by the worker when done)

### What I did

**`config.ts` split (barrel kept).** `apps/server/src/config.ts` is now an 11-line barrel that re-exports `ConfigError`, `ServerConfig` (type + service), `ServerConfigLive`, `loadServerConfig` and `loadServerConfigOrExit` from `./config/load`, so none of the 63 importers changed. New modules under `apps/server/src/config/`:

- `schema-helpers.ts` (113 lines): the decode helpers — `toInt`/`toText`, `anyUrlSchema`, `databaseUrlSchema`, `nonEmptyStringSchema`, `pinnedImageSchema`, `withDefault`, `literalWithDefault`, `portSchema`, `booleanFlagSchema`, `webOriginsSchema`, `listenerModelSchema`, `agentToolRoundsSchema`.
- `server-schema.ts` (195 lines): the `serverConfigSchema` field map and the `RawServerConfig` type.
- `mail.ts` (74 lines): the `ConfigDetail` interface, `crossFieldDetails` and `isMailbox`.
- `load.ts` (180 lines): `ConfigError`, the issue walker (`collectDetails`/`formatIssues`), the empty-string normalization, `finalizeConfig`, the `ServerConfig` type + service, `ServerConfigLive`, `loadServerConfig`, `loadServerConfigOrExit`.

**`ais/api.ts` split.** New `apps/server/src/ais/api-layers.ts` (46 lines) holds the API declaration (`AisApi`) and the two layers the mount applies: `renderSchemaError` and `configuredLayer` (the 503 gate). `apps/server/src/ais/api.ts` is 362 lines; it imports those three names. Routes, paths, statuses, bodies, audit calls and step order are untouched.

No behaviour change: all code was moved verbatim, only `export` added to the names the loader needs and the moved block given a module boundary.

### Files changed

- `apps/server/src/config.ts` (524 → 11 lines, now a barrel)
- `apps/server/src/config/schema-helpers.ts` (new)
- `apps/server/src/config/server-schema.ts` (new)
- `apps/server/src/config/mail.ts` (new)
- `apps/server/src/config/load.ts` (new)
- `apps/server/src/ais/api.ts` (403 → 362 lines)
- `apps/server/src/ais/api-layers.ts` (new — the one new file under `apps/server/src/ais/`)
- `work/T-1457-split-server-config.md` (this file)

### Commands and results

- `pnpm install` — Done (frozen lockfile install, no changes).
- `pnpm --filter @zilar/server exec vitest run --maxWorkers=2 --reporter=dot src/ais src/config` — **4 test files passed, 21 tests passed**. There are no `apps/server/src/config*.test.ts` files; the config behaviour is covered by `hands/wiring.test.ts`, which imports `ConfigError`/`loadServerConfig` from the `../config` barrel.
- `pnpm gate` — from the repo root:

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (2.9s)
PASS  format  (0.9s)
PASS  lint  (1.8s)
PASS  typecheck  (4.1s)
PASS  effect  (0.8s)
PASS  tests @zilar/server  (11.7s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Problems / deviations / open questions

- None. The `ais/api.ts` split used the "helper block" option in the spec (the API declaration up top, not a handler group); the new file is `apps/server/src/ais/api-layers.ts`.
- No new tests were written (spec says none new; no crucial code changed).

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 1. This is a pure refactor.
- `config.ts` (an 11-line barrel) now re-exports `config/{schema-helpers,server-schema,mail,load}.ts`, all at 195 lines or fewer.
- `ais/api.ts` drops to 362 lines with `ais/api-layers.ts`.
- The ais and config tests (21) pass locally.
- After deploy, the lead checks `/health`.

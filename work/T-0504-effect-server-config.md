---
id: T-0504
title: "Effect F5: server config on Effect Schema + Effect Config provider behind loadServerConfig — same values, same defaults, same secret-free error messages; config.test.ts unchanged"
status: todo
milestone: M5
branch: task/T-0504-effect-server-config
model: auto
effort: low
depends_on: [T-0494, T-0495]
estimate: 1 day
---

# T-0504: server config on Effect

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase on Effect 4, with Effect Schema replacing zod. Plan `docs/audit/effect-everywhere-plan.md` §2.3: "Effect `Config` as the single definition, `loadServerConfig` as the compatibility shim", task F5 (§4.2).

**`apps/server/src/config.test.ts` (809 lines) is the proof; it passes unchanged.**

### Verified facts (do not re-derive)
- **`apps/server/src/config.ts`** (408 lines):
  - `import { z } from 'zod'` (line 1) and `export class ConfigError extends Error` (line 4);
  - private schemas: `portSchema` (a preprocess default `'3000'`, digits, 1..65535), `databaseUrlSchema` (`postgres(ql)?://`) and `webOriginsSchema` (a default, a comma split and trim, deduplicated `new URL(o).origin`);
  - **`serverConfigSchema`** (from line 36) is a `z.object` holding:
    - enums with defaults (`NODE_ENV`, `LOG_LEVEL`, `GIF_RATING`, `WEB_SEARCH_PROVIDER`);
    - `z.url()` with defaults (`PUBLIC_URL`, `WEB_BASE_URL`);
    - storage dirs with defaults;
    - `TRUSTED_PROXY_HOPS` (`z.coerce.number().int().min(0).max(5).default(0)`);
    - `SMTP_PORT` and `RUNNER_HUB_PORT` (preprocess ports);
    - about 8 `'true'`/`'false'` string flags (`.default('false').transform(v => v === 'true')`);
    - `AGENT_TOOL_MAX_ROUNDS` (a preprocess where empty means undefined).
  - **The schema ends with** a `.superRefine` (around line 233) for the mail rules (`checkMailConfig`, named variables, never values) and a `.transform` (around line 249) that derives `MAIL_TRANSPORT` (console outside production), `BETTER_AUTH_URL` (falls back to `PUBLIC_URL`) and `AGENT_TOOL_MAX_ROUNDS` (6 when `TOOLS_ENABLED`, else 1).
  - **`ServerConfig`** is `z.infer<…> & { xmpp: XmppConfig }` (line 258).
  - **`EMPTY_MEANS_UNSET_KEYS`** and `emptyMailSettingsAsUnset` turn an empty string into unset for 7 keys.
  - **`loadServerConfig(rawEnv)`** (line 287) parses, throws `ConfigError(formatIssues(error))`, then calls `loadXmppConfig(env)` and rewraps its `Error` as a `ConfigError`.
  - **`loadServerConfigOrExit`** (line 307) prints the message and exits with 1.
  - **`formatIssues`** (around line 380) gives `` `Invalid server configuration: ${details.join(', ')}` ``; each detail is `` `${path || 'env'} (${reason})` `` and exact duplicates collapse.
  - **`reasonFor`** gives `missing` (undefined input), the custom message (superRefine issues), or `invalid`.
- **`apps/server/src/xmpp/config.ts`** (64 lines) has `loadXmppConfig(env)` (line 50) returning `{ apiUrl (trailing slash trimmed), adminJid, adminPassword, domain, mucDomain, wsPublicUrl, jwtSecret }`. **T-0494 moved its schema to Effect Schema; read the merged file before you start.**
- **The consumers of `loadServerConfig`:** `index.ts`, `test-support.ts`, `auth/invite-cli.ts`, `auth/cli-config.ts`, `push/config.ts`, `db/migrate-cli.ts`, plus tests (`config.test.ts`, `logger.test.ts`, `setup/crypto.test.ts`, `auth/mailer*.test.ts`). **None of them may change.**
- **The test contract** (`config.test.ts`):
  - full `toEqual` snapshots of the parsed config (lines 43 and 90);
  - `message` contains the variable name and **never** the value (for example lines 167-168, 179-180, 190-191, 199-201, 221-222, 296-297, 306-308);
  - `missing` appears for unset required keys (lines 247-249).
- **The Effect 4 APIs** (installed `effect`, `dist/`): `Schema` (`Struct`, `Literals`, `URL`, `check`, `withDecodingDefault`, `decodeUnknownExit`), `Config` and `ConfigProvider` (`effect/Config`, `effect/ConfigProvider`; read their `.d.ts` for `fromEnv`/`fromUnknown` or the map-based provider). See also the `SchemaIssue` formatting.

### What to build
1. **`config.ts`:**
   - define the server config with **Effect Schema**, with the same keys, defaults, transforms, cross-field mail rules (same messages) and derived values;
   - read the env through an Effect `ConfigProvider` built from the `rawEnv` map (so tests keep passing plain objects), **or**, if that adds nothing, decode the env map directly with the Schema. Write in the Report which one you chose and why;
   - **`loadServerConfig`** keeps its signature and its sync throw of `ConfigError`;
   - **`formatIssues`** maps Effect's issue tree to **exactly** the same message format: path or `env`, then `missing` / custom message / `invalid`, deduplicated and joined with `, `. It never prints a value.
2. **`ServerConfig`** keeps the same shape. Each consumer must typecheck unchanged; compare the inferred type.
3. **Also export a `ServerConfigLive` layer** (`Layer.succeed` of a `ServerConfig` service tag, built from `process.env`) for later Effect services. Do not wire it anywhere yet.
4. **Remove `zod` from `config.ts`.** Do not remove it from `apps/server/package.json`; other server files still use it.
5. **Tests:** `config.test.ts` passes **unchanged**. If any assertion cannot hold, stop and report BLOCKED with the line. Add `apps/server/src/config.effect.test.ts` covering:
   - `ServerConfigLive` provides the parsed config;
   - every error message for 3 bad secrets (`BETTER_AUTH_SECRET`, `SMTP_PASSWORD`, `DATABASE_URL`) contains the name and not the value.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-everywhere-plan.md` §2.3, `apps/server/src/config.ts` (all), `apps/server/src/xmpp/config.ts`, `apps/server/src/config.test.ts` (skim all), `apps/server/src/effect/runtime.ts`.

### Allowed files
`apps/server/src/config.ts`, `apps/server/src/config.effect.test.ts`, `apps/server/src/xmpp/config.ts`, `work/T-0504-effect-server-config.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/config src/xmpp/config src/logger
pnpm gate
```

### Acceptance
- The server config is defined with Effect Schema, with no zod in `config.ts`.
- `loadServerConfig` returns identical values and messages.
- `config.test.ts` is untouched and green, and the new test passes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

# Effect 4 everywhere: audit and ordered plan

Status: plan (T-0490), 2026-10-07. Written by a worker from code, not from memory.
Every claim about our code cites `file:line`. Measurements are real outputs pasted
in section 3.

Scope (Julio, 2026-10-07, quoted in `work/T-0490-effect-everywhere-plan.md:18-21`):
everything, frameworks too; Effect Schema replaces zod; web and mobile convert
now. This document fixes one architecture per layer and an ordered task split so
8 parallel workers do not each invent a pattern.

## 0. Verified facts used below

- `effect@4.0.0` is only in `apps/server/package.json:23` and is imported only by
  `apps/server/src/voice-transcription/pipeline.ts:16`. No other package depends
  on Effect (`grep -rn "from 'effect'"` across `apps/` and `packages/` returns
  one hit).
- Server HTTP: 54 modules build a Hono router (`grep -rl "new Hono"`), 261 route
  registrations (`\.(get|post|put|patch|delete)\('`). `createApp` builds the root
  app at `apps/server/src/app.ts:207` with `new Hono` at `apps/server/src/app.ts:245`;
  53 `app.route(...)` mounts (`apps/server/src/app.ts:302-589`) plus the
  better-auth catch-all at `apps/server/src/app.ts:301`.
- Server tests call the Hono app directly: 25 test files call `createApp(...)` and
  there are 834 `.request(` calls across `apps/server/src/**/*.test.ts`.
- Drizzle: 67 non-test files under `apps/server/src` import `drizzle-orm`; the
  schema is 1,534 lines (`apps/server/src/db/schema.ts`) with 46 SQL migrations
  under `apps/server/drizzle/` (`0000`–`0045`); 62 `.transaction(` call sites.
- zod files (from `grep -rl "from 'zod'"`): server 75, web 6, mobile 2, runner 4,
  devtools 3, protocol 12, runner-tunnel 3, agent-drivers 1, xmpp-core 0,
  chat-core 0, site 0.

---

## 1. Inventory: what must change, per package or app

### 1.1 `apps/server` (~49k lines)

**HTTP entry points.** One root Hono app (`apps/server/src/app.ts:207`), 54 router
modules, 261 route registrations. The entrypoint boots with `@hono/node-server`:
`serve({ fetch: app.fetch, port: config.PORT }, ...)` at `apps/server/src/index.ts:397`.
Middleware that must be preserved when the edge changes: CORS
(`app.ts:286`), the origin guard for unsafe methods (`app.ts:294`), request-id
(`app.ts:245`), and the fixed error mapping (`HttpError`, imported at
`app.ts:35`).

**better-auth.** Mounted as a raw fetch handler:
`apps/server/src/app.ts:301` — `app.all('/api/auth/*', (c) => auth.handler(c.req.raw))`.
better-auth owns its own routing under `/api/auth` and answers Web `Request` →
`Response`; there is no Effect-native handler.

**DB access.** Drizzle over `postgres` (`apps/server/src/db/client.ts:18-20`,
pool `max: 10` at line 19), with a `PgLite` branch for tests
(`apps/server/src/db/migrate.ts:9-13`). 46 migrations applied by
`runMigrations` (`apps/server/src/db/migrate.ts:8`). Heavy modules by drizzle
file count: `agents` (6), `routines` (4), `auth` (4), `voice-transcription` (3),
`topics` (3), `tools` (3), `groups` (3), `approvals` (3). Transactions and
advisory locks are used for atomic caps: e.g. `apps/server/src/blocks/service.ts:94`
(`db.transaction`), `apps/server/src/blocks/service.ts:106-107`
(`pg_advisory_xact_lock`), `apps/server/src/pins/service.ts:161-162`.

**Config.** One zod schema plus `loadXmppConfig`
(`apps/server/src/config.ts:6`, `:287`), `loadServerConfigOrExit` exits the
process on failure (`config.ts:307-317`). 129 `.safeParse(` and 143 `.parse(`
calls across the server; tests build config by calling `loadServerConfig` with a
raw env map, e.g. `apps/server/src/auth/mailer.test.ts:85`.

**zod by role.** Request/response and internal validation across 75 files;
`z.object` 92, `z.strictObject` 3, `z.enum` 38, `z.discriminatedUnion` 2,
`z.coerce` 8, `.refine(` 45, `.transform(` 20, `.default(` 80, `.optional()` 182,
`z.iso.` 1, `z.url(` 15.

**Background loops / long-lived work.** `setTimeout`/`setInterval` loops that
Effect should own: runner hub polling (`apps/server/src/machines/hub.ts:118`,
`:313`), routines scheduler (`apps/server/src/routines/scheduler.ts:73`),
approvals sweeper (`apps/server/src/approvals/sweeper.ts:81`), action gateway
recovery (`apps/server/src/actions/gateway.ts:167`), agent gateway retries
(`apps/server/src/agents/gateway.ts:264,275,551`), draft flush throttling
(`apps/server/src/drafts/hub.ts:74,108`), Telegram import retry/timeout
(`apps/server/src/stickers/telegram-import.ts:151,350,376`), mailer send timeout
(`apps/server/src/auth/mailer.ts:159`), sandbox tool worker
(`apps/server/src/sandbox/tool-worker.ts:58`), GIF fetch timeout
(`apps/server/src/gifs/giphy.ts:254`).

**Side-effectful clients.** XMPP admin client (`apps/server/src/xmpp/admin-client.ts`),
push sender/component (`apps/server/src/push/sender.ts`, `push/component.ts`),
LiteLLM client (`apps/server/src/ai/litellm-client.ts`, `redactSecrets` at
`:229`), mailer (`apps/server/src/auth/mailer.ts`), archive pool
(`apps/server/src/search/service.ts`), voice engine (`apps/server/src/voice/engine.ts`),
sandbox runner (`apps/server/src/sandbox/run-tool.ts`, `tool-worker.ts`), and
filesystem storage (`resolveStorageDir` in `apps/server/src/stickers/service.ts`,
imported at `apps/server/src/index.ts:18`).

**State.** No React in the server. Process-level singletons live in
`apps/server/src/index.ts` (`config` at `:57`, `createDb` at `:71`,
`runMigrations` at `:72`, the gateways from `:242` and `:363`).

### 1.2 `apps/web` (~48k lines)

- API client: one `request<T>(path, schema: z.ZodType<T>, init)` wrapper at
  `apps/web/src/lib/api.ts:219`; 6 raw `fetch(` calls total (the wrapper plus
  five media/upload/search sites at `api.ts:1571,1848,2078,2525,2593`); 154
  schema constructs and 174 exported functions in the same file.
- 4 non-test zod files: `apps/web/src/lib/api.ts`, `lib/drafts.ts`, `lib/tools.ts`,
  `store/chatListCache.ts`.
- State: two vanilla zustand stores built with `createStore` at
  `apps/web/src/store/realStore.ts:786` and `apps/web/src/store/store.ts:835`,
  provided by `apps/web/src/store/ChatStoreProvider.tsx` (files that import
  `zustand`: those three).
- React 19 (`apps/web/package.json` "react" ^19.3.0), no Effect today.

### 1.3 `apps/mobile` (~59k lines)

- 25 `*-api.ts` modules under `apps/mobile/src/lib/` plus the auth/session layer;
  they share `API_URL`/`resolveApiUrl` from `apps/mobile/src/lib/auth.ts:14-22`
  and hand-parse payloads (comment at `apps/mobile/src/lib/chat-api.ts:5-8`).
- 2 zod files only: `apps/mobile/src/lib/integrations-api.ts`,
  `apps/mobile/src/lib/voice-transcripts.ts`.
- State: zustand stores `apps/mobile/src/store/chat-store.ts`,
  `store/real-store.ts`, `auth/session-store.ts`, plus
  `store/chat-store-provider.tsx`.
- Runtime: `expo` ~57 (`apps/mobile/package.json:27`), `react-native` 0.86.3
  (`:51`), `react` 19.2.3 (`:49`), Hermes by default. Existing global shims are
  only `process.nextTick` and `crypto.randomUUID` (`apps/mobile/src/lib/polyfills.ts`),
  and `AGENTS.md:52` records that Hermes has no `crypto.subtle`.

### 1.4 `packages/protocol` (~0.5k lines, 12 zod files)

The shared wire contracts: `packages/protocol/src/index.ts` re-exports `common`,
`task`, `approval`, `progress`, `wake`, `poll`, `voice`, `attachment`, `forward`,
`handoff`, `payload`, `sticker`. Patterns in use: `.refine` and JID rules
(`packages/protocol/src/common.ts:4-13`), `z.strictObject` (`common.ts:33`),
`z.enum` (`common.ts:26`), and a `z.discriminatedUnion('op', ...)`
(`packages/protocol/src/task.ts:34`).

### 1.5 Other packages and apps

- `packages/xmpp-core` (~3k): wraps `@xmpp/client`; 0 zod (`package.json` deps:
  `@zilar/protocol`, `@xmpp/client`).
- `packages/chat-core` (~1.6k): pure logic, 0 zod, depends only on protocol.
- `packages/runner-tunnel` (~2.2k): `ws` + zod (3 files).
- `packages/agent-drivers` (~0.7k): zod (1 file).
- `packages/devtools` (~7.9k): zod (3 files); the live lead CLI is
  `packages/devtools/src/lead/cli.ts` (script `lead`, `package.json:10`) and the
  gate is `src/gate/cli.ts`. Both must keep working through every change.
- `apps/runner`: zod (3 non-test files: `src/pair.ts`, `src/identity.ts`,
  `src/capabilities.ts`), depends on `@zilar/runner-tunnel`.
- `apps/site`: marketing site, 0 zod, no server logic; out of scope.

---

## 2. Architecture per layer (one recommendation each)

### 2.1 Server HTTP: Hono as the outer edge during a strangler, Effect `HttpApi` as the target

**Recommendation.** Do not big-bang. Keep Hono as the process edge and mount
Effect `HttpApi` handlers as a fetch-style sub-app under Hono, one route module
at a time, then flip the edge to `@effect/platform-node` (`NodeHttpServer` +
`NodeRuntime`) once the last module has moved.

**Why Hono outside first.**
1. better-auth is a raw fetch handler (`app.ts:301`). `HttpApi` runs on
   `@effect/platform` request/response values, so better-auth cannot be an
   `HttpApi` route without a bridge. Keeping Hono outside lets
   `/api/auth/*` keep working untouched while everything else moves.
2. The failure is bounded. 25 test files and 834 `app.request` calls exercise
   the Hono app; a big-bang switch changes all of them at once. The strangler
   keeps them green.
3. Middleware we must not re-implement yet lives in Hono: CORS (`app.ts:286`),
   the unsafe-method origin guard (`app.ts:294`), request-id (`app.ts:245`).

**How a route moves.** `@effect/platform`'s `HttpApp.toWebHandler` turns an
`HttpApi` implementation into a fetch handler; mount it under Hono, e.g.
`app.all('/api/<module>/*', (c) => effectRequestHandler(c.req.raw))`, and keep
the old `app.route(...)` line until the new one has the same request/response
tests. The alternative (Hono inside `HttpApi` via `HttpApiBuilder`) is harder
because Hono has no Effect-layer adapter; it is the wrong direction for an
incremental move.

**better-auth in the target state.** Two options, decide before the edge flip:
(a) keep a permanent tiny fetch sub-app for `/api/auth/*` even after Hono is
gone (lowest risk), or (b) convert the incoming `HttpServerRequest` to a Web
`Request` and the `Response` back (a bridge of ~30 lines, unproven against
better-auth 1.7). Recommendation: (a).

**Route tests.** New `HttpApi` routes are tested at the HTTP level through the
same mounted app, so a request/response pair is the contract. `HttpApi` also
offers in-memory handler tests (`docs/effect-reference/LLMS.md:369-371`). A
module counts as "kept" only when its existing Hono-level test file passes
unchanged against the new handler, or, where the test welded itself to Hono
internals, when a new test asserts the identical method, path, status and body
shape.

### 2.2 DB: keep drizzle, lift it into an Effect `Database` service

**Recommendation.** Do not move to `effect/sql` + `@effect/sql-pg` now. Wrap the
existing drizzle handle in a `Database` `Context.Service` whose methods return
Effects, and keep `drizzle-kit` and migrations 0000–0045.

**Why (checked against the registry 2026-10-07).** There is no v4-compatible
drizzle integration: `@effect/sql-drizzle@0.51.0` declares
`peerDependencies { effect: "^3.22.0", "@effect/sql": "^0.52.0", drizzle-orm: ">=0.43.1 <0.50" }`
(we run `effect@4.0.0`). So even the v3 line would pin us back to Effect 3.

**Cost of the alternative.** `apps/server/src/db/schema.ts` is 1,534 lines; 67
files import drizzle; 62 `.transaction(` sites; 46 committed migrations. Moving
to `Model.Class` + `@effect/sql-pg` throws all of that away and changes every
query call site — a multi-week rewrite with no behaviour gain.

**Shape.** A `Database` service holds `db` (drizzle handle) and a
`transaction<R, E>(fn)` that runs drizzle's `db.transaction` and lifts the
result. Existing transaction bodies (e.g. `blocks/service.ts:94`,
`pins/service.ts:161`) become three-line adapters. Lift plain promises with
`Effect.promise` so a down database rejects with the original error, per
`docs/EFFECT_GUIDE.md:101-109`. Hold the pool with `Layer.scoped` +
`Effect.acquireRelease` so `close` (`db/client.ts:24`) becomes a finalizer.
Advisory locks stay raw SQL (`blocks/service.ts:106`, `pins/service.ts:162`).
**Revisit** if `@effect/sql-drizzle` ships a v4 peer: the `Database` interface
makes the swap mechanical.

### 2.3 Config: Effect `Config` as the single definition, `loadServerConfig` as the compatibility shim

**Recommendation.** Define the server config once as an Effect `Config`
(`Config.all`, `Config.redacted` for secrets), then implement the existing
`loadServerConfig(rawEnv)` (`config.ts:287`) on top of
`ConfigProvider.fromMap(env)` so the process-start path that throws `ConfigError`
and exits (`config.ts:307-317`) keeps working unchanged.

**Why not two schemas.** The 75 zod files and the test seam
(`mailer.test.ts:85` passes a raw env map) already treat env as a map.
`ConfigProvider.fromMap` is the same seam, so tests keep passing a map and only
the parser changes. Keeping zod for env and Config elsewhere would drift.

**Secrets.** `BETTER_AUTH_SECRET`, `ZILAR_KEY_ENCRYPTION_KEY`, `SMTP_PASSWORD`
(`config.ts:265-273`, `logger.ts:19-30`) become `Config.redacted`, so they print
as `<redacted>` by construction.

### 2.4 Services and layers

Today there are no services or layers; the only Effect module is
`voice-transcription/pipeline.ts:16`. Introduce a deliberately small set:

- `Runtime` — one `ManagedRuntime.make(AppLayer, { memoMap })` created at the
  server edge (`apps/server/src/index.ts`) and disposed on shutdown, following
  `docs/effect-reference/examples/10_managed-runtime.ts.txt:62-69`.
- `Database` — section 2.2.
- `Config` — section 2.3.
- `HttpClient` — for outbound calls (LiteLLM, Telegram, Giphy, push), replacing
  the ad-hoc `fetch`/`setTimeout` sites (`giphy.ts:254`,
  `telegram-import.ts:151`).
- `FileSystem` (`@effect/platform-node`) — storage dir
  (`stickers/service.ts` `resolveStorageDir`).
- `Logger` — bridge, section 2.8.
- Boundary services only where a test needs a double: `Mailer`, `XmppAdmin`,
  `PushSender`, `Litellm`.

Do **not** invent a service for every function: keep `Effect.fnUntraced`
functions that take dependencies as arguments, per `docs/EFFECT_GUIDE.md:58-59`.
Tests provide a test layer following
`docs/effect-reference/examples/20_layer-tests.ts.txt`, or keep plain Vitest with
`Effect.runPromise` where a fake is simpler (`docs/EFFECT_GUIDE.md:142-158`).

### 2.5 Schema: zod → Effect Schema mapping

Effect Schema in 4.0.0 (verified against
`node_modules/.pnpm/effect@4.0.0/.../dist/Schema.d.ts`):

| zod (counts in §1.1) | Effect Schema | Notes |
| --- | --- | --- |
| `z.object({...})` | `Schema.Struct({...})` | excess keys are ignored by default |
| `z.strictObject({...})` | `Schema.Struct({...})` decoded with `{ onExcessProperty: "error" }` | option exists at `Schema.d.ts:10673` |
| `z.enum([...])` | `Schema.Literals([...])` | `Schema.d.ts:4003` |
| `z.discriminatedUnion('op', [...])` | `Schema.Union([Schema.TaggedStruct('task.created', {...}), ...])` | `TaggedStruct` at `Schema.d.ts:4930` |
| `.optional()` | `Schema.optionalKey` / `Schema.optional` | key vs value optional |
| `.default(x)` | `.pipe(Schema.withDecodingDefaultKey(Effect.succeed(x)))` | `Schema.d.ts:4693`; constructor default at `:4635` |
| `.refine(fn)` | `Schema.refine(fn)` | `Schema.d.ts:4156` |
| `.transform(fn)` | `Schema.decodeTo(target, { decode, encode })` | `Schema.d.ts:4464`; `encodeTo` at `:4545` |
| `z.coerce.number()` | `Schema.NumberFromString` | |
| `z.iso.datetime({offset:true})` | `Schema.DateTimeUtc` / `Schema.DateFromString` | `Schema.d.ts:7896`, `:6799` |
| `z.url()` | `Schema.URLFromString` (or string + `Schema.URL` check) | `Schema.d.ts:6726`, `:6702` |

**Where encode/decode lives.** Decode at every boundary: HTTP bodies (server),
HTTP responses (web/mobile), env (server), and XMPP/tunnel frames. `packages/protocol`
becomes the single source of these schemas; server/web/mobile import them instead
of each defining zod schemas. `packages/protocol/src/common.ts` and `task.ts` are
the pilot.

### 2.6 Web: React and zustand stay; Effect runs inside actions; API client moves to Schema (and optionally HttpClient)

**Recommendation.** Keep React 19 and the two zustand stores
(`realStore.ts:786`, `store.ts:835`). Put one shared `ManagedRuntime` behind them
and run Effect programs inside store actions; do not move state to
`@effect/atom-react`.

**Why not atom-react.** Moving state rewrites every selector and the existing
store tests (`realStore.test.tsx`, `realStore.media.test.tsx`, `folders.test.ts`,
`chatListCache.test.ts`) that assert zustand behaviour. The value Effect adds on
web is in the pipelines (timeouts, retry, cancellation, resource cleanup —
`docs/ROADMAP_EFFECT.md:27`), not in the container. `@effect/atom-react` is worth
revisiting later for new state, not for a wholesale swap.

**API client.** Keep the single `request<T>` shape (`api.ts:219`) but change the
`schema: z.ZodType<T>` parameter to `Schema.Schema<T>` and decode with
`Schema.decodeUnknown`. `ApiError` (`api.ts:11-19`) stays byte-identical so
callers and error UI do not change. Move the internals onto `HttpClient` once
timings/retries matter; the signature stays the same either way. The five raw
`fetch` sites (`api.ts:1571,1848,2078,2525,2593`, uploads) are separate small
tasks because they stream bodies.

### 2.7 Mobile: same shape as web; Effect core is Hermes-safe, verify the optional modules

**Recommendation.** Mirror web: React Native and zustand stay
(`store/real-store.ts`, `store/chat-store.ts`), Effect runs inside actions, and
the 25 `*-api.ts` modules move to the shared Schema and, where they do network,
`HttpClient`.

**React Native / Hermes compatibility (checked in the effect 4.0.0 dist).**
The core packages are platform-neutral: `effect/dist/Effect.js` has no `node:`
imports, and the only top-level module importing `node:` is
`testing/TestSchema.js`. Specifically:
- `structuredClone` appears only in `http-api/internal/httpApiScalar.js` (the
  HttpApi Swagger/Scalar UI), not in core.
- `crypto.subtle` appears only in `http-api/internal/httpApiScalar.js`,
  `workflow/internal/crypto.js`, and the eventlog modules. `AGENTS.md:52`
  already states Hermes has no `crypto.subtle`, so mobile must avoid those
  modules (or polyfill); a core Effect + Schema port does not touch them.
- `AbortSignal.any` is not used anywhere in the dist; `AbortSignal` appears in
  only two files (HttpClient).
- `WeakRef`/`FinalizationRegistry` appear in `reactivity/Atom.js` and the
  `httpApi*` internals — relevant only if we adopt `@effect/atom-react` or
  HttpApi Swagger on device.

Consequence: the recommended mobile path (Effect + Schema core, `HttpClient`,
services/layers) needs no new Hermes globals beyond what
`apps/mobile/src/lib/polyfills.ts` already installs. The open item is to verify
on-device once with a real bundle (section 5).

### 2.8 Errors and logging: tagged errors plus a pino-backed Effect Logger

**Recommendation.** Use one tagged-error class per failure mode
(`Data.TaggedError`, `docs/EFFECT_GUIDE.md:63-69`, or `Schema.TaggedError`,
`docs/effect-reference/LLMS.md:46`), and keep the fixed HTTP mapping at the
Promise/handler boundary so answers stay identical. Keep pino as the sink
(`apps/server/src/logger.ts`) and add an Effect `Logger` layer that forwards to
pino, carrying `redactPaths` (`logger.ts:12-30`) unchanged.

**Why.** Our redaction guarantees are load-bearing: `redactSecrets`
(`ai/litellm-client.ts:229`) and the pino redact list keep tokens and
`DATABASE_URL` out of logs; the security checklist (`AGENTS.md:75,81`) makes
audit entries ids-only. Replacing pino with the default Effect logger would
silently drop that. Tagged errors carry no payload by default, so provider
messages and secrets never leave the module — the existing regression tests
(`docs/EFFECT_GUIDE.md:126-128`) must keep passing.

### 2.9 Packages

- `protocol` first (shared schemas, §2.5) so server/web/mobile agree.
- `chat-core`: pure, no zod. Convert only if an async boundary is added; keep as-is otherwise.
- `xmpp-core`: wrap `@xmpp/client` (an event emitter) with `Stream`/`Effect.acquireRelease` for the connection; no zod.
- `runner-tunnel`: zod (3 files) → Schema; the `ws` lifecycle → `Effect.acquireRelease`/`Stream`.
- `agent-drivers`: 1 zod file, small pilot.
- `devtools`: 3 zod files; the lead CLI (`src/lead/cli.ts`) and gate
  (`src/gate/cli.ts`) must keep working. Convert internals incrementally; do not
  replace argument parsing unless a later task asks.
- `apps/runner`: 3 zod files; convert with `runner-tunnel` so the framing stays in one place.
- `apps/site`: no change.

---

## 3. Measurements (real outputs)

All temporary edits were reverted; `git status` after each was clean except the
two Allowed files.

### 3.1 Web production bundle, baseline vs minimal Effect + Schema

Baseline (`pnpm --filter @zilar/web build`):

```
dist/assets/index-BXS2_ptS.css   57.14 kB │ gzip:  11.55 kB
dist/assets/index-wv0dHVba.js  1,339.44 kB │ gzip: 374.56 kB
```

With `import { Effect, Schema } from 'effect'` plus a decode + `Effect.runSync`
probe in `apps/web/src/main.tsx` (temporary), `effect@4.0.2` added temporarily to
`apps/web`:

```
dist/assets/index-DDwvkyGG.js  1,408.70 kB │ gzip: 397.32 kB
```

Delta: **+69.26 kB raw / +22.76 kB gzip** (~+5.2% raw). Reverted;
`git status` showed only `work/T-0490-effect-everywhere-plan.md`.

### 3.2 Mobile Expo JS bundle, baseline vs minimal Effect + Schema

Headless export worked via the local binary (the pnpm equivalent of
`npx expo export`):
`pnpm --filter @zilar/mobile exec expo export --platform ios --output-dir /tmp/mobile-export-base`.

Baseline:

```
› ios bundles (1):
_expo/static/js/ios/entry-0f62f0d19db42cc47ecccd7cb11fab0a.hbc (9.2MB)
```

With `effect@4.0.2` temporarily added and a minimal Effect + Schema probe in
`apps/mobile/src/app/_layout.tsx`:

```
› ios bundles (1):
_expo/static/js/ios/entry-6441db35b5fceb9d31c9ee1acac38d9d.hbc (12MB)
```

Exact bytes from `ls -l`:

- baseline `9223877` bytes;
- with Effect + Schema `12180112` bytes.

Delta: **+2,956,235 bytes (~2.82 MiB, ~+32%)**. Reverted; `git status` clean.
(Only iOS was exported; Android would bundle the same JS and add its own assets.)

### 3.3 Upgrade `effect` 4.0.0 → 4.0.2 on the server

Temporarily `pnpm --filter @zilar/server add effect@4.0.2`, then
`pnpm --filter @zilar/server typecheck` (`tsc --noEmit`):

```
typecheck exit=0
```

No type errors. Reverted; `package.json:23` back to `"effect": "^4.0.0"`.

### 3.4 Registry check for a v4 drizzle integration

`npm view @effect/sql-drizzle@latest peerDependencies`:

```json
{ "effect": "^3.22.0", "@effect/sql": "^0.52.0", "drizzle-orm": ">=0.43.1 <0.50" }
```

Latest published `@effect/sql-drizzle` is `0.51.0` — the v3 line. **No
v4-compatible drizzle integration exists today**, which drives the §2.2
recommendation. `effect`, `@effect/platform-node`, `@effect/sql-pg`,
`@effect/platform-browser` and `@effect/atom-react` all publish `4.0.2`
(`npm view <pkg> version`).

---

## 4. Ordered task split (parallel lanes)

Sizes: S ≈ ≤0.5 day, M ≈ 1–2 days, L ≈ 3–5 days. "Tests change?" says whether a
task is allowed to edit existing tests. Nothing here may edit another lane's
files in the same step.

### 4.1 Lane map and gating

```
F1 runtime ─┐
F2 schema   ├─> B (protocol convert) ─> D (web) ─┐
F3 db       │                                    ├─> G (bulk)
F4 httpapi  ┘                                    │
F5 config ──────────────────────────────────────>┘
```

Foundation tasks F1–F5 run first and are serialized (one worker each, in
order F2/F5 → F3 → F1/F4). Only after the protocol pilot (B1) may web/mobile
lanes start. Server route bulk (C) starts after F1–F5 and the C-pilot.

### 4.2 Foundations

| # | Task | Files | Deps | Size | Tests change? |
| --- | --- | --- | --- | --- | --- |
| F1 | `ManagedRuntime` + layer conventions for the server | new `apps/server/src/effect/runtime.ts`; `apps/server/src/index.ts` (edge only) | — | S | no |
| F2 | Schema conventions note + protocol pilot | `docs/EFFECT_GUIDE.md` (lead edits); pilot in `packages/protocol` (`common.ts`, `task.ts`) | — | M | yes (protocol tests re-assert same parse/reject) |
| F3 | `Database` service over drizzle | new `apps/server/src/effect/database.ts`; `db/client.ts` (resource layer) | F1 | M | no |
| F4 | `HttpApi` adapter: mount a no-op `HttpApi` under Hono + shared HTTP test harness | new `apps/server/src/effect/http.ts`; `apps/server/src/app.ts` (add mount only) | F1 | M | no |
| F5 | Config on Effect `Config`/`ConfigProvider` behind `loadServerConfig` | `apps/server/src/config.ts`; `apps/server/src/xmpp/config.ts` | F1 | M | no (tests keep passing env maps) |

Proof for F2: the protocol package's existing tests (`common.test.ts`,
`task.test.ts`, …) must assert the same accepted/rejected inputs.

### 4.3 Pilots (one per layer, after foundations)

| # | Task | Files | Deps | Size | Tests change? |
| --- | --- | --- | --- | --- | --- |
| P1 | One server route module end-to-end on `HttpApi` — pick a small drizzle-backed module (`handles` or `pins`; 1 drizzle file each) | `apps/server/src/handles/**` or `apps/server/src/pins/**`; `app.ts` (swap one mount) | F3,F4,F5 | M | no: its Hono test stays green |
| P2 | One web store slice + API call on Schema (and `HttpClient` if feasible) | `apps/web/src/store/realStore.ts` (one action); `apps/web/src/lib/api.ts` (one endpoint) | B1 | M | no for untouched slices; the touched slice's test re-asserts the same requests |
| P3 | One mobile slice: one `*-api.ts` + its store action | `apps/mobile/src/lib/<one>-api.ts`; `apps/mobile/src/store/real-store.ts` | B1 | M | no |
| P4 | One package pilot: `packages/agent-drivers` (1 zod file) | `packages/agent-drivers/**` | B1 | S | yes (schema tests re-assert) |
| B1 | Convert `packages/protocol` to Effect Schema (full, not partial) | `packages/protocol/src/**` | F2 | L | yes; every consumer must still compile |

P1 is the gate for the whole server bulk: if the Hono-level test cannot pass
unchanged, stop and revisit F4 before spending more.

### 4.4 Bulk, module by module

**Server bulk (lane C), ordered by blast radius, one module per task.** Each
task lists the router + its drizzle files; for each, the how is P1's recipe.
Suggested order (small → large), 54 modules total; group the first wave:

1. `handles`, `pins`, `blocks`, `contacts`, `contact-requests`, `directory` (small, 1 drizzle file each).
2. `drafts`, `chat-prefs`, `chat-folders`, `chatList`/chats, `topics` (topics: 3 drizzle files, discriminated unions).
3. `groups`, `roles`, `invite-links`, `approvals` (3 drizzle files), `audit`.
4. `media`, `files`, `avatars`, `backgrounds`, `stickers` (transactions at `stickers/service.ts:294,358`).
5. `gifs`, `search`, `xmpp`, `machines`, `tools`, `routines`.
6. `push`, `integrations`, `setup`, `connections`, `ais`, `agents`, `actions`.
7. `chats`, `voice`, `voice-transcription` (Effect already, `pipeline.ts:16`), `auth` routes (keep better-auth catch-all in Hono).
8. Edge flip: CORS/origin/request-id/error mapping move into `HttpApi` middleware (`HttpApiMiddleware`), `serve` (`index.ts:397`) → `NodeHttpServer`; remove Hono. Only after all modules are green.

Background loops become one task each (Streams + `Schedule`), independent of the
routers: runner hub, routines scheduler, approvals sweeper, action gateway
recovery, agent gateway, draft hub, push component, Telegram import, mailer
timeout, sandbox worker, Giphy timeout.

**Web bulk (lane D):** the 4 zod files
(`lib/api.ts`, `lib/drafts.ts`, `lib/tools.ts`, `store/chatListCache.ts`), then
the five raw-fetch upload sites (`api.ts:1571,1848,2078,2525,2593`), then store
pipelines one at a time (voice, attachments, stickers, forward) grounded on
`docs/ROADMAP_EFFECT.md:27`.

**Mobile bulk (lane E):** the 25 `*-api.ts` files in dependency order (auth →
profile → chat → media/attachments → groups/topics → the rest), then the three
stores' async actions, then native resource lifetimes (audio player, recorder)
as separate tasks with on-device checks.

**Packages (lane F):** `runner-tunnel` + `apps/runner` together,
`xmpp-core`, `devtools` internals (lead/gate CLIs), and `chat-core` last.

### 4.5 Estimate

| Lane | Worker-days (rough) |
| --- | --- |
| Foundations (F1–F5) | 10–14 |
| Protocol (B1) + pilots (P1–P4) | 10–14 |
| Server bulk (54 modules + loops + edge flip) | 60–90 |
| Web bulk | 30–45 |
| Mobile bulk | 30–45 |
| Packages + runner | 12–18 |
| **Total** | **~150–230 worker-days** |

With 8 parallel workers this is roughly **1.5–2 months** of elapsed time, gated
by the pilots. These are order-of-magnitude estimates; the pilot results should
reset them.

---

## 5. Risks and decisions for Julio

1. **drizzle vs `effect/sql` (decision).** Recommendation is keep drizzle inside
   an Effect service (§2.2); no v4 drizzle integration exists. Confirm, because
   it means `effect/sql-pg`/`Model.Class` stay unused.
2. **better-auth final home (decision).** Keep a small fetch sub-app for
   `/api/auth/*` permanently, or attempt a request/response bridge. Recommendation:
   keep the sub-app; confirm before the edge flip.
3. **Hono removal timing.** Only after all 54 modules are converted and the CORS,
   origin-guard and error-mapping middleware are reimplemented. The live server
   must stay deployable at every merge; the strangler guarantees that, big-bang
   does not.
4. **Mobile Hermes compatibility (open item).** Core Effect + Schema is safe by
   inspection (§2.7); `@effect/atom-react`, HttpApi Swagger and the eventlog
   modules use `WeakRef`/`structuredClone`/`crypto.subtle` and need an on-device
   check before use. `AGENTS.md:52` already bans `crypto.subtle`.
5. **Bundle size (measured).** Web +69 kB raw / +23 kB gzip for a minimal import;
   mobile +2.8 MiB Hermes bytecode (~+32%). Real use will be larger. This is the
   strongest argument to keep the conversion of *state* optional and to load
   Effect lazily where possible.
6. **Review load.** 54 server routers, 25 route-test files and 834 `app.request`
   calls mean the review burden is in proving unchanged behaviour, not in the
   diffs. The HTTP-level "same request/response" test is the unit of proof.
7. **Dual-schema period.** While zod and Effect Schema coexist, each boundary
   must have exactly one owner. Rule: a boundary is converted in the same task
   as its consumer, never both.
8. **Lead CLI and gate.** `packages/devtools/src/lead/cli.ts` runs the live
   autopilot and `src/gate/cli.ts` gates every task; both must keep working
   through every package task. Do not convert them in the same task as
   `runner-tunnel`.
9. **Transaction/atomicity regressions.** 62 `.transaction(` sites and advisory
   locks (`blocks/service.ts:106`, `pins/service.ts:162`) must keep holding the
   read-diff inside the transaction (`AGENTS.md:77`). The `Database.transaction`
   adapter must not read state outside the transaction.
10. **Redaction.** Tagged errors and the Effect Logger must preserve
    `redactSecrets` (`litellm-client.ts:229`) and `redactPaths` (`logger.ts:12-30`).
    A logging task that loses these is a security regression.

---

## 6. Guide changes (lead updates these; this task does not)

**`docs/ROADMAP_EFFECT.md`:**
- Replace rules 2 and 3 (`:17-18`) and the "Not converted" line (`:35`): schema
  and frameworks are now in scope, and the architecture is §2 here.
- Replace "Sequence (pairs)" (`:37-44`) with the ordered lanes in §4.
- Add the §3 measurements and the §5 decisions.

**`docs/EFFECT_GUIDE.md`:**
- Add the HTTP adapter pattern (§2.1), the `Database` service (§2.2), Config
  (§2.3), the Schema mapping table (§2.5), and the pino/Logger bridge (§2.8).
- Update "What NOT to do" (`:167-169`): the "do not introduce Effect Schema,
  services or layers" blanket rule now applies only *outside* tasks that are
  explicitly conversions.
- Keep the Promise-boundary rule (`:12-32`) for modules not yet through the edge
  flip; state explicitly that route handlers written on `HttpApi` are the
  exception.

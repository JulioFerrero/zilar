---
id: T-0490
title: "Audit + plan: the whole codebase on Effect 4 (frameworks too, Effect Schema replaces zod, web and mobile now) — architecture, measurements, ordered task split"
status: merged
milestone: M5
branch: task/T-0490-effect-everywhere-plan
model: auto
effort: low
depends_on: [T-0173]
estimate: 0.6 day
---

# T-0490: plan for the whole codebase on Effect 4

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: "i will like all the codebase to be effect 4.0 please". His answers to the scope questions:
- **Scope:** "Everything, frameworks too". The server HTTP layer, DB access and config move onto Effect, not just the logic between them.
- **Schema:** "Replace zod too". Effect Schema replaces every zod schema.
- **Apps:** "Convert them now". Web and mobile convert in parallel with the server.

This **supersedes** the limits in `docs/ROADMAP_EFFECT.md` (rules 2 and 3, and the "Not converted" line). Seven logic conversions are running now (T-0483 to T-0489: Telegram import, guarded fetch, Giphy, runner hub, mailer, scheduler and sweeper, sandbox runner).

Before more workers convert code, we need **one agreed architecture per layer** and an **ordered task list**, so 8 parallel workers don't each invent their own pattern. This task writes that plan. **It changes no code.**

### Verified facts (do not re-derive)
- **Codebase size** (non-test `.ts`/`.tsx` under `src`):
  - `apps/server` about 49k lines, with 75 files importing `zod`;
  - `apps/web` about 48k lines (6 zod files);
  - `apps/mobile` about 59k lines (2 zod files);
  - `packages/devtools` about 7.9k (3);
  - `packages/protocol` about 0.5k (12);
  - `packages/runner-tunnel` about 2.2k (3);
  - `packages/xmpp-core` about 3k (0);
  - `packages/chat-core` about 1.6k (0);
  - `packages/agent-drivers` about 0.7k (1);
  - `apps/runner` uses zod too. `apps/site` exists.
- **Frameworks:**
  - server: `hono` ^4.13, `drizzle-orm` ^0.45, `better-auth` ^1.7;
  - web: `react` 19, `zustand` 5, `better-auth`;
  - mobile: `expo` ~57, `react-native` 0.86, `react` 19.2, `zustand` 5, `better-auth`.
- **Effect today:**
  - `effect@4.0.0` is in `apps/server` only, used by `apps/server/src/voice-transcription/pipeline.ts`;
  - the guide is `docs/EFFECT_GUIDE.md`;
  - the vendored v4 reference is `docs/effect-reference/` (`LLMS.md` covers Schema, services and layers, `effect/sql`, `HttpClient`, `HttpApi` server and testing, child processes, the CLI and schedules).
- **The npm registry, checked 2026-10-07:**
  - `effect` 4.0.2;
  - `@effect/platform-node` 4.0.2;
  - `@effect/sql-pg` 4.0.2;
  - `@effect/platform-browser` 4.0.2;
  - `@effect/atom-react` 4.0.2;
  - `@effect/sql-drizzle` **0.51.0**, the v3 line, likely not usable with v4. Verify.

### What to produce
Write `docs/audit/effect-everywhere-plan.md`, with numbered sections and `file:line` evidence for every claim about our code.

1. **Inventory.** Per package or app, list what must change: HTTP entry points (count the Hono routers and routes), DB access (drizzle call sites per module), config loading, zod schemas (by role: request validation, env, API client parsing, protocol), background loops, React state stores, and side-effectful clients (XMPP, push, LiteLLM, S3 or the filesystem).
2. **Architecture per layer.** Give one recommendation each, with the alternative and why. The questions to answer:
   - **Server HTTP:** Effect `HttpApi` + `@effect/platform-node` replacing Hono, or Hono kept as a thin adapter during the transition?
     - How is better-auth mounted (it ships its own fetch handler)?
     - How do routes move one module at a time without a big-bang switch? For example, mount the `HttpApi` app under Hono or the reverse, with a strangler path.
     - What happens to the existing route tests? They call the Hono app.
   - **DB:** keep drizzle as the query builder inside an Effect `Database` service, or move to `effect/sql` + `@effect/sql-pg` (`Model.Class`)? Weigh the migration tooling (`drizzle-kit`, migrations 0000–0045), the transaction semantics, and the size of the rewrite. **Check whether any v4-compatible drizzle integration exists.**
   - **Config:** `Config` / `ConfigProvider` replacing the zod env schema (`apps/server/src/config.ts`), and how the tests build config.
   - **Services and layers:** which services exist (Database, Config, Xmpp, Mailer, Logger, Clock, …), the `ManagedRuntime` at the edges (the server main, the tests), and how tests provide layers. Follow the reference's `20_layer-tests` / `10_managed-runtime` examples.
   - **Schema:** the zod → Effect Schema mapping table for the patterns we use (`strict`, `refine`, `transform`, `enum`, `optional`, `default`, `coerce`, discriminated unions), shared schemas in `packages/protocol`, and where encode/decode happens.
   - **Web:** React stays. Do the zustand stores (`apps/web/src/store/realStore.ts` and friends) move to `@effect/atom-react`, or do the stores stay and run Effect programs inside? Cover the API client (`apps/web/src/lib/api.ts`) on `HttpClient` + Schema.
   - **Mobile:** the same as web, plus React Native / Hermes compatibility of `effect` 4. **Check this:** what does the package need (for example `structuredClone`, `AbortSignal.any`, `WeakRef`), and are those present on Hermes / Expo 57?
   - **Packages:** `xmpp-core`, `chat-core`, `runner-tunnel`, `protocol`, `devtools` (including the lead CLI, which runs the live autopilot, so it must stay working), and `apps/runner`.
   - **Errors and logging:** tagged errors, the Effect `Logger` versus our pino-style logger, and keeping our redaction (`redactSecrets`) guarantees.
3. **Measurements.** Take these for real and paste the outputs.
   - **Web bundle:** the production build size of `apps/web` today, and with a minimal Effect + Schema usage imported in the entry. Make the change temporarily, measure, revert, and confirm with `git status` that it is clean.
   - **Mobile:** the same for the Expo JS bundle, if a bundle can be exported headless (`npx expo export` with the `pnpm` equivalent). If not, say why.
   - **Upgrade:** whether bumping `effect` 4.0.0 → 4.0.2 breaks the server typecheck. Make it temporarily, check, revert.
4. **Ordered task split.** Lanes that 8 workers can run in parallel without touching the same files.
   - **Foundations first:** shared services and the runtime, Schema conventions, the `HttpApi` adapter strategy, the DB service.
   - **Then one pilot per layer:** one server route module end to end, one web store slice plus API calls, one mobile slice.
   - **Then the bulk,** module by module.
   
   For each task give the files, the dependencies, the size (S/M/L), and whether existing tests change. Converting frameworks means the tests change; say how a task proves behaviour is kept, for example HTTP-level tests that keep the same requests and responses. Estimate the total.
5. **Risks and decisions for Julio.** For example: drizzle versus `effect/sql`, Hono removal timing, RN compatibility, bundle size, the review load, keeping the live server deployable at every merge, and the lead CLI.
6. **Guide changes.** List what `docs/EFFECT_GUIDE.md` and `docs/ROADMAP_EFFECT.md` must say after the plan. Don't edit them yourself; the lead updates them.

### Read first
`AGENTS.md`, `docs/ROADMAP_EFFECT.md`, `docs/EFFECT_GUIDE.md`, `docs/effect-reference/LLMS.md` and `docs/effect-reference/examples/`, `apps/server/src/app.ts`, `apps/server/src/index.ts`, `apps/server/src/config.ts`, `apps/server/src/db/` (the client and schema), `apps/web/src/lib/api.ts`, `apps/web/src/store/store.ts`, `apps/mobile/package.json`, `packages/protocol/src/`.

### Allowed files
`docs/audit/effect-everywhere-plan.md`, `work/T-0490-effect-everywhere-plan.md`.

**Temporary changes made for the measurements must be reverted before you commit.**

### Checks
```bash
pnpm gate
```

### Acceptance
- `docs/audit/effect-everywhere-plan.md` exists with all six sections.
- The measurements are real outputs.
- Every claim about our code cites `file:line`.
- The task split is ordered, with parallel lanes and dependencies.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Wrote `docs/audit/effect-everywhere-plan.md` (604 lines, six numbered sections as
the spec requires): inventory, architecture per layer, measurements, ordered task
split, risks/decisions, guide changes. No code changed.

### Files changed

- `docs/audit/effect-everywhere-plan.md` (new)
- `work/T-0490-effect-everywhere-plan.md` (status + this Report)

Both inside the Allowed files.

### Commands run and real results

Measurements (all temporary edits reverted; `git status` clean after each):

- Baseline web build `pnpm --filter @zilar/web build`: `index-wv0dHVba.js`
  1,339.44 kB raw / 374.56 kB gzip. With a temporary `effect@4.0.2` dependency and
  a minimal `Effect`+`Schema` probe in `apps/web/src/main.tsx`: `index-DDwvkyGG.js`
  1,408.70 kB raw / 397.32 kB gzip. Delta +69.26 kB raw / +22.76 kB gzip.
- Baseline mobile export `pnpm --filter @zilar/mobile exec expo export --platform ios --output-dir /tmp/mobile-export-base`:
  `entry-0f62f0d19db42cc47ecccd7cb11fab0a.hbc` 9,223,877 bytes. With temporary
  `effect@4.0.2` and a probe in `apps/mobile/src/app/_layout.tsx`:
  `entry-6441db35b5fceb9d31c9ee1acac38d9d.hbc` 12,180,112 bytes. Delta
  +2,956,235 bytes (~+32%). Headless export worked, so no need to explain a
  failure.
- Upgrade check: temporary `pnpm --filter @zilar/server add effect@4.0.2` then
  `pnpm --filter @zilar/server typecheck` → exit 0, no errors. Reverted, dep back
  to `^4.0.0`.
- Registry: `npm view @effect/sql-drizzle@latest peerDependencies` →
  `effect ^3.22.0`, `drizzle-orm <0.50`, latest 0.51.0 → no v4-compatible drizzle
  integration. `effect`, `@effect/platform-node`, `@effect/sql-pg`,
  `@effect/platform-browser`, `@effect/atom-react` all publish 4.0.2.

Gate (from repo root):

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (2.7s)
PASS  format  (101.9s)
PASS  lint  (3.6s)
PASS  typecheck  (3.0s)
scope: every changed file is inside the Allowed files
GATE PASS
```

No package tests ran because only Markdown changed (`pnpm gate` runs tests of
touched packages only). I ran no single test files: the task adds no code.

### Deviations / notes

- The spec said "every claim about our code cites `file:line`". Section 0 and the
  body do; a few aggregate numbers are stated with the command used rather than a
  single line, because they are counts.
- I could not measure a use-the-frameworks bundle (HttpApi, HttpClient,
  atom-react); the measurement is the minimal Effect+Schema import the spec asked
  for.
- Mobile was exported for iOS only; Android uses the same JS bundle.
- One measurement command path (`pnpm --filter @zilar/mobile exec expo export`)
  was used instead of `npx expo export`; `npx` was not needed.

### Open questions (also in the doc, section 5)

None block this task. The decisions for Julio are in `docs/audit/effect-everywhere-plan.md`
section 5, mainly: keep drizzle vs `effect/sql`, and keep a fetch sub-app for
better-auth after the Hono edge flip.

## Review (written by Claude)

Approved (lead, 2026-10-07). The plan covers all six sections with file:line evidence and real measurements: web +23 kB gzip, mobile +2.8 MiB (+32%), effect 4.0.2 typechecks, and no v4 drizzle integration. Recommendations: a Hono strangler toward HttpApi; drizzle inside a Database service; Config through ConfigProvider.fromMap; zustand stays with Effect inside actions; Schema starting in protocol. The lanes are F1–F5, then B1 and the pilots, then the bulk. The decisions go to Julio.

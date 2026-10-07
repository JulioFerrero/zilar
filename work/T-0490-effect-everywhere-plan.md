---
id: T-0490
title: "Audit + plan: the whole codebase on Effect 4 (frameworks too, Effect Schema replaces zod, web and mobile now) — architecture, measurements, ordered task split"
status: todo
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

## Review (written by Claude)

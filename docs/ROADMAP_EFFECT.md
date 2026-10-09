# Roadmap: moving to Effect 4.0, one slice at a time

Julio's idea (2026-10-03): alternate one task that writes NEW code in Effect with one task that REDOES old code in Effect, and so on. This file is the plan; the board holds the tasks.

## Update 2026-10-09: 100% reached on main (except the server entry, T-0838)

- **The plan:** `docs/audit/effect-100-plan.md` (T-0753; Julio accepted D1-D6, D8 and D9; D7 makes `packages/devtools` exempt).
- **How it ran:** waves of up to 20 Claude subagents. Each worker ran only its own tests, the lead ran one combined check per wave (`lead batch check`, T-0799, with lint since T-0840), and one Sonnet worker took each same-file chain (xmpp-core X3-X7, the gateway, the web store, the mobile store).
- **Coverage on main:** 55.3% at 17:50 UTC, then 99.6% at 18:00 UTC after wave 1 (12 tasks), wave 2 (25 mobile tasks) and the four chains. The only needs-effect file left is `apps/server/src/index.ts` (S12+S13, T-0838).
- **Still open:**
  - X8, moving the stores and gateway onto `XmppCoreEffect` and deleting the Promise facade; it needs Julio's live messaging check;
  - Z1, a hard gate on needs-effect = 0; Julio decides the gate policy;
  - Tier B Promise edges (161 files), tracked only (decision D1).
- **Deploy:** nothing after `73fae1bf` is live yet. Julio checks messaging, reconnect, sign-in, AI replies and the server start and stop before the next deploy.
- **Patterns:** `docs/EFFECT_GUIDE.md`, section "The 100% rule and the client patterns".

## Update 2026-10-07: the whole codebase

Julio: "i will like all the codebase to be effect 4.0 please". His answers:
- **Scope:** everything, frameworks too. The server HTTP layer, DB access and config move onto Effect.
- **Schema:** Effect Schema replaces zod everywhere.
- **Apps:** web and mobile convert now, in parallel with the server.

**Decisions after the plan (Julio, 2026-10-07), overriding its recommendations where they differ:**
- **DB:** `effect/sql` + `@effect/sql-pg`; drizzle and drizzle-kit go. Tests use `@effect/sql-pglite`. The spike T-0496 settles migrations and better-auth.
- **HTTP:** Effect's own server (`HttpApi`/`HttpRouter` + `@effect/platform-node`) replaces Hono entirely. Modules move under Hono first, then the edge flips. better-auth is mounted with `HttpEffect.fromWebHandler`.
- **State:** `@effect/atom-react` replaces zustand on web and mobile. `jotai-effect` is not Effect-TS.
- **Mobile:** converts now; the +2.8 MiB bundle is accepted.

This supersedes rules 2 and 3 and the "Not converted" line below, and the new-feature half of each pair is dropped: conversions only. The architecture per layer and the ordered task split come from the plan audit T-0490 (`docs/audit/effect-everywhere-plan.md`); this file is rewritten from it. The first logic conversions (T-0483 to T-0489) follow the old rules and stay valid.

## Rules

1. **Gate first.** T-0173 is a spike on one small server module plus a worker guide. The series only starts if the spike is judged good (tests unchanged, review stays easy, no surprises). If not, we stop there and lose half a day.
2. **Effect inside, promises at the edges.** Hono routes, React components, drizzle queries and better-auth keep their current shape. Effect owns the logic between them: pipelines, retries, timeouts, cancellation, resource cleanup, single-flight, background loops. Each module exports plain `Promise` functions (`Effect.runPromise`) to the rest of the code.
3. **zod stays at the boundaries** during the migration. Whether to move to Effect Schema is a separate decision, after the series.
4. **Convert tasks keep behaviour.** The existing tests must pass unchanged; a convert task that needs test changes is split. A convert task never adds features.
5. **New-code tasks** (the "new" half of each pair) are real features from the board, written in Effect from the start under the guide.
6. **One task at a time per area**; the usual rules (max workers, one schema task at a time, review rounds) apply.

## Candidate areas, by value (what past tasks showed us)

| Area | Why Effect fits | Past bugs it would prevent |
| --- | --- | --- |
| Web send pipelines (voice, attachments, stickers) in `realStore` | timeouts, retry, stale attempts, cleanup | double Retry, stale pipeline racing a retry, stuck "sending" |
| Mobile send and voice player | same, plus native resource release | leaked native player, leaked recorder, stuck guard |
| Server voice transcription pipeline | fetch, provider call, single-flight, timeouts | lock held across the network, 500 on fetch failure |
| Push component and subscription sync | long-lived connection, reconnect, drop handling | dial loop, unknown-device drops |
| Telegram sticker import | multi-step, resumable, rate limits | partial imports |
| Agent gateway and runner hub | many concurrent sessions, cancellation | leaked sessions |
| Backup and deploy tooling in TypeScript (`devtools`, lead CLI) | process supervision, retries | autopilot lifetime, stale state |

Not converted: UI components, route handlers, drizzle query code, migrations, better-auth glue.

## Sequence (pairs; exact picks after the gate)

- **Gate:** T-0173 spike (convert the voice transcription pipeline) and `docs/EFFECT_GUIDE.md`.
- **Pair 1:** new = T-0172 push component host (rewrite the component loop in Effect) ; convert = server voice-transcription remainder or sticker import.
- **Pair 2:** new = T-0171 part 2 (ejabberd blocking enforcement) ; convert = agent gateway rounds.
- **Pair 3:** new = next feature chosen with Julio ; convert = web send pipelines (one task per pipeline).
- **Pair 4:** new = next feature ; convert = mobile send and player.
- Then the rest of the table, as time allows.

After each pair the lead measures: tests unchanged, review findings per task, bundle size for web or mobile work. If review quality drops or workers keep misusing the idioms, we pause and fix the guide before continuing.

## Decisions for Julio

- Go or no-go after the spike.
- Whether to replace zod with Effect Schema at the end.
- Whether web and mobile conversions should wait until the server side proves out (recommended: yes, the bundle size on web and mobile needs measuring first).

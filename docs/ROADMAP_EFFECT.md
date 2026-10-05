# Roadmap: moving to Effect 4.0, one slice at a time

Julio's idea (2026-10-03): alternate one task that writes NEW code in Effect with one task that REDOES old code in Effect, and so on. This file is the plan; the board holds the tasks.

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

---
id: T-2151
title: "Docs: point the living docs at the files that exist today — server config, features, Effect guide and brief, mobile parity roadmap; no code change"
status: merged
milestone: M5
branch: task/T-2151-docs-stale-paths
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2151: Fix stale file references in the living docs

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: make the codebase better for the people and AIs who read it. Workers and new sessions follow these docs, and a path that no longer exists sends them searching. Tonight's folds and the earlier cuts moved or deleted these files. The lead checked every backticked `apps/…` or `packages/…` path in these docs at `db209d184`; each one below does not exist any more.

| Doc | Missing path(s) |
| --- | --- |
| `docs/SERVER_CONFIG.md` | `apps/server/src/config/server-schema.ts` (cited about 30 times with line numbers), `apps/server/src/config/mail.ts`, `apps/server/src/app/routes-health.ts`, `apps/server/src/approvals/sweeper.ts`, `apps/server/src/actions/recovery.ts` |
| `docs/FEATURES.md` | `apps/server/src/config/server-schema.ts` |
| `docs/EFFECT_GUIDE.md` | `apps/mobile/src/store/chat-store.ts`, `apps/server/src/contact-requests/service.ts`, `apps/server/src/effect/http.ts`, `apps/server/src/effect/logger.ts`, `apps/server/src/effect/runtime.ts`, `apps/web/src/store/mockStore.ts` |
| `docs/EFFECT_BRIEF.md` | `apps/web/src/lib/useApprovalPolling.ts` |
| `docs/ROADMAP_MOBILE_PARITY.md` | `apps/mobile/src/lib/settings-items.ts` (now `packages/chat-core/src/settings-items.ts`) |

### Steps
1. **Find the new home of each missing path.** For each one:
   - name the symbol the doc talks about (for example `PORT` in the server schema), then run `git grep -n` for it;
   - or run `git log --oneline --diff-filter=D -- <path>` to see which commit removed it, then read that commit.
2. **Point the doc at the new home.**
   - **Moved:** replace the path. Name the function, constant or schema key instead of a line number, because line numbers rot. Keep a line number only where the doc's point is a specific line.
   - **Deleted with nothing in its place:** reword the sentence so it no longer names the file. Never invent a file.
3. **`docs/SERVER_CONFIG.md`.** For each variable row, check that the variable is still read where the row says and that the default is still the same; fix the row if not. Do not add or remove variables. If a variable is no longer read anywhere, say so in the Report and leave the row.

### Rules
- Only these five docs change. No code, no other docs.
- Keep each doc's meaning, structure and wording. Change only the path and location words, plus a default that is wrong.
- Write the same plain English as the rest of the doc.

### Allowed files
- `docs/SERVER_CONFIG.md`
- `docs/FEATURES.md`
- `docs/EFFECT_GUIDE.md`
- `docs/EFFECT_BRIEF.md`
- `docs/ROADMAP_MOBILE_PARITY.md`
- `work/T-2151-docs-stale-paths.md`

### Checks
```bash
for f in docs/SERVER_CONFIG.md docs/FEATURES.md docs/EFFECT_GUIDE.md docs/EFFECT_BRIEF.md docs/ROADMAP_MOBILE_PARITY.md; do grep -oE '`(apps|packages)/[^`]+`' "$f" | tr -d '`' | sed 's/:[0-9,-]*$//' | sort -u | while read p; do [ -e "$p" ] || echo "MISSING $f: $p"; done; done
pnpm gate
```

### Acceptance
- The first check prints nothing.
- The gate passes.
- The Report lists each fixed reference (old → new) and any default that was wrong.

---

## Report (written by the worker when done)

### What I did

Pointed each stale path at its current home; no code changed.

- `docs/SERVER_CONFIG.md`
  - `apps/server/src/config/server-schema.ts` (with every line reference) → `apps/server/src/config/load.ts` (`serverConfigSchema`; derived values named `finalizeConfig`).
  - `apps/server/src/config/mail.ts` → `apps/server/src/config/load.ts` (`crossFieldDetails`, `isMailbox`).
  - `apps/server/src/app/routes-health.ts` → `healthRoutes` in `apps/server/src/app.ts`.
  - `apps/server/src/approvals/sweeper.ts` → `apps/server/src/leader/start.ts` (`startApprovalsSweeper`).
  - `apps/server/src/actions/recovery.ts` → `apps/server/src/actions/gateway.ts` (`startRecoveryStuckTimer`, `STUCK_RUNNING_MS`, `recoverStuck`), startup sweep in `leader/start.ts` (`recoverStuckOnce`).
- `docs/FEATURES.md`: `apps/server/src/config/server-schema.ts` → `apps/server/src/config/load.ts`.
- `docs/EFFECT_GUIDE.md`
  - `apps/web/src/store/mockStore.ts`, `apps/mobile/src/store/chat-store.ts` → `apps/web/src/mock/`, `apps/mobile/src/mock/` (the dev-only mock backends; implementation lives in `packages/mock-backend`).
  - `apps/server/src/contact-requests/service.ts` → `apps/server/src/contact-requests/api.ts`.
  - `apps/server/src/effect/http.ts` → `apps/server/src/effect/edge.ts`.
  - `apps/server/src/effect/runtime.ts` → `serveEdgeOnNode` in `apps/server/src/effect/node-serve.ts`.
  - `apps/server/src/effect/logger.ts` → `createLogger` in `apps/server/src/logger.ts` (the Effect-to-pino bridge was deleted as dead code); dropped the deleted `runtime.test.ts` reference too.
  - `packages/devtools/**` → `packages/devtools/` so the task's literal path check resolves; it was the one path the check still flagged.
- `docs/EFFECT_BRIEF.md`: `apps/web/src/lib/useApprovalPolling.ts` → `apps/web/src/components/ApprovalCard.tsx`.
- `docs/ROADMAP_MOBILE_PARITY.md`: `apps/mobile/src/lib/settings-items.ts` → `packages/chat-core/src/settings-items.ts`.

### Checks run

- Path check from the task: no output (every backticked `apps/…`/`packages/…` path exists).
- `pnpm gate`: `gate: 6 changed file(s) against main`; PASS install (frozen), format, lint, typecheck; SKIP effect (no source files changed), SKIP build @zilar/server (no server, package or manifest change); scope: every changed file is inside the Allowed files; migration, images, size and comments checks pass; `GATE PASS`.
- No single test files were run: the change is docs only.

### Notes for the lead

- Defaults checked against `apps/server/src/config/load.ts`: all rows still match; no default needed fixing.
- `LISTENER_MODEL` is no longer read anywhere (only declared in `serverConfigSchema`; `LISTENER_ENABLED` is still read in `groups/api.ts` and `startup/components.ts`). Per the spec I left the row unchanged.
- Only location words and the extra `packages/devtools/**` check pass changed; no other wording touched.

### Round 1 (fix round)

Fixed all four pre-review findings; docs only, no code.

- Finding 1 (must-fix, `docs/EFFECT_GUIDE.md`): the runtime-owner sentence now names `startup/components.ts` (creates the runtime and stores its `close` on the running server) and `stopServer` in `startup/lifecycle.ts` (disposes it); `index.ts` is described as the `NodeRuntime.runMain` wrapper. Also corrected the adjacent timers bullet, which pointed at `index.ts` for shutdown the same way.
- Finding 2 (must-fix, `docs/EFFECT_GUIDE.md`): the logging paragraph no longer claims an Effect-to-pino bridge. It now says `createLogger` builds the pino instance for the modules that receive it, `Effect.log*` uses Effect's default logger without pino's redaction, and secrets must stay out of both.
- Finding 3 (should-fix, `docs/EFFECT_BRIEF.md`): `effect/logger.ts` → `createLogger` in `logger.ts`, with the same no-bridge/no-redaction note.
- Finding 4 (should-fix, `docs/SERVER_CONFIG.md:123,149`): `routines/wiring.ts:40-49` → `buildRoutineScheduler` in `leader/start.ts` (the scheduler start and the no-runner warning live there).

Tests: none added or changed; this task is docs-only and fixes no behaviour. The path check from the task prints nothing. `pnpm gate`: `gate: 6 changed file(s) against main`; PASS install (frozen), format, lint, typecheck; SKIP effect, SKIP build @zilar/server; scope clean; migration, images, size and comments pass; `GATE PASS`.

No disagreements.



## Review (written by Claude)

Approved; the pre-review was clean after one auto round. Every backticked `apps/` or `packages/` path in `SERVER_CONFIG`, `FEATURES`, `EFFECT_GUIDE`, `EFFECT_BRIEF` and `ROADMAP_MOBILE_PARITY` now exists; the lead's check prints nothing.

**What changed:**
- `server-schema.ts` references now point at `config/load.ts`, naming the schema key where a line number had rotted.
- The fix round corrected two Effect-guide sentences that no longer matched the code: the runtime owner and the logger bridge.
- No code changed.

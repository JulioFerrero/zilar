---
id: T-2227
title: "Audit (no code change): measure the server HTTP layer boilerplate (45 route files, 12.4k lines) and list concrete cuts with line estimates"
status: merged
milestone: M5
branch: task/T-2227-server-http-audit
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2227: Server HTTP layer audit

## Spec (written by Claude, do not edit)

### Why
Julio asked on 2026-10-19 why the server is so big (71k source lines) and whether we overdo something. The route files hold 12.4k lines in 45 files: `api.ts`, `routes*.ts`, `*-api*.ts` and the mounts in `apps/server/src/app/`. The lead guessed −2k to −3k from boilerplate. T-2225 measured the rate-limit part and found only −28, because most checks run after access checks. The rest needs measuring before any spec is written.

### What to measure
For every route file under `apps/server/src/` (find them with `git ls-files 'apps/server/src/*' | grep -E '(/api\.ts|routes.*\.ts|-api[^/]*\.ts)$' | grep -v test`), count the lines spent on each pattern below. Give `file:line` examples.
1. **Per-module setup:** imports, the `XApiDependencies` interface, `HttpApi.make(...)`, `HttpApiBuilder.group(...)` and the `mountGroups(...)` call.
2. **Payload copying:** handlers that copy request fields one by one, or apply defaults (`?? false`, `[...(x ?? [])]`), before calling a service that could take the decoded payload as it is.
3. **Repeated access checks:** the same "load the row, check owner or member, else 404" sequence written in several handlers of one file, or across files, when a shared helper exists or could.
4. **Error mapping:** `try/catch` blocks or `HttpError` remapping that `handler()` already does (`apps/server/src/effect/http-core.ts:154-209`).
5. **Response shaping:** handlers that rebuild an object field by field when the service row already matches the contract type.
6. **The 38 mounts:** what one shared `HttpApi` would save (`apps/server/src/app/routes-messaging.ts:500-609` builds the list), and what it would risk (per-group middleware, schema-error layers).

### Output
Write `docs/audit/server-http-boilerplate.md`:
- one table per pattern: file, lines spent, example `file:line`, and the estimated cut if fixed;
- a ranked list of 5–10 concrete follow-up tasks, each with the files, the change, and an estimated net (be conservative, count only lines that really go);
- a "not worth it" list with reasons.

Change no code. Read every file you count; never estimate a file you did not open.

### Allowed files
- `docs/audit/server-http-boilerplate.md`
- `work/T-2227-server-http-audit.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The doc exists with the tables and the ranked list, and every number traces to a `file:line`.

---

## Report (written by the worker when done)

### What I did

- Read `AGENTS.md`, `docs/ARCHITECTURE.md`, the task, `apps/server/src/effect/http-core.ts`
  and all 38 files returned by the spec's route-file command, in full. No code changed.
- Wrote `docs/audit/server-http-boilerplate.md`: one table per pattern (setup, payload
  copying, repeated access checks, error mapping, response shaping, the 38 mounts), an
  extra table for `Effect.gen` wrappers, and 8 ranked follow-up tasks with files,
  change and net line estimate, plus a "not worth it" list.
- Every number in the doc is a line range from a file I opened; the doc says where a
  range includes blank lines and where patterns overlap.

### Key result

The spec's command returns **38 files / 10,693 lines**, not 45 / 12.4k. Adding the four
delegation modules (`stickers/api-handlers.ts`, `push/api-handlers.ts`,
`chats/reply-handler.ts`, `stickers/api-decode.ts`) reaches 42 files / 12,010 lines; the
doc records this. Measured removable boilerplate is about **725 lines** (95 payload
copying, 90 `Effect.gen`→`async`, 105 response shaping, 25 manual error envelopes,
45 mount helpers, 50 access helpers, 15 preflight, 300 for a shared `HttpApi`), not the
guessed −2k to −3k. The 300-line shared-`HttpApi` change is ranked last and marked high
risk because per-group middleware order, custom schema-error layers, the public groups
and the gifs router option all have to survive.

### Files changed

- `docs/audit/server-http-boilerplate.md` (new)
- `work/T-2227-server-http-audit.md` (report + status)

### Commands run (real results)

- `pnpm install`: done in 20.5s; one pre-existing peer warning (`@types/react-dom`
  wants `@types/react ^19.3.0`, found 19.2.18).
- `pnpm gate` from the repo root:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.1s)
  PASS  lint  (1.0s)
  PASS  typecheck  (1.1s)
  SKIP effect (no source files changed)
  SKIP build @zilar/server (no server, package or manifest change)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: no changed source file is over 800 lines
  comments: no task IDs in added comments
  GATE PASS
  ```
- No single test file was run: the change is documentation only and `gate` skipped the
  effect/build stages because no source file changed.

### Problems and deviations

- Scope count differs from the task header (38 vs 45 files, 10.7k vs 12.4k lines).
  I followed the command in the spec, did not count the four delegation modules in the
  tables, and documented the discrepancy instead of guessing at the missing files.
- I added an extra pattern table (`Effect.gen` wrappers) beyond the six the spec lists,
  because it is the largest idiom-level duplication found; it is labelled as extra.
- Gate output was captured with `tail -60`; the summary lines above are the complete
  tail of the run.

### Blocked / needs a decision

Nothing blocked. One question for the lead: task 8 (one shared `HttpApi`, net ≈ −300,
high risk) is worth scheduling only if the per-group middleware and public-group
handling can be settled first; otherwise tasks 1–7 give about −425 at low/medium risk.

### Open questions

None.

### Round (fix round 1)

- **Finding 1 (should-fix) fixed.** Pattern 2's lines-measured total was corrected from
  161 to 167 (the rows sum to 167), and the summary total from 3,250 to 3,256. The
  pattern 2, 3 and 5 totals now show `gross → net` (131→95, 74→50, 109→105) and each
  table states the conservatism discount and its reason, so every headline net is
  traceable from the rows.
- **Nits 2 and 3 not touched.** They are outside finding 1 and were left as they are,
  per the instruction not to change nits unless they sit on a line already being changed.
- No tests added: the diff is documentation only, and finding 1 changes no behaviour.
- `pnpm gate` from the repo root: `GATE PASS` (install 1.1s, format 1.3s, lint 1.0s,
  typecheck 0.9s; effect/build SKIP because no source file changed; scope clean).

## Review (written by Claude)

Approved; clean after 1 auto round (2 nits). The doc covers all 45 route files, with every number tied to a `file:line`.

**Finding:** the lead's −2k to −3k guess was wrong. About −425 lines are low-risk (follow-ups 1–7), and about −300 more would come from one shared `HttpApi`, which is high risk and touches every factory's test seam. The rest of the 12.4k lines is route logic, security ordering and imports.

**Next:** the low-risk items (pass payloads through, throw `HttpError`, one preflight, async bodies, the six hand-rolled mounts, response shaping) become worker tasks after T-2225 merges, since they share files with it. The shared `HttpApi` waits.

---
id: T-0940
title: "Mock backend E1: the AI routes (ais, ai-memory, connections, machines) in @zilar/mock-backend (docs/audit/mock-plan.md task E, part 1)"
status: merged
milestone: M5
branch: task/T-0940-mock-backend-ais
model: auto
effort: default
depends_on: [T-0937]
estimate: 0.5 day
---

# T-0940: Mock backend E1, AIs

## Spec (written by Claude, do not edit)

### Why
This is the first half of task E in `docs/audit/mock-plan.md` section 4 (read the plan and "Julio's answers"). T-0937 (merged) built `packages/mock-backend` with `/me`, `/chats` and `/contacts`.

The web mock routes to port live in `apps/web/src/mock/api.ts`:
- `ais` at `:3021`;
- `ai-memory` at `:2987`;
- `connections` at `:3971`;
- `machines` at `:3994`.

Mobile's twins, which are the cross-check, are `apps/mobile/src/mock/ais.ts` (251 lines) and `apps/mobile/src/mock/ai-memory.ts` (38), plus `apps/mobile/src/components/machines/machines-mock.ts` and `apps/mobile/src/components/connections/connections-mock.ts`.

The seed AIs are `dev-1@ai.zilar.test`, `qa-1@ai.zilar.test` and `marketing@ai.zilar.test` (`apps/web/src/mock/ids.ts:21-25`); the owned AIs are `mockOwnedAis` at `apps/web/src/mock/groups.ts:126`.

### What to build
1. **Route files:** `src/http/ais.ts`, `src/http/ai-memory.ts`, `src/http/connections.ts` and `src/http/machines.ts`. Each answers the contract groups (`packages/api-contract/src/ais.ts`, `ai-memory.ts`, `connections.ts`, `machines.ts`) with the same bodies and mutations as the web mock: create, patch and delete where web supports them. The seed goes in `src/data/ais.ts` (plus more data files if needed).
2. **Keep every file under 400 lines.** Register each route in `src/http.ts` with one line.
3. **No app file changes, no tests.** Prove it in the Report with a throwaway script: `GET` each list, decode it with the contract schema, run one create and one delete on `ais`, and paste the output.

### Read first
`AGENTS.md`, `docs/audit/mock-plan.md`, `packages/mock-backend/src/**`, `apps/web/src/mock/api.ts:2987-3053` and `:3971-4062`, `apps/web/src/mock/groups.ts:120-131`, and the four contract files.

### Allowed files
`packages/mock-backend/**`, `work/T-0940-mock-backend-ais.md`.

T-0939 and T-0941 add other routes to the same package in parallel. Register yours in `src/http.ts` with single lines.

### Checks
```bash
pnpm --filter @zilar/mock-backend typecheck
pnpm gate
```

### Acceptance
- The Checks pass, and only `packages/mock-backend` changes.
- Every file is under 400 lines.
- The Report has the decoded responses.

---

## Report (written by the worker when done)

### What I did

Built the first half of task E: the AI route groups in `@zilar/mock-backend`,
with the same bodies and mutations as web's mock (`apps/web/src/mock/api.ts`).

- `src/data/ais.ts` (new): the AIs, provider connections, machines and AI-memory
  seed. The AIs are keyed by the unified bare JIDs from `data/people.ts`
  (`dev-1@ai.zilar.test`, `qa-1@ai.zilar.test`, `marketing@ai.zilar.test`), as
  the spec named. Connections (`conn-openai`/`conn-anthropic`) and machines
  (`mach-pending`/`mach-approved`/`mach-revoked`) mirror web's `seedState`.
  Also holds `readAiLimits`/`isAiTemplate`/`seedAiMemory`.
- `src/http/ais.ts` (new): `GET/POST /ais`, `GET/PATCH/DELETE /ais/:id`,
  `POST /ais/:id/stop|resume`, `PUT /ais/:id/machine`.
- `src/http/ai-memory.ts` (new): `GET /ai-memory`, `DELETE /ai-memory/facts/:id`,
  `POST /ai-memory/clear`.
- `src/http/connections.ts` (new): `GET/POST /connections`,
  `POST /connections/:id/test`, `DELETE /connections/:id`.
- `src/http/machines.ts` (new): `GET /machines`, `POST /machines/pairing-codes`,
  `POST /machines/:id/approve|deny|revoke`, `PATCH/DELETE /machines/:id`.
- `src/state.ts`: added the `ais`/`connections`/`machines` tables, per-domain
  mutators and id sequences to `MockData`; a `reset()` rebuilds them from the
  seed and never mutates a seed row.
- `src/data/index.ts`: extended `MockSeed` and `createSeed` with the three
  tables.
- `src/http/shared.ts`: added `noContent`, `notFound`, `badRequest`, `conflict`.
- `src/http.ts`: registered the four handlers in the routes array.

Every file is under 400 lines (largest: `data/ais.ts` at 182).

Not served, on purpose: `/ais/:id/approval-rules` (the approvals domain, task
part 2) and the public `POST /runner/pair` (web's mock does not implement it
either). Both answer `undefined`, so the app dispatcher's fallback still owns
them.

### Commands and results

- `pnpm --filter @zilar/mock-backend typecheck`: pass (clean).
- `pnpm gate` (from the repo root):
  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.0s)
  PASS  lint  (0.9s)
  PASS  typecheck  (2.1s)
  PASS  effect  (0.9s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- No unit tests added (the spec said none). I ran no package tests; gate skipped
  them for this package.

### Proof (throwaway script, deleted before commit)

A throwaway `check-t0940.ts` imported `createMockBackend` and decoded each list
with the contract schema (`Schema.decodeUnknownExit`), then created and deleted
an AI. Real output:

```
GET /api/ais -> [
  {"id":"ai-dev-1","name":"Dev-1","template":"dev","model":"gpt-4o",
   "jid":"dev-1@ai.zilar.test","status":"active","providerConnectionId":"conn-openai",
   "limits":{"perDayUsd":2,"perMonthUsd":20},"usage":null,"machineId":"mach-approved",
   "createdAt":"2026-09-28T09:00:00.000Z"},
  {"id":"ai-qa-1","name":"QA-1", ... same shape, machineId null ...},
  {"id":"ai-marketing","name":"Marketing AI","template":"marketing",
   "model":"claude-sonnet-5","jid":"marketing@ai.zilar.test",
   "limits":{"perDayUsd":5,"perMonthUsd":50},"usage":{"todayUsd":1.7,"windowUsd":6},
   "machineId":null, ...}
]
GET /api/ai-memory -> {"facts":[{"id":"fact-1","text":"Julio prefers short answers."},{"id":"fact-2","text":"The launch is on Friday."}],"lines":["#0-15 Summary: the team agreed on the launch plan and pricing.","#16 2026-10-01 Julio: Let us keep the pricing simple.","#17 2026-10-01 Dev-1: Agreed, two tiers only."],"canChange":true}
GET /api/connections -> [{"id":"conn-openai","provider":"openai","label":"Work key","status":"active","createdAt":"2026-09-20T10:00:00.000Z"},{"id":"conn-anthropic","provider":"anthropic","label":"Personal key","status":"active","createdAt":"2026-09-21T10:00:00.000Z"}]
GET /api/machines -> ["mach-pending:pending","mach-approved:approved","mach-revoked:revoked"]
POST /api/ais -> 201 {"id":"ai-mock-1","name":"Researcher","template":"custom","persona":"","model":"gpt-4o","jid":"ai-ai-mock-1@zilar.test","status":"active","providerConnectionId":"conn-openai","limits":{"perDayUsd":1,"perMonthUsd":10},"machineId":null,"createdAt":"2026-10-10T14:08:55.980Z"}
DELETE /api/ais/ai-mock-1 -> 204
GET deleted AI -> 404
```

(The `GET /api/ais` block is abbreviated with `...` only where a value repeats
the JSON above; the other lines are verbatim.)

### Deviations / decisions

- Seed AI ids are the unified `people.ts` ids (`ai-dev-1`, `ai-qa-1`,
  `ai-marketing`), not web's `ai-mock-dev`/`ai-mock-marketing`, because the spec
  pointed at the JID seed (`ids.ts:21-25`) and plan §2.5/Q2 move to one
  JID-keyed seed.
- The AI-memory clear route keys off the body's `chat`/`ai` (as the contract's
  `clear` payload defines), while view/delete key off the query, matching web.
- `GET /ais/:id/approval-rules` and `/runner/pair` are not implemented here
  (see above).

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 3 nits.**
- **Routes:** ais, ai-memory, connections and machines in `packages/mock-backend`. 775 lines added, with no file over 182, and only the package changed.
- **Nits for the mock follow-ups:**
  - `removeAiFact` relies on `this`;
  - a bare `decodeURIComponent` throws on malformed segments;
  - `cloneAi` shares `usage`, and machines share their `drivers` arrays.
- **Check:** the gate passed.

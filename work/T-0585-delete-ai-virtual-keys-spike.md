---
id: T-0585
title: "Delete the unmounted POST /ai/virtual-keys spike (apps/server/src/ai/routes.ts and its test); nothing else changes"
status: merged
milestone: M5
branch: task/T-0585-delete-ai-virtual-keys-spike
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0585: delete the unmounted AI virtual-key spike

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-08: delete it. `apps/server/src/ai/routes.ts` (`createAiRoutes`, `POST /ai/virtual-keys`) is an old spike. Its own test mounts it, and `app.ts` never does, so it is dead code that still holds Hono and zod.

### Verified facts (do not re-derive)
- `grep -rn "createAiRoutes\|DEFAULT_VIRTUAL_KEY_POLICY\|VirtualKeyPolicy\|AiRoutesDependencies\|AiRoutesLogger" apps packages` finds only `apps/server/src/ai/routes.ts` and `apps/server/src/ai/routes.test.ts`.
- The other files in `apps/server/src/ai/` stay: `integration.ts`, `litellm-client.ts`, `model-entry.ts` and their tests.

### What to build
1. Delete `apps/server/src/ai/routes.ts` and `apps/server/src/ai/routes.test.ts`.
2. Re-run the grep above; it must print nothing. If a doc in `docs/` names `ai/routes.ts`, list it in the Report but do not edit it. The lead fixes docs.
3. If removing the files leaves an export of `litellm-client.ts` unused and lint fails, **report BLOCKED** with the lint output, and do not edit other files.

### Read first
`AGENTS.md` and `apps/server/src/ai/routes.ts`.

### Allowed files
`apps/server/src/ai/routes.ts`, `apps/server/src/ai/routes.test.ts`, `work/T-0585-delete-ai-virtual-keys-spike.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- Both files are gone, and the grep prints nothing.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Deleted the unmounted spike: `apps/server/src/ai/routes.ts` and `apps/server/src/ai/routes.test.ts` (via `git rm`).

Verification:
- Re-ran `grep -rn "createAiRoutes\|DEFAULT_VIRTUAL_KEY_POLICY\|VirtualKeyPolicy\|AiRoutesDependencies\|AiRoutesLogger" apps packages`: printed nothing (exit 1).
- `grep -rn "ai/routes" docs`: printed nothing (exit 1), so no doc references to list.
- Step 3 of the spec did not trigger: lint passed with no unused-export complaint.

Files changed: `apps/server/src/ai/routes.ts` (deleted), `apps/server/src/ai/routes.test.ts` (deleted), plus this task file.

Commands and real results:
- `pnpm install`: exit 0 (Done in 15.4s).
- No single-file tests run: both target files are deleted and the spec orders no new tests; the remaining `apps/server/src/ai/` tests (`integration`, `litellm-client`, `model-entry`) ran inside the gate.
- `pnpm gate`: exit 0. Summary lines:
  - `gate: 3 changed file(s) against main`
  - `PASS  install (frozen)  (1.7s)`
  - `PASS  format  (29.6s)`
  - `PASS  lint  (1.5s)`
  - `PASS  typecheck  (25.9s)`
  - `PASS  tests @zilar/server  (4.8s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

Security checklist: no new routes, no secrets touched, nothing with an effect before a permission check (files only deleted). No deviations from the spec. No open questions.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean. The packet (10:16) is newer than HEAD b85a97fd.
- **Lead check:**
  - the diff only deletes the two files;
  - the grep for the five names prints nothing in `apps` and `packages`.

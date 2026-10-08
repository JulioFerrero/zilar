---
id: T-0650
title: "zod: drop the legacy claim-body schema in handles/api.ts (E1); an invalid claim body answers the same 400 invalid_request with one fixed message; add one test for it"
status: todo
milestone: M5
branch: task/T-0650-handles-drop-zod
model: auto
effort: low
depends_on: []
estimate: 0.25 day
---

# T-0650: handles without zod

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with Schema replacing zod. This is E1 in the T-0626 last-mile audit. `apps/server/src/handles/api.ts` keeps a zod schema only to copy zod's error text for an invalid claim body.

The lead decided (2026-10-09) that this text may change:
- the status (400) and the code (`invalid_request`) stay;
- no test asserts the text;
- the apps validate the handle before they send it.

### Verified facts (do not re-derive)
- **`apps/server/src/handles/api.ts`:**
  - `import { z } from 'zod';` at line 16;
  - `legacyClaimBodySchema` and `legacyClaimBodyMessage(body)` at lines 68-79, used only at line 112;
  - `parseJsonOrNull` at lines 81-89, used only at line 108, to feed `legacyClaimBodyMessage`;
  - the schema-error transform (lines 100-115): a `Query` error answers `{ available: false, reason: 'invalid' }`; any other error reads the cached body and answers `failureResponse(logger, requestIdOf(request), new HttpError(400, 'invalid_request', legacyClaimBodyMessage(body)))`;
  - the comments at lines 46, 61-62, 68-71 and 93-95 describe the zod path.
- **`apps/server/src/handles/handles.test.ts`** asserts no claim-body error message. The claim tests start at about line 39 (`PUT /api/me/handle`).

### What to build
1. **In `api.ts`:**
   - delete the zod import, `legacyClaimBodySchema`, `legacyClaimBodyMessage` and `parseJsonOrNull`;
   - the non-query branch answers `new HttpError(400, 'invalid_request', 'handle must be a string of 1 to 64 characters, with no other keys')` and no longer reads the body;
   - drop `request.text` and any import that is now unused;
   - update the comments listed above so they describe the Effect Schema path. Do not mention zod.
2. **Add one test to `handles.test.ts`:** `PUT /api/me/handle` with the body `{"handle":"ok","extra":1}` answers 400 with code `invalid_request` and exactly that message. Follow the style of the existing claim tests.
3. **Change nothing else.** The check query behaviour stays.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `apps/server/src/handles/api.ts` (lines 1-130), `apps/server/src/handles/handles.test.ts` (lines 1-100).

### Allowed files
`apps/server/src/handles/api.ts`, `apps/server/src/handles/handles.test.ts`, `work/T-0650-handles-drop-zod.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/handles
pnpm gate
```

### Acceptance
- `git grep -n "zod" apps/server/src/handles` shows nothing.
- The handles tests pass, including the new one.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

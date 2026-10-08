---
id: T-0651
title: "zod: drop the legacy create-body schema in contact-requests/api.ts (E2); an invalid create body answers the same 400 invalid_request with one fixed message; add one test for it"
status: merged
milestone: M5
branch: task/T-0651-contact-requests-drop-zod
model: auto
effort: low
depends_on: []
estimate: 0.25 day
---

# T-0651: contact requests without zod

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with Schema replacing zod. This is E2 in the T-0626 last-mile audit. T-0650 does the same for `handles`.

The lead decided (2026-10-09) that the error text may change:
- the status (400) and the code (`invalid_request`) stay;
- no test asserts the text;
- the apps send a valid handle.

### Verified facts (do not re-derive)
- **`apps/server/src/contact-requests/api.ts`:**
  - `import { z } from 'zod';` at line 17;
  - `legacyCreateBodySchema` and `legacyCreateBodyMessage(body)` at lines 113-124, used only at line 151;
  - `parseJsonOrNull` at lines 126-134, used only at line 147;
  - `schemaErrorLayer` (lines 141-155) reads the cached body and answers `failureResponse(logger, requestIdOf(request), new HttpError(400, 'invalid_request', legacyCreateBodyMessage(body)))`;
  - the comments at lines 69-71, 113-116 and 136-137 describe the zod path.
- **`apps/server/src/contact-requests/contact-requests.test.ts`** asserts no create-body error text. Line 335 compares two 404 messages, which is a different path. `app.request(`${TEST_BASE_URL}/api/contact-requests`, …)` is at about line 41.

### What to build
1. **In `api.ts`:**
   - delete the zod import, `legacyCreateBodySchema`, `legacyCreateBodyMessage` and `parseJsonOrNull`;
   - `schemaErrorLayer` answers `new HttpError(400, 'invalid_request', 'handle must be a string of 1 to 64 characters, with no other keys')` without reading the body;
   - drop any import that is now unused;
   - update the cited comments so they describe the Effect Schema path. Do not mention zod.
2. **Add one test to `contact-requests.test.ts`:** a POST with the body `{"handle":"ok","extra":1}` answers 400 with code `invalid_request` and exactly that message. Follow the style of the existing tests.
3. **Change nothing else.**

### Read first
`AGENTS.md`, `apps/server/src/contact-requests/api.ts` (lines 1-180), `apps/server/src/contact-requests/contact-requests.test.ts` (lines 1-70).

### Allowed files
`apps/server/src/contact-requests/api.ts`, `apps/server/src/contact-requests/contact-requests.test.ts`, `work/T-0651-contact-requests-drop-zod.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/contact-requests
pnpm gate
```

### Acceptance
- `git grep -n "zod" apps/server/src/contact-requests` shows nothing.
- The tests pass, including the new one.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

1. **`apps/server/src/contact-requests/api.ts`**
   - Removed `import { z } from 'zod';` (line 17).
   - Deleted `legacyCreateBodySchema` and `legacyCreateBodyMessage` (old lines 113-124) and `parseJsonOrNull` (old lines 126-134).
   - Rewrote `schemaErrorLayer` so it no longer reads the body; it now answers `new HttpError(400, 'invalid_request', 'handle must be a string of 1 to 64 characters, with no other keys')`.
   - Updated the three comments that described the zod path (the `CreateContactRequestBody` comment and the `ContactRequestsSchemaErrors` comment) so they describe the Effect Schema path and no longer mention zod. The legacy-schema comment was deleted with its code.
   - No other imports changed: `Effect`, `HttpServerRequest` and the rest are still used elsewhere in the file.
2. **`apps/server/src/contact-requests/contact-requests.test.ts`** — added one test after the existing self/existing-contact test:
   `answers an invalid create body with 400 invalid_request and a fixed message`.
   It POSTs `{"handle":"ok","extra":1}` with a valid session and asserts status 400, `error.code === 'invalid_request'`, and `error.message === 'handle must be a string of 1 to 64 characters, with no other keys'`.
3. **`work/T-0651-contact-requests-drop-zod.md`** — status and this Report only.

Nothing else was changed.

### Checks

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/contact-requests` → 1 file passed, **16 passed** (16) — includes the new test.
- `git grep -n "zod" apps/server/src/contact-requests` → no matches (exit 1).
- `pnpm gate` (from repo root):
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (2.2s)
  PASS  format  (28.7s)
  PASS  lint  (1.2s)
  PASS  typecheck  (13.2s)
  PASS  tests @zilar/server  (9.0s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations from the spec

None.

### Problems / open questions

None. The error text for an invalid create body changed as the lead decided (status and code unchanged); no existing test asserted the text.

### Security checklist

Not affected by this change: it only replaces an error message and removes dead validation code; no route, permission, rate-limit, delete/update scope, logging or audit behaviour changed. The create route keeps its rate limit and session middleware.

## Review (written by Claude)

**2026-10-09, lead:** approved.
- **Pre-review:** clean. The packet head is 2faafd05, the current HEAD.
- **Lead check:**
  - there is no zod import in `contact-requests/`;
  - one new test covers the fixed 400 message;
  - no existing assertion was removed.

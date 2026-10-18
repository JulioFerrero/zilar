---
id: T-2040
title: "Reduce (server): approveToolHosts and revokeToolHosts share one setToolHosts body (load tool + current version, update approved_hosts, last run status, audit, detail); the HTML entity decoder copied in link-preview/parse.ts and web-tools/html.ts becomes one decodeHtmlEntities in apps/server/src/markup/ — same behaviour, fewer lines"
status: merged
milestone: M5
branch: task/T-2040-server-small-dedupes
model: deepseek/deepseek-flash
effort: default
estimate: 30 min
---

# T-2040: Two server dedupes (reduce-scan clusters #24 and #34)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: reduce the code. `docs/audit/reduce-scan.md` §1 found two server copies.

### Facts (read by the lead on 2026-10-18 at `c9bcc1486`)
- **`apps/server/src/tools/hosts.ts`** (162 lines). `approveToolHosts` (`:23-85`) and `revokeToolHosts` (`:90-155`) share the same body:
  1. `getToolRow`, then `not_found` 'Tool not found';
  2. load the current `ai_tool_versions` row, then `not_found` 'Tool version not found';
  3. `UPDATE ai_tools SET approved_hosts = …::jsonb, updated_at = … WHERE id = … RETURNING *`, then a throw if no row;
  4. `latestRunStatus`;
  5. an optional `audit.record`;
  6. `toToolDetail(updated, current, lastRunStatus)`.

  They differ in:
  - the hosts value: the decoded input on approve, `[]` on revoke;
  - the thrown text: 'approving hosts' or 'revoking hosts';
  - the audit `action`: `tool.hosts_approved` or `tool.hosts_revoked`;
  - the audit `detail`: `{ name, version, hosts }` or `{ name }`.
- **The entity decoder.** `apps/server/src/link-preview/parse.ts:15-22` and `apps/server/src/web-tools/html.ts:40-47` hold the same `ENTITY_MAP`: amp, lt, gt, quot, apos, nbsp. `parse.ts:156-176` and `html.ts:155-176` hold the same `decodeEntities` function.
- **The shared folder.** `apps/server/src/markup/` exists, with `scan.ts` and `scan.test.ts`.

### Steps
1. **hosts.ts.** Make one private `setToolHosts(db, input, hosts, now, audit, kind: 'approve' | 'revoke')`, or a similar shape, holding the shared body. `approveToolHosts` and `revokeToolHosts` keep their exported names and signatures, call it, and keep their exact error texts, audit actions and audit details.
2. **The decoder.** Create `apps/server/src/markup/entities.ts`, exporting `decodeHtmlEntities(value)` with the map. Both `parse.ts` and `html.ts` import it and delete their copies.
3. **Tests.** The existing tests of `tools`, `link-preview` and `web-tools` must pass. No new test is required. If none covers the decoder, add 3 short cases to `apps/server/src/markup/scan.test.ts`:
   - `&amp;` becomes `&`;
   - `&#x41;` becomes `A`;
   - an unknown `&bogus;` stays as it is.
4. **Size.** Report the before and after line counts. Product lines must go down by at least 50.

### Allowed files
- `apps/server/src/tools/hosts.ts`
- `apps/server/src/markup/entities.ts`
- `apps/server/src/markup/scan.test.ts`
- `apps/server/src/link-preview/parse.ts`
- `apps/server/src/web-tools/html.ts`
- `work/T-2040-server-small-dedupes.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/tools src/link-preview src/web-tools src/markup --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.
- Product lines are at least 50 lower.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/tools/hosts.ts`: extracted the shared body into one private `setToolHosts(db, input, hosts, now, audit, kind)`. `approveToolHosts` keeps its schema decode and calls it with `'approve'`; `revokeToolHosts` calls it with `[]` and `'revoke'`. The exported names and signatures, the `Tool not found` / `Tool version not found` errors, the `Tool disappeared while approving/revoking hosts` texts, and the audit actions and details (`{ name, version, hosts }` vs `{ name }`) are unchanged.
- `apps/server/src/markup/entities.ts`: new `decodeHtmlEntities(value)` with the six-entity map and the numeric-reference handling. `link-preview/parse.ts` and `web-tools/html.ts` now import it and their `ENTITY_MAP` + local `decodeEntities` copies are gone. The stale parse.ts header comment about a private decoder was updated.
- `apps/server/src/markup/scan.test.ts`: added one test (three assertions) for `&amp;`, `&#x41;` and unknown `&bogus;`, as the spec suggested.
- Size: product lines went from 162 + 177 + 207 = **546** to 130 + 146 + 176 + 34 = **486**, i.e. **60 lines fewer**. (The test file grew from 159 to 168.)

### Checks run
- `pnpm install --frozen-lockfile`: done, no changes.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/tools src/link-preview src/web-tools src/markup`: 5 test files passed, 60 tests passed.
- `pnpm gate` (repo root):
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (1.4s)
  PASS  lint  (0.8s)
  PASS  typecheck  (3.1s)
  PASS  effect  (0.4s)
  PASS  build @zilar/server  (0.5s)
  PASS  tests @zilar/server  (8.4s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- The first gate run failed the effect ratchet (`apps/server/src/markup/entities.ts needs Effect (W4): try`). I added the required `// effect-plain: pure entity decoding; malformed input is returned unchanged, no I/O` marker in the first 15 lines; the second gate run passed.
- No deviations from the spec; no open questions.


## Review (written by Claude)

Approved; the pre-review was clean, with 1 nit.
- **hosts.ts.** `approveToolHosts` and `revokeToolHosts` share one body and keep their errors and audit actions and details.
- **The decoder.** `decodeHtmlEntities` in `apps/server/src/markup/entities.ts` replaces the two copies, and it has 3 new tests.
- **Size.** About −59 product lines.

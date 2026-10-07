---
id: T-0474
title: "Listener S6a (server): LISTENER_ENABLED flag; group listener settings on PATCH /groups/:id; AI canDelegate/acceptsDelegation on PATCH /ais/:id"
status: merged
milestone: M5
branch: task/T-0474-listener-settings-routes
model: auto
effort: low
depends_on: [T-0470]
estimate: 0.35 day
---

# T-0474: listener and delegation settings

## Spec (written by Claude, do not edit)

### Why
This is plan `docs/audit/listener-delegation-plan.md` §2.3, §2.6, §5.2 and §8, the settings half of task S6. T-0470 added the columns. This task lets owners and admins switch the listener on per group and set its eagerness, and lets AI owners set the two delegation flags. It also adds the server flag.

**Nothing reads these yet:** the gateway work is S3 to S5. Everything is off by default.

### Verified facts (do not re-derive)
- **Config (`apps/server/src/config.ts`):** boolean env flags follow the `ROUTINES_ENABLED` pattern (lines 174-177): `z.enum(['true','false']).default('false').transform(v => v === 'true')`, with a comment above. `apps/server/src/config.test.ts` lists every flag in two full-config `toEqual` expectations (lines 65 and 112 show `ROUTINES_ENABLED: false`) and has a defaults test (line 375).
- **Groups:**
  - `patchGroupSchema` (`apps/server/src/groups/routes.ts:74-94`) is strict;
  - `PatchGroupInput` is at `apps/server/src/groups/service.ts:174-181`;
  - `patchGroup` is at line 229. It gives 404 to a non-member and 403 to a member, and the update at lines 252-258 applies `membersCanCreateTopics` and `background`;
  - `GroupDetail` (line 71) is filled around line 466;
  - the columns `groups.listenerEnabled` (boolean) and `listenerEagerness` (`'quiet'|'normal'|'eager'`) come from T-0470.
- **AIs:**
  - `UpdateAiSchema` (`apps/server/src/ais/routes.ts:91-102`) is strict with a refine;
  - `PATCH /ais/:id` (lines 216-233) maps the fields into `updateAi`;
  - `UpdateAiInput` is at `apps/server/src/ais/service.ts:75-83` and `updateAi` at line 342 (owner only);
  - `PublicAi` (lines 34-54) is the public shape;
  - the columns `ais.canDelegate` and `acceptsDelegation` come from T-0470.
- **Tests:** `apps/server/src/groups/groups.test.ts`, `apps/server/src/ais/routes.test.ts`, `apps/server/src/config.test.ts`.

### What to build
1. **Config:** add `LISTENER_ENABLED`, a boolean flag with default false, after `WEB_TOOLS_ENABLED`, with a comment: the listener (plan §2) decides which AI answers without a mention; off by default; the per-group switch is inert while this is off. Update both `config.test.ts` full expectations, and add a defaults assertion.
2. **Groups:**
   - `patchGroupSchema` gets `listenerEnabled: z.boolean().optional()` and `listenerEagerness: z.enum(['quiet','normal','eager']).optional()`;
   - `PatchGroupInput` and `patchGroup` apply them in the same update. The same role rules apply (owner or admin; member 403; non-member 404);
   - `GroupDetail` gets `listener: { enabled: boolean; eagerness: 'quiet'|'normal'|'eager'; available: boolean }`, where `available` is the server flag. Pass the config value to `getGroupDetail` through whatever path the routes already use for config. If threading it is invasive, put `listenerAvailable` on the route response instead and say so in the Report.
3. **AIs:**
   - `UpdateAiSchema` gets `canDelegate: z.boolean().optional()` and `acceptsDelegation: z.boolean().optional()`;
   - they are mapped in the route and applied in `updateAi` (owner only, as today);
   - `PublicAi` gets `canDelegate: boolean` and `acceptsDelegation: boolean`, filled wherever a `PublicAi` is built.
4. **Tests:**
   - **groups:**
     - an admin sets `listenerEnabled` true and `eagerness` quiet, and the detail shows them;
     - a member gives 403;
     - an unknown eagerness gives 400;
     - `available` follows the flag;
   - **ais:**
     - the owner sets both flags and the response shows them;
     - another user gets the existing 404 or 403 behaviour;
     - defaults are false;
   - **config:** the flag default and the `'true'` parse.

### Read first
`AGENTS.md`, `docs/audit/listener-delegation-plan.md` §2.3, §2.6, §5.2 and §8, `apps/server/src/config.ts:165-200`, `apps/server/src/config.test.ts:50-120` and `:370-380`, `apps/server/src/groups/routes.ts:70-100` and the `PATCH /groups/:id` handler, `apps/server/src/groups/service.ts:60-120`, `:170-270` and `:440-480`, `apps/server/src/ais/routes.ts:85-110` and `:210-235`, `apps/server/src/ais/service.ts:30-90` and `:340-400`.

### Allowed files
`apps/server/src/config.ts`, `apps/server/src/config.test.ts`, `apps/server/src/groups/routes.ts`, `apps/server/src/groups/service.ts`, `apps/server/src/groups/groups.test.ts`, `apps/server/src/ais/routes.ts`, `apps/server/src/ais/service.ts`, `apps/server/src/ais/routes.test.ts`, `work/T-0474-listener-settings-routes.md`.

If any other test breaks (for example an exact `PublicAi` or `GroupDetail` snapshot elsewhere, or the web or mobile packages), stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot groups/groups ais/routes config
pnpm gate
```

### Acceptance
- `LISTENER_ENABLED` exists and is off by default.
- Owners and admins set the group listener switch and eagerness.
- AI owners set `canDelegate` and `acceptsDelegation`.
- Both appear in the group detail and the AI responses.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- **Config (`apps/server/src/config.ts`)** — added `LISTENER_ENABLED` after `WEB_TOOLS_ENABLED`, same boolean `z.enum(['true','false']).default('false').transform(...)` pattern, with the plan §2 comment (off by default; per-group switch inert).
- **Groups service (`apps/server/src/groups/service.ts`)** — added `GroupListenerEagerness = 'quiet'|'normal'|'eager'`; added `listener: { enabled, eagerness, available }` to `GroupDetail`; added `listenerEnabled`/`listenerEagerness` to `PatchGroupInput` and applied them in the same `patchGroup` update (owner/admin only, unchanged 403/404 rules); `getGroupDetail(db, groupId, listenerAvailable = false)` fills the DB values for `enabled`/`eagerness` and the flag for `available`.
- **Groups routes (`apps/server/src/groups/routes.ts`)** — `patchGroupSchema` accepts `listenerEnabled: z.boolean().optional()` and `listenerEagerness: z.enum(['quiet','normal','eager']).optional()` (unknown value → 400). PATCH maps them into `patchGroup`. A route-level `withListenerAvailability` helper stamps `available` from `config.LISTENER_ENABLED` onto every group response (the six service functions that build their own `GroupDetail` cannot see the config); the `GET /groups/:id` call passes the flag straight into `getGroupDetail`.
- **AI service (`apps/server/src/ais/service.ts`)** — `PublicAi` and `AiRecord` gained `canDelegate`/`acceptsDelegation`; added to `publicAiColumns` and `toPublicAi`; `UpdateAiInput` gained both; `updateAi` applies them in the existing transaction (owner only, unchanged 404).
- **AI routes (`apps/server/src/ais/routes.ts`)** — `UpdateAiSchema` accepts both optional booleans and the PATCH handler maps them into `updateAi`.
- **Tests** — `config.test.ts`: `LISTENER_ENABLED: false` added to both full-config `toEqual` blocks plus a default/`'true'`-parse test. `groups.test.ts`: new `group listener settings (T-0474)` describe (admin sets switch + quiet, detail shows them; defaults off/normal; member 403 and row unchanged; unknown eagerness 400; `available` true when `LISTENER_ENABLED` is on). `ais/routes.test.ts`: owner sets both flags and sees them, defaults false, another user gets 404 and the row is unchanged.

### Files changed
`apps/server/src/config.ts`, `apps/server/src/config.test.ts`, `apps/server/src/groups/routes.ts`, `apps/server/src/groups/service.ts`, `apps/server/src/groups/groups.test.ts`, `apps/server/src/ais/routes.ts`, `apps/server/src/ais/service.ts`, `apps/server/src/ais/routes.test.ts`, `work/T-0474-listener-settings-routes.md`. All inside the Allowed files (gate confirms).

### Commands and results
- `pnpm install` — done, 1170 packages, exit 0.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot groups/groups ais/routes config` — **5 files, 173 passed, 0 failed**.
- `pnpm gate` (first run) — FAIL on `format`: `apps/server/src/ais/routes.test.ts`, `apps/server/src/groups/service.ts`; `scope: every changed file is inside the Allowed files`.
- `pnpm exec prettier --write` on those two files — exit 0.
- `pnpm gate` (final):
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  tests @zilar/server
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes
- **`available` threading.** `getGroupDetail` is called from ten service sites plus two route sites; threading `config` into all of them would have touched every create/member/AI/role function. I took the fallback the spec allows: `getGroupDetail` takes an optional `listenerAvailable` (used directly by `GET /groups/:id` and by the tests), and the routes stamp `available` onto the six service-built details with a small `withListenerAvailability` helper from `config.LISTENER_ENABLED`. Result: every group response carries the correct flag. Nothing reads it yet (gateway work is S3–S5).
- No other package/test asserts an exact `PublicAi` or `GroupDetail`; `pnpm gate` (which runs the whole `@zilar/server` suite) is green. Web/mobile have their own types and were not touched.

### Blocked / needs a decision
None.

## Review (written by Claude)

Approved (lead, 2026-10-07). LISTENER_ENABLED is added, off by default. PATCH /groups/:id takes listenerEnabled and listenerEagerness (owner or admin; member 403; non-member 404), and the GroupDetail listener carries enabled, eagerness and available (stamped in routes). PATCH /ais/:id takes canDelegate and acceptsDelegation (owner only), and PublicAi shows them. Nit accepted: available=true is only tested on GET.

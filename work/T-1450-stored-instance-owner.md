---
id: T-1450
title: "SEC-12: the instance owner is stored once (instance_settings) instead of re-derived as the oldest user, so deleting or recreating accounts can't move ownership; one isOwner for integrations and voice settings"
status: merged
milestone: M5
branch: task/T-1450-stored-instance-owner
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1450: Stored instance owner

## Spec (written by Claude, do not edit)

### Why
SEC-12 (`docs/audit/security-audit.md`). Per the sweep (`docs/audit/findings-sweep-server.md`), the owner of a Zilar instance is still recomputed on every check as the oldest `user` row. If that account is deleted, ownership of the integrations and voice settings silently moves to the next-oldest account.

### Facts (the lead read them on main, 2026-10-15)
- **Two copies of the same check:**
  - `isOwner(db, userId)` in `apps/server/src/integrations/routes.ts:71-81`: `SELECT id FROM "user" ORDER BY created_at ASC, id ASC LIMIT 1`;
  - another `isOwner` in `apps/server/src/voice-transcription/routes.ts:91`.
- **Callers:** `apps/server/src/integrations/api.ts:73`, `:104`, `:154` and `apps/server/src/voice-transcription/api.ts:264`, `:290`.
- **`instance_settings`** is a key-value table. Keys are constants in `apps/server/src/setup/settings.ts:15-16`, such as `mail.resend_api_key` and `mail.from`; the read and write helpers are in the same file (`:41-120`).
- **The setup lock:** setup takes an advisory lock, `takeSetupLockEffect()` (used in `apps/server/src/setup/api.ts:164-175` and `:217-229`).

### What to build
1. **New `apps/server/src/setup/instance-owner.ts`**, with a setting key `instance.owner_user_id`:
   - `instanceOwnerId(db): Promise<string | null>`:
     - reads the setting;
     - when it is missing, in one transaction under `takeSetupLockEffect()`, re-reads it, and if it is still missing, stores the oldest user's id (today's query) and returns it;
     - with no users at all, returns null and stores nothing.
   - `isInstanceOwner(db, userId)`.
   - The stored id never changes afterwards. If that user no longer exists, nobody is the owner: log one warn with ids only, and don't fall back.
2. Both `isOwner` functions are replaced by `isInstanceOwner`; update the callers. Delete the duplicate. No route behaviour changes for a normal instance.
3. Add one short paragraph to `docs/ops/log-access.md` (or the nearest ops doc) on how an operator resets the owner: a manual SQL update of that key, with the key name only.

### Tests (auth and permissions are crucial)
In `apps/server/src/setup/instance-owner.test.ts`:
1. The first call stores the oldest user, and later calls return the same id.
2. After that user's row is deleted, `isInstanceOwner` is false for every remaining user; ownership doesn't move.
3. With no users, it returns null and nothing is stored.

### Allowed files
- `apps/server/src/setup/instance-owner.ts`, `apps/server/src/setup/instance-owner.test.ts`
- `apps/server/src/integrations/routes.ts`, `apps/server/src/integrations/api.ts`
- `apps/server/src/voice-transcription/routes.ts`, `apps/server/src/voice-transcription/api.ts`
- `apps/server/src/setup/settings.ts` (only to export a helper)
- `docs/ops/log-access.md`
- `work/T-1450-stored-instance-owner.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/setup src/integrations src/voice-transcription --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes and the three tests pass.
- On production, the first owner check after deploy stores Julio's account. The lead checks the integrations page still loads for him.

---

## Report (written by the worker when done)

### What I did
- **New `apps/server/src/setup/instance-owner.ts`**:
  - `INSTANCE_OWNER_SETTING = 'instance.owner_user_id'`;
  - `instanceOwnerId(db)`: reads the setting; when missing, claims the oldest user
    (`SELECT id FROM "user" ORDER BY created_at ASC, id ASC LIMIT 1`) in one
    transaction under `takeSetupLockEffect()`, re-reading the setting inside the
    lock and using `INSERT ... ON CONFLICT (key) DO NOTHING`; with no users it
    returns null and stores nothing;
  - `isInstanceOwner(db, userId, logger?)`: compares against the stored id. If the
    stored user no longer exists, nobody is the owner: one `warn` with ids only
    (`{ ownerUserId, userId }`) and no fallback to the next-oldest account.
- **Deleted both `isOwner` copies** (`integrations/routes.ts`,
  `voice-transcription/routes.ts`) and pointed the five callers at
  `isInstanceOwner`, passing the request logger so the "owner gone" warn is
  emitted.
- **Docs**: a short paragraph in `docs/ops/log-access.md` on resetting the owner
  (manual SQL `UPDATE instance_settings ... WHERE key = 'instance.owner_user_id'`,
  key name only).
- **Tests** in `apps/server/src/setup/instance-owner.test.ts` (3): the first call
  stores the oldest user and later calls reuse it; deleting that user's row
  leaves no owner and ownership does not move; with no users it returns null and
  stores nothing.

### Deviation needed to keep the gate green
Removing the last `Effect` import from `voice-transcription/routes.ts` turned it
into a `needs-effect` file and tripped the gate's Effect ratchet (base was
`effect`). I converted the existing `try/catch` in `voiceTranscriptionStatusFor`
to `Effect.tryPromise(...).pipe(Effect.orElseSucceed(...))` — same fail-closed
result, same fixed warn, no route behaviour change — so the file stays an Effect
file. I did **not** add an `// effect-plain:` marker (the file is not pure).

### Files changed
- `apps/server/src/setup/instance-owner.ts` (new)
- `apps/server/src/setup/instance-owner.test.ts` (new)
- `apps/server/src/integrations/routes.ts`
- `apps/server/src/integrations/api.ts`
- `apps/server/src/voice-transcription/routes.ts`
- `apps/server/src/voice-transcription/api.ts`
- `docs/ops/log-access.md`
- `work/T-1450-stored-instance-owner.md`

### Commands (real results)
- `pnpm install` → done in 15.8s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/setup/instance-owner.test.ts`
  → 1 file, 3 tests passed.
- `pnpm --filter @zilar/server exec vitest run src/setup src/integrations src/voice-transcription --reporter=dot --maxWorkers=2`
  → 2 files, 10 tests passed (I added `--maxWorkers=2`, as AGENTS.md forbids an
  uncapped `vitest run`).
- `pnpm gate` → **GATE PASS**. Summary lines:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  tests @zilar/server
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes / open questions
- `isInstanceOwner` runs two queries (the setting read plus a user-exists check);
  when the stored owner is gone, one warn is logged per owner check, with no
  process-level de-duplication. Tell me if you want it to warn at most once per
  process.
- `settings.ts` was left untouched (its Allowed-files entry was "only to export a
  helper", and none was needed). Its header comment still says "Two keys live in
  the instance_settings table"; the third key is documented in
  `instance-owner.ts`.
- I did not run the production acceptance (the first owner check after deploy
  storing Julio's account) — no production access.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 3.
- `instance.owner_user_id` is claimed once, under the setup advisory lock, inside a transaction (read again inside the lock, `ON CONFLICT DO NOTHING`), and it never moves afterwards.
- The two `isOwner` copies are now one.
- Setup, integrations and voice-transcription tests (10) pass locally.
- After deploy, the first owner check stores Julio's account. The lead checks the integrations route still answers for an owner session, since Julio's session can't be used for this.

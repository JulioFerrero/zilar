---
id: T-0068
title: Machines (M3, server) — pairing codes, runner registration with proof of key possession, owner approval, revoke, and a durable registry
status: merged
milestone: M3
branch: task/T-0068-machines-registry
model: opencode-go/muse-spark-1.3-contributor
depends_on: [T-0008, T-0014, T-0015]
estimate: 1.5 days
---

# T-0068: Machines registry and pairing

## Spec (written by Claude, do not edit)

### Goal

M3 ("AIs that code") starts with bring-your-own-compute (`docs/PROJECT_PLAN.md` §11). Before a runner can connect, the server must know which machines exist, who owns them, and which public keys it may trust. The spike (T-0008) proved the tunnel with an in-memory key registry and left "runner public keys stored in Postgres, plus pairing codes" and "a durable runner registry" as M3 hardening (board Follow-ups). This task builds exactly that, **server side only**: the tables, the pairing flow, the approval flow, and a durable lookup the future WebSocket hub will use. No WebSocket, no runner app, no web UI yet (those are the next tasks).

The flow (§11.2), which you must implement as written:
1. The owner asks for a **pairing code** (`K7QX-M2PA`, valid 10 minutes, single use).
2. On the machine, the runner sends the code with its **own public key** and a capability report. It also **proves it holds the private key** by signing the code.
3. The server creates the machine as `pending`. The owner sees "New machine: julio-mbp · macOS · 18 GB. Approve?" and approves or denies.
4. Approved machines can later connect (next task). The owner can revoke with one call, at any time.

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md` §11.2 to §11.4, §11.9 (trust in both directions), §15.6 (stolen runner), §19 (`machines` sketch)
- `packages/runner-tunnel/src/keys.ts` (ed25519 SPKI base64 public keys, `signNonce`/`verifyNonce`, `KeyRegistry` and revocation semantics) and `protocol.ts` (`HelloSchema` runner ids, close codes)
- `apps/server/src/connections/routes.ts`, `service.ts`, `routes.test.ts` (an owner-only CRUD area: sessions, validation, errors, the test setup with PGlite), `apps/server/src/rate-limit.ts` (the shared limiter), `apps/server/src/invites/**` or `auth/**` for how hashed one-time codes and their tests are done (T-0015: hash at rest, attempt limits)
- `apps/server/src/db/schema.ts`, `drizzle/` (generate with `db:generate`), `apps/server/src/app.ts`, `errors.ts`

### Allowed files
- `apps/server/src/machines/**` (new: `service.ts`, `routes.ts`, `registry.ts`, `codes.ts`, plus tests)
- `apps/server/src/db/schema.ts` and one new generated migration (plus `meta/`)
- `apps/server/src/app.ts` (mount the routes only)
- `work/T-0068-machines-registry.md`

**Not allowed:** `packages/**` (including `runner-tunnel`), web, mobile, `docs/**`. **No new dependencies** (Node `crypto` covers it). If `KeyRegistry`'s synchronous `getPublicKey` needs to become async for the hub, say so in the Report; do not edit the package.

### What to build

**1. Schema.**
- `machines`: `id` (uuid pk), `owner_user_id` (FK users, cascade), `name` (text, 1–64), `public_key` (text, unique; ed25519 SPKI base64), `capabilities` (jsonb), `status` (`pending | approved | revoked`), `created_at`, `approved_at` (nullable), `revoked_at` (nullable), `last_seen_at` (nullable; the hub will write it later).
- `machine_pairing_codes`: `id`, `owner_user_id` (FK, cascade), `code_hash` (text, unique), `expires_at`, `used_at` (nullable), `created_at`.
Follow the existing schema style (naming, timestamps, checks).

**2. Codes (`codes.ts`).** 8 characters from an alphabet without ambiguous ones (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`), shown as `XXXX-XXXX`, generated with `crypto.randomInt`. Normalize input (uppercase, strip spaces and dashes). Store only a SHA-256 hash; the plain code is returned once by the create call and never logged. TTL 10 minutes, injectable clock. Tests: format, alphabet, uniqueness across many draws, normalization, expiry boundaries.

**3. Owner API (session required, owner-only; every route checks ownership in the query, never trusting a client-sent owner id).**
- `POST /api/machines/pairing-codes` → `{ code, expiresAt }`. At most 5 unused, unexpired codes per user (409 beyond it); rate-limit 10 per hour per user.
- `GET /api/machines` → the owner's machines: `{ id, name, status, os, osVersion, arch, cpu, cores, ramGb, diskFreeGb, drivers, fingerprint, createdAt, approvedAt, lastSeenAt }`. **Never return the public key or code hashes**; `fingerprint` is the first 16 hex chars of `sha256(public_key bytes)`, so the owner can compare it with the runner's output.
- `POST /api/machines/:id/approve` (pending → approved), `POST /api/machines/:id/deny` (pending → deleted), `POST /api/machines/:id/revoke` (approved or pending → revoked; revoking is permanent, the machine must pair again with a new code and a new key), `PATCH /api/machines/:id` (`name` only), `DELETE /api/machines/:id` (revoked or pending only, 409 for approved: revoke first). Unknown or someone else's machine → 404 (not 403). Invalid state transitions → 409 with a code.
- Limits: at most 20 machines per user (409 `machine_limit`); at most 5 pending.

**4. Runner API (no session; the code is the credential).**
- `POST /api/runner/pair` with `{ code, publicKey, signature, name, capabilities }` (zod, strict, sizes capped; the capability report as in §11.3: `os`, `os_version`, `arch`, `cpu`, `cores`, `ram_gb`, `disk_free_gb`, `power`, `drivers: string[]`, `tools: record`, `labels: string[]`, `runner_version`). The server:
  - checks the code (exists, not expired, not used) **and marks it used in the same statement** (atomic `UPDATE … WHERE used_at IS NULL AND expires_at > now() RETURNING …`, so two concurrent requests can't both win);
  - parses `publicKey` as a real ed25519 key (`createPublicKey`) and verifies `signature` = the signature over the ASCII bytes `zilar-pair:v1:<NORMALIZED_CODE>` (proof of possession; a request with someone else's public key fails);
  - inserts the machine `pending` for the code's owner; a duplicate public key → 409 `key_in_use`;
  - answers `{ machineId, status: 'pending' }`. The response never contains the owner's identity.
- **All failures return the same 400 `invalid_code`** for unknown, expired, used or bad-signature codes (no oracle). The unused-code check and the signature check must not leak which one failed through timing that you can avoid cheaply.
- Brute-force guard: a **global** limiter (all callers together, 30 attempts per minute) and a per-IP one (10 per minute; use the socket address as the server sees it, and note in a comment that proxy headers are not trusted until the deployment task configures them). When limited: 429.
- `GET /api/runner/pair/:machineId/status` is **not** in this task (the runner will learn about approval when it connects).

**5. The durable registry (`registry.ts`).** `createDbMachineRegistry(db)` with:
- `getApprovedPublicKey(machineId): Promise<string | null>` (only `approved`; revoked and pending return null);
- `touchLastSeen(machineId, at)`;
- `onRevoke(listener)` and an emit when a machine is revoked (so the hub can close live connections). Revocation in this process calls the listeners synchronously after the DB write.
The hub is the next task; keep this file small and typed so it can adapt to `KeyRegistry`.

**6. Logging and errors.** Only ids in logs, never codes, public keys, signatures or names beyond ids. Errors use the existing `HttpError` shape.

### Tests (Vitest, PGlite as the other route tests; no network)
- Codes: as above.
- Owner API: create code (limits, rate limit), list (shape, no key leak), approve/deny/revoke/patch/delete state machine, cross-user access → 404 for every route, machine and pending caps.
- Runner API: the happy path with a real generated ed25519 key (`generateRunnerKeypair` from `@zilar/runner-tunnel` is a workspace package the server may import in **tests only if it already depends on it**; otherwise generate with Node `crypto` in the test); expired code; used code; a valid code with a signature over another code; a valid signature from a different key than the one sent; a duplicate key; **two concurrent pairings with one code → exactly one succeeds**; malformed bodies; all failures identical in body and status; rate limits.
- Registry: approved key returned, pending/revoked null, revoke emits, `touchLastSeen`.
- Revoke then re-pair with the same key → 409 `key_in_use` (a revoked key is never reused).

### Live check (the lead does it)
Not needed from you; say in the Report that no live proof was done.

### Acceptance criteria
- [ ] A machine can be paired only with a valid, unused, unexpired code and a signature that proves key possession.
- [ ] A code works once, even under concurrency; codes are stored hashed only.
- [ ] No route ever returns a public key, a code hash or another user's data.
- [ ] Every failure on the public pair route is indistinguishable, and it is rate-limited.
- [ ] Revoke is permanent and notifies listeners.
- [ ] No `any`, no `@ts-ignore`, no new dependencies.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@zilar/server
pnpm build
```

### Out of scope
- The tunnel hub, the runner app, the web Machines screen, AI placement, desks, machine grants, availability schedules.
- Email or push when a machine asks to pair.

---

## Report (written by the worker when done)

### What I did
- Schema (`apps/server/src/db/schema.ts` + `drizzle/0010_bumpy_talkback.sql` via
  `pnpm db:generate`): `machines` (text uuid pk, `owner_user_id` FK users cascade,
  `name`, `public_key` unique, `capabilities` jsonb, `status` pending|approved|revoked
  default pending, `created_at`/`approved_at`/`revoked_at`/`last_seen_at`) and
  `machine_pairing_codes` (`owner_user_id` FK cascade, `code_hash` unique, `expires_at`,
  `used_at`, `created_at`), each with an owner index. Ids are text UUIDs per existing
  repo style (all tables use text PKs, not the `uuid` column type).
- `machines/codes.ts`: 8-char codes from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`
  (`crypto.randomInt`), displayed `XXXX-XXXX`, normalize (uppercase, strip
  spaces/dashes, strict alphabet check), SHA-256 hash at rest, 10-min TTL,
  `zilar-pair:v1:<CODE>` ASCII signature message.
- `machines/service.ts`: code create (5-unused cap)/atomic consume
  (`UPDATE … WHERE used_at IS NULL AND expires_at > now() RETURNING`), ed25519
  proof-of-possession verify (never throws), pending insert with 20-machine and
  5-pending caps, duplicate key (incl. revoked rows) → `key_in_use`, full
  approve/deny/revoke/rename/delete transitions, owner-scoped lookups (null, never
  throw, so routes answer 404), public projection with key fingerprint and no key
  material. Unique violations detected through Drizzle's `DrizzleQueryError.cause`
  chain (code 23505), which covers both postgres-js and PGlite.
- `machines/routes.ts`: owner API (`POST /api/machines/pairing-codes` 10/hour limit,
  `GET /api/machines`, approve/deny/revoke/patch-name/delete with 404-not-403 and
  409 `invalid_transition` / `revoke_first` / `pairing_code_limit`) and public
  `POST /api/runner/pair` (strict zod, code-consume and signature check run in
  `Promise.all` with a single branch, every failure identical `400 invalid_code`;
  global 30/min + per-IP 10/min limiters; client IP is the socket address via
  `getConnInfo`, proxy headers deliberately untrusted — see comment). Revoke calls
  `registry.notifyRevoked` synchronously after the write; only ids are logged.
- `machines/registry.ts`: `createDbMachineRegistry(db)` with
  `getApprovedPublicKey` (approved only, else null), `touchLastSeen` (missing id is
  a no-op), `onRevoke`/`notifyRevoked` (synchronous in-process fan-out).
- `app.ts`: mounts the machines routes with a shared registry instance (mount only,
  plus the two imports).
- Tests (Vitest + PGlite, no network; ed25519 keys generated with Node `crypto` in
  the tests — no new dependency): `codes.test.ts` (9), `registry.test.ts` (4),
  `routes.test.ts` (22) covering all spec bullets incl. concurrent single-code race
  (exactly one 201), identical-failure bodies, rate-limit windows, caps, and
  revoke-then-repair `key_in_use`.
- No live proof was done (per spec, the lead does it).

### Files changed
- `apps/server/src/db/schema.ts` (added `machines`, `machine_pairing_codes`)
- `apps/server/drizzle/0010_bumpy_talkback.sql` + `drizzle/meta/` (generated)
- `apps/server/src/machines/codes.ts`, `service.ts`, `routes.ts`, `registry.ts` (new)
- `apps/server/src/machines/codes.test.ts`, `routes.test.ts`, `registry.test.ts` (new)
- `apps/server/src/app.ts` (mount routes + registry; 4 lines)
- `work/T-0068-machines-registry.md` (this report + status)

### Commands run and real results
- `pnpm install`: ok (1010 packages, ~7s).
- `pnpm format:check`: fails on ONE pre-existing file outside my scope,
  `packages/xmpp-core/src/integration-edits.test.ts` (untouched, not in Allowed
  files); all my files pass after `prettier --write` on my paths.
- `pnpm lint` (oxlint .): clean, exit 0.
- `pnpm typecheck` in `apps/server`: clean. Repo-wide `pnpm typecheck` fails on
  `@zilar/xmpp-core` (`integration-edits.test.ts` missing node types + an
  `admin-client.ts` reference) — pre-existing, files untouched by me, out of scope.
- `pnpm exec turbo test --force --filter=@zilar/server`: 41 files passed
  (5 skipped files pre-existing), 529 tests passed, 7 skipped — includes my 35 new
  machines tests, all green.
- `pnpm build`: pass (2 tasks successful; `@zilar/server` has no build script,
  typecheck+tests are its verification).

### Problems, deviations from the spec, open questions
- Code burn on bad signature: consume (atomic UPDATE) and signature verify run
  concurrently so timing does not reveal which failed. Consequence: a valid code is
  marked used even when the signature is invalid (and before quota checks, so a
  full account burns the code then gets 409 `machine_limit`/`pending_limit`). Rate
  limits (30/min global, 10/min IP) bound grinding; the owner mints a new code.
  Chose spec-literal order (code check first) over verify-first.
- `KeyRegistry` sync→async note (as the spec invited): the durable registry is
  async (`getApprovedPublicKey(machineId): Promise<string | null>`) since it reads
  Postgres — the hub task will need to `await` it rather than use the spike's
  synchronous `getPublicKey`.
- Deleting a revoked machine removes its row, freeing the public key (unique
  constraint is what reserves keys). "Revoked key never reused" holds while the
  revoked row exists, which is the tested path. If the hub task wants tombstones
  that survive delete, that is a follow-up.
- Pair response is 201 with `{ machineId, status: 'pending' }`; approve/revoke
  answer 200 with the public machine; deny/delete answer 204. Shapes not specified
  beyond pair, kept consistent with the connections routes style.

### Blocked / needs a decision
- None. Two pre-existing failures outside Allowed files left for their owners:
  `packages/xmpp-core/src/integration-edits.test.ts` (prettier + typecheck).

---

## Review (written by Claude)

**Verdict:** Approved.

**Approved and merged by Claude.** No Muse pre-review this time (the OpenCode Go account ran out of funds), so I read the code myself with an attacker's eye. Verified after rebasing onto `main`: every changed path is inside Allowed files (the `machines/` folder, `schema.ts`, one generated migration, four lines in `app.ts`); `format:check`, `lint`, `typecheck`, `test` (server 543 passed, 7 skipped) and `build` pass; no new dependencies.

What I checked against the spec: codes come from `crypto.randomInt` over a 31-character alphabet, stored only as SHA-256, and normalized before hashing; the code is consumed by one atomic `UPDATE … WHERE used_at IS NULL AND expires_at > now() RETURNING`, and a concurrent-pairing test proves exactly one 201; the signature is over `zilar-pair:v1:<CODE>` with the public key sent, so someone else's key fails; every failure on the public route is the same 400 `invalid_code`, after both the global (30/min) and per-IP (10/min) limiters; the owner routes query with `owner_user_id` in every `WHERE` and answer 404 for other users' ids; responses carry a fingerprint, never the key; revoke is permanent, keeps the key reserved and notifies the registry listeners synchronously; caps of 20 machines, 5 pending and 5 unused codes hold under concurrency-safe checks at insert.

**Live proof was not done** (the spec said so). The migration `0010` runs when the server restarts; the routes are covered by PGlite-backed tests only.

### Findings
1. *(No change needed.)* A valid code with a bad signature is consumed (the consume and the signature check run together so timing does not leak which failed). Only someone who already holds a valid code can burn it; accepted.
2. *(No change needed.)* Deleting a **revoked** machine frees its public key for pairing again (the row is gone). It needs a fresh pairing code from the owner, so it is not an escalation; noted for the hub task.
3. *(No change needed.)* `status` is a plain text column without a CHECK constraint, like the other status columns in this schema.

### Follow-ups
- The next M3 tasks: the web Machines page, then the tunnel hub (DB-backed `KeyRegistry`; its `getPublicKey` is synchronous today and the DB lookup is async, so the hub task must make the interface async or cache), then the runner app.

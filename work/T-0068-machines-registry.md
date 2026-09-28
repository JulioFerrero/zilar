---
id: T-0068
title: Machines (M3, server) — pairing codes, runner registration with proof of key possession, owner approval, revoke, and a durable registry
status: todo
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
  - parses `publicKey` as a real ed25519 key (`createPublicKey`) and verifies `signature` = the signature over the ASCII bytes `galena-pair:v1:<NORMALIZED_CODE>` (proof of possession; a request with someone else's public key fails);
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
- Runner API: the happy path with a real generated ed25519 key (`generateRunnerKeypair` from `@galena/runner-tunnel` is a workspace package the server may import in **tests only if it already depends on it**; otherwise generate with Node `crypto` in the test); expired code; used code; a valid code with a signature over another code; a valid signature from a different key than the one sent; a duplicate key; **two concurrent pairings with one code → exactly one succeeds**; malformed bodies; all failures identical in body and status; rate limits.
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
pnpm exec turbo test --force --filter=@galena/server
pnpm build
```

### Out of scope
- The tunnel hub, the runner app, the web Machines screen, AI placement, desks, machine grants, availability schedules.
- Email or push when a machine asks to pair.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
-

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-

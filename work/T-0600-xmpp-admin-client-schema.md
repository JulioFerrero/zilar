---
id: T-0600
title: "Effect Schema: xmpp/admin-client.ts zod to Effect Schema (name/password/JID input checks, ejabberd result shapes, roster and affiliation entries, room option checks); same throws, same error texts naming the field, same accepted responses; tests unchanged"
status: todo
milestone: M5
branch: task/T-0600-xmpp-admin-client-schema
model: auto
effort: low
depends_on: [T-0571]
estimate: 0.5 day
---

# T-0600: the ejabberd admin client on Effect Schema

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect Schema replaces zod. `apps/server/src/xmpp/admin-client.ts` is one of the external-API clients in plan §5.4 (`docs/audit/tool-args-schema-plan.md`).

### Verified facts (do not re-derive; read every site)
**Imports:** zod at line 2; `JidSchema`, `isJid` and `isValid` from `@zilar/protocol` (line 3; the protocol package is already on Effect).

**Input checks.** Each one **throws before any request**:
- `NameSchema` (8-13): `/^[a-z0-9._-]{1,64}$/`, with the message `must be 1-64 characters of lowercase letters, digits, ".", "_" or "-"`. `parseName` (172-180) throws `` `${label} "${value}" is invalid: ${first message}` ``. **Keep the exact text**; the tests match the `label` (`'localpart'`, `'roomId'`).
- `PasswordSchema` (15): min 1 (message `must not be empty`), max 1024. `.parse` at line 274 throws.
- `BareJidSchema` (19): refined with `isJid`, message `must be a bare JID (local@domain)`.
- (337) `RoomAffiliationSchema.parse(affiliation)`; (370-371) the option name (1-128) and option value (≤ 4096). All throw.

**The ejabberd result shapes** (`safeParse`, where a failure takes the existing error path):
- `MutationResultSchema` (129): `0 | ''`, used at 228 and 322;
- `CheckAccountResultSchema` (130): `0 | 1`, used at 265;
- (243) `z.string()` on a body;
- (355) `z.array(RoomAffiliationEntrySchema)`.

**The exported schemas and types:**
- `RoomAffiliationSchema` with `type RoomAffiliation` (`'owner' | 'admin' | 'member' | 'none'`);
- `RosterSubscriptionSchema` with `RosterSubscription`;
- `RosterEntrySchema` with `RosterEntry`;
- `RoomAffiliationEntrySchema` with `RoomAffiliationEntry`.

grep shows no other file imports the **schemas**. The **types** may be imported elsewhere; keep their names and shapes. The zod objects here are not strict, so keep Effect's default (extra keys ignored).

**Tests** (`apps/server/src/xmpp/admin-client.test.ts`):
- 125-129, 247-255, 337-350 and 375-385 check that invalid input **throws** (`rejects.toThrow`, often matching the label text) before any request;
- 372 expects an `EjabberdApiError`.

### What to build
1. Convert every schema and parse site in `admin-client.ts` to Effect Schema:
   - a throwing `.parse` becomes a sync decode that throws an `Error`; the `parseName` text stays identical;
   - a `safeParse` becomes a decode that returns an Exit or Option, and its failure keeps the same branch.
2. The exported types keep their names and shapes, and the file has no zod import.
3. **Tests:** every listed test passes **unchanged**:
   - `apps/server/src/xmpp/*.test.ts`;
   - `apps/server/src/groups/*.test.ts` and `apps/server/src/topics/*.test.ts` (they drive the client through fakes).

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` ("Effect 4 facts" and "Schema, custom messages"), `apps/server/src/xmpp/config.ts` (lines 60-100, the codebase's message walker), `apps/server/src/xmpp/admin-client.ts` and `apps/server/src/xmpp/admin-client.test.ts`.

### Allowed files
`apps/server/src/xmpp/admin-client.ts`, `work/T-0600-xmpp-admin-client-schema.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot xmpp groups topics
pnpm gate
```

### Acceptance
- There is no zod in `admin-client.ts`, with the same throws, error texts and accepted responses.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

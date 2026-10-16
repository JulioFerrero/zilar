---
id: T-1696
title: "Size split of apps/server/src/xmpp/admin/client.ts (390 lines): move the name parsers into admin/names.ts and the HTTP transport (basicAuthHeader, call, fail, expectOk, expectMutationResult) into admin/transport.ts as createAdminTransport(config, fetchImpl) — bodies moved word for word, no behaviour change"
status: merged
milestone: M5
branch: task/T-1696-split-admin-client
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1696: Split the ejabberd admin client's helpers out of client.ts

## Spec (written by Claude, do not edit)

### Why
`apps/server/src/xmpp/admin/client.ts` is 390 of 400 lines, so no ejabberd admin command can be added (for example, the room ban list a group ban would need). Its parsers and its HTTP transport are self-contained.

### Facts (the lead read them on 2026-10-16)
- **`client.ts`:**
  - imports `:1-36`; `const PUSH_SUBSCRIPTION_NODES :40` (stays);
  - module-level helpers `function basicAuthHeader(user, password) :41-43`, `function parseName(value, label) :45-58`, `function splitBareJid(value) :60-66` and `function parseJid(value, label) :69-74`;
  - `export function createEjabberdAdminClient(config: XmppConfig, fetchImpl: FetchLike = fetch): EjabberdAdminClient :76`, whose inner helpers are:
    - `async function call(command, body): Promise<ApiResponse> :80-99` (uses `basicAuthHeader`, `config.apiUrl`, `config.adminJid`, `config.adminPassword` and `fetchImpl`);
    - `function fail(command, response, detail?): never :101-103`;
    - `function expectOk(command, response): unknown :105-110`;
    - `function expectMutationResult(command, response): void :112-118` (uses `MutationResultSchema`);
  - then `return { registerUser … sendStanza }` (`:120-390`), whose methods call the four inner helpers and `parseName`/`splitBareJid`/`parseJid`.
- **Importers** use `apps/server/src/xmpp/admin-client.ts`, a barrel that re-exports `admin/*`. Nothing imports the private helpers. There are no tests of `createEjabberdAdminClient`.
- **The folder `apps/server/src/xmpp/admin/`** holds `client.ts`, `errors.ts`, `schemas.ts` and `types.ts`.

### Steps
1. **Create `apps/server/src/xmpp/admin/names.ts`** with `parseName`, `splitBareJid` and `parseJid` (and their comments) moved **word for word** and exported, plus the imports they need.
2. **Create `apps/server/src/xmpp/admin/transport.ts`** with:
   - `basicAuthHeader` (private);
   - `export function createAdminTransport(config: XmppConfig, fetchImpl: FetchLike)`, whose body holds `call`, `fail`, `expectOk` and `expectMutationResult` moved **word for word** and returns `{ call, fail, expectOk, expectMutationResult }`.
3. **`client.ts`:**
   - `createEjabberdAdminClient` starts with `const { call, fail, expectOk, expectMutationResult } = createAdminTransport(config, fetchImpl);`, then the unchanged `return { … }`;
   - import the parsers from `./names`;
   - drop the imports it no longer uses.

   Keep `fail`'s `never` return type (spell the returned object's type out if inference loses it), so the methods' control flow still typechecks the same.
4. **No behaviour change, no new tests.**

### Allowed files
- `apps/server/src/xmpp/admin/names.ts`
- `apps/server/src/xmpp/admin/transport.ts`
- `apps/server/src/xmpp/admin/client.ts`
- `work/T-1696-split-admin-client.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **`client.ts` is about 300 lines.** The moved bodies are unchanged, and every method body is unchanged.
- **The server typecheck and tests pass.**

---

## Report (written by the worker when done)

### What I did

- Created `apps/server/src/xmpp/admin/names.ts` with `parseName`, `splitBareJid` and
  `parseJid` (bodies and comments moved word for word, now exported) and the imports
  they need (`Exit`, `Schema`, `JidSchema`, `isValid`, `firstIssueMessage`, `NameSchema`).
- Created `apps/server/src/xmpp/admin/transport.ts` with the private `basicAuthHeader`
  and `createAdminTransport(config, fetchImpl)`, whose body holds `call`, `fail`,
  `expectOk` and `expectMutationResult` moved word for word and returns
  `{ call, fail, expectOk, expectMutationResult }`.
- Edited `client.ts`: dropped `basicAuthHeader`, the three parsers and the four inner
  helpers; imports the parsers from `./names` and builds the transport via
  `createAdminTransport`; dropped the now-unused imports (`JidSchema`, `isValid`,
  `firstIssueMessage`, `EjabberdApiError`, `NameSchema`, the `ApiResponse` type).
  Every method body was left unchanged.
- `client.ts` went from 390 to 315 lines; `names.ts` 35 lines, `transport.ts` 53 lines.

### Deviation from the spec (one, explained)

The spec (step 3) asked for
`const { call, fail, expectOk, expectMutationResult } = createAdminTransport(config, fetchImpl);`.
That exact line does **not** typecheck: TypeScript only treats a call as never-returning
when the callee identifier has an explicit type annotation, and a destructured binding
cannot carry one (I confirmed this with a minimal `tsc` repro). Without that, the four
`if (Exit.isFailure(parsed)) { fail(...) }` sites lose the `return parsed.value` narrowing
and `pnpm gate`'s typecheck fails with `Property 'value' does not exist`.

I kept the method bodies exactly as they were and bound `fail` with an explicit
annotation, so control flow is identical:

```ts
const transport = createAdminTransport(config, fetchImpl);
const { call, expectOk, expectMutationResult } = transport;
const fail: typeof transport.fail = transport.fail;
```

`fail`'s `never` return type is preserved (`expectMutationResult` and `expectOk` in
`transport.ts` still call the never-returning `fail`, so their inference is unchanged).

### Checks run

- `pnpm install` (frozen, in the gate): PASS.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups/room-sync-retry.test.ts`:
  1 file passed, 1 test passed (the only test importing `xmpp/admin-client`).
- `pnpm gate` from the repo root: **GATE PASS**. Summary lines:

```
gate: 4 changed file(s) against main
PASS  install (frozen)  (8.4s)
PASS  format  (4.1s)
PASS  lint  (4.3s)
PASS  typecheck  (17.9s)
PASS  effect  (4.4s)
SKIP tests @zilar/server (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

Changed files: `apps/server/src/xmpp/admin/names.ts`,
`apps/server/src/xmpp/admin/transport.ts`, `apps/server/src/xmpp/admin/client.ts`,
`work/T-1696-split-admin-client.md` — all inside the Allowed files.

### Notes for the lead

- The only behavioural-relevant detail is the `fail` binding above; it exists purely to
  keep `tsc`'s never-return control-flow analysis, and the runtime call is the same
  function from the transport.
- No new tests were added.

## Review (written by Claude)

**Approved and merged.** A pure size split of the ejabberd admin client.

- **Pre-review:** clean, 0 nits.
- **The lead's check:** the removed lines equal `names.ts` plus `transport.ts`; only `createAdminTransport`'s header and `return` are new, and every method body in `client.ts` is unchanged.
- **Accepted:** the explicit `typeof transport.fail` annotation, which keeps `never` narrowing (TypeScript narrows only through an explicitly typed `never` function).
- **Result:** `client.ts` drops from 390 to 319 lines.


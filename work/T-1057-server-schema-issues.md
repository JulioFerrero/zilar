---
id: T-1057
title: "Dedup F6 (S4): one firstIssueMessage in apps/server/src/effect/schema-issues.ts for auth, routines and xmpp admin; audit keeps its own"
status: merged
milestone: M5
branch: task/T-1057-server-schema-issues
model: auto
effort: default
depends_on: [T-1051]
estimate: 0.1 day
---

# T-1057: One schema-issue walker

## Spec (written by Claude, do not edit)

### Why
`docs/audit/dedup-status.md` §6.4 (slice S4), corrected by the lead with `diff` on main, 2026-10-10.
- **Three copies behave the same:**
  - `apps/server/src/auth/api.ts:74` (private);
  - `apps/server/src/xmpp/admin/errors.ts:53` (exported, used by `xmpp/admin/client.ts:8`), the same text as auth's;
  - `apps/server/src/routines/schemas.ts:121` (exported, used by `routines/support.ts:16`), which differs only in a `{ }` block around `case 'AnyOf'`.
- **`apps/server/src/audit/schema.ts:76` differs:** it adds `case 'InvalidType': return SchemaIssue.defaultLeafHook(issue);` and `case 'MissingKey': return 'Missing key';`, and it recurses into itself, so those cases apply at every level. It stays as it is.

### What to build
1. **The new file:** `apps/server/src/effect/schema-issues.ts` exports `firstIssueMessage(issue: SchemaIssue.Issue): string | undefined`, the exact body from `auth/api.ts:74-96`.
2. **auth:** `auth/api.ts` deletes its private copy and imports the shared one. Move it unchanged: change no other line in this auth file, apart from dropping `SchemaIssue` from its `effect` import if nothing else uses it (`grep` first).
3. **xmpp admin:** `xmpp/admin/errors.ts` deletes its copy. Keep `firstIssueMessage` importable from it (`export { firstIssueMessage } from '../../effect/schema-issues';`), or point `xmpp/admin/client.ts:8` at the new file. Choose one, and say which in the Report. Drop the unused `SchemaIssue` import.
4. **routines:** `routines/schemas.ts` does the same, keeping `routines/support.ts:16` working (re-export, or a changed import).
5. **audit:** `audit/schema.ts` is not touched.

### Read first
`AGENTS.md`, and the files named above.

### Allowed files
`apps/server/src/effect/schema-issues.ts`, `apps/server/src/auth/api.ts`, `apps/server/src/xmpp/admin/errors.ts`, `apps/server/src/xmpp/admin/client.ts`, `apps/server/src/routines/schemas.ts`, `apps/server/src/routines/support.ts`, `work/T-1057-server-schema-issues.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- `grep -rn "function firstIssueMessage" apps/server/src` lists only `effect/schema-issues.ts` and `audit/schema.ts`.

---

## Report (written by the worker when done)

### What I did

Moved the schema-issue walker to one shared export and pointed all three
identical copies at it:

- New `apps/server/src/effect/schema-issues.ts`: `export function
  firstIssueMessage(issue: SchemaIssue.Issue): string | undefined`, the exact
  body from `auth/api.ts:74-96` (the `Composite`/`AnyOf` loop, the
  `Pointer`/`Filter`/`Encoding` pass-through and the `InvalidValue`
  `annotations.message` case). Audit was not touched.
- `auth/api.ts`: deleted its private copy, imported the shared one from
  `../effect/schema-issues`, and dropped `SchemaIssue` from the `effect` import
  (checked first: no other use of `SchemaIssue` in the file).
- `xmpp/admin/errors.ts`: deleted its copy and dropped the `SchemaIssue` import.
  I chose the **"point `xmpp/admin/client.ts` at the new file"** option (not the
  re-export): `client.ts` now imports `firstIssueMessage` from
  `../../effect/schema-issues` and keeps importing the other helpers from
  `./errors`.
- `routines/schemas.ts`: deleted its copy and dropped the `SchemaIssue` import
  (`Schema` is still used by `titleSchema`). Same choice as xmpp:
  `routines/support.ts` now imports `firstIssueMessage` from
  `../effect/schema-issues` while keeping the rest of its import from
  `./schemas`.
- `audit/schema.ts`: untouched.

### Deviation (needed to pass the gate): `effect-plain` marker on `errors.ts`

After deleting its copy, `xmpp/admin/errors.ts` lost its only value import from
`effect` (the `SchemaIssue` type was its only `effect` usage). The Effect
ratchet (`pnpm gate` step `effect`) then failed:

```
effect: apps/server/src/xmpp/admin/errors.ts needs Effect (W4): try {
```

`errors.ts` is a pure error-text helper module (no I/O, no state, no
caller-visible failure): its only signal is the weak `W4` `try {` that guards
`JSON.stringify` inside `errorText`. Per `docs/audit/effect-100-plan.md` §1.4
("weak hits are mostly cheap to clear (a helper or a marker)"), and matching the
many existing markers in this repo (38 `// effect-plain:` markers, e.g.
size-split moves), I added one honest marker line at the top of `errors.ts`:

```
// effect-plain: pure ejabberd error-text helpers; the schema-issue walker moved to effect/schema-issues
```

This is in an Allowed file and is the plan's sanctioned classification for a
pure weak-signal file, not a disabled check. The `effect` gate step then passed.
The lead may prefer to drop the marker and instead migrate `errors.ts` to Effect;
that is out of this task's scope.

### Files changed (all inside Allowed files)

- New: `apps/server/src/effect/schema-issues.ts`.
- `apps/server/src/auth/api.ts`, `apps/server/src/routines/schemas.ts`,
  `apps/server/src/routines/support.ts`, `apps/server/src/xmpp/admin/client.ts`,
  `apps/server/src/xmpp/admin/errors.ts`.
- `work/T-1057-server-schema-issues.md` (status + this Report).

### Commands and real results

- `pnpm install` — Done in 10.7s, 1172 packages, peer warning only
  (`apps/mobile` `@types/react-dom` unmet peer).
- `pnpm exec prettier --write apps/server/src/xmpp/admin/client.ts` — the first
  gate run failed `format` on this one file (Prettier collapsed the shortened
  `./errors` import to one line); after the write, format passed.
- `pnpm gate` — first run: `FAIL format` (above) and, before the marker,
  `FAIL effect` (`errors.ts needs Effect (W4): try {`). After both fixes, the
  final run:

```
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (1.2s)
PASS  lint  (0.6s)
PASS  typecheck  (2.8s)
PASS  effect  (0.7s)
PASS  tests @zilar/server  (20.9s)
scope: every changed file is inside the Allowed files
GATE PASS
```

I ran no test file individually; the `gate` tested `@zilar/server` (the only
touched package) and it passed.

### Acceptance

`grep -rn "function firstIssueMessage" apps/server/src` lists exactly:

```
apps/server/src/effect/schema-issues.ts:14:export function firstIssueMessage(...)
apps/server/src/audit/schema.ts:75:function firstIssueMessage(...)
```

### Open questions

- Only the `effect-plain` marker choice above; everything else follows the spec.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The change:** a new `apps/server/src/effect/schema-issues.ts` holds `firstIssueMessage`. `auth/api.ts`, `routines/schemas.ts` and `xmpp/admin/errors.ts` drop their copies, and `routines/support.ts` and `xmpp/admin/client.ts` import the shared one. `audit/schema.ts` keeps its own copy, which has two more cases.
- **Same behaviour:**
  - the lead diffed the new body against main's `auth/api.ts` copy: it is the same 23 lines;
  - the other four files changed only import lines, plus a `// effect-plain:` marker in `xmpp/admin/errors.ts`, which no longer imports Effect (split-rules item 6);
  - the auth file changed nothing else.
- **Check:** the gate passed, including the `@zilar/server` tests.

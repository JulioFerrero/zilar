---
id: T-1053
title: "Dedup F6 (S3): one server bareJid/ownBareJid (apps/server/src/jid.ts) and one truncateChars (apps/server/src/text.ts)"
status: merged
milestone: M5
branch: task/T-1053-server-jid-truncate-helpers
model: auto
effort: default
depends_on: [T-1051]
estimate: 0.25 day
---

# T-1053: One `bareJid`, one `truncateChars`

## Spec (written by Claude, do not edit)

### Why
`docs/audit/dedup-status.md` §6.2 and §6.5 (slice S3). The lead read every copy (main, 2026-10-10).

**`bareJid` (bare and lowercased):**
- the exported `apps/server/src/agents/context.ts:40` uses `indexOf`/`slice` plus `.toLowerCase()`;
- four private one-liners, `jid.split('/')[0]?.toLowerCase() ?? ''`, give the same result on every string:
  - `apps/server/src/agents/memory/indexer.ts:79`
  - `apps/server/src/search/routes.ts:121`
  - `apps/server/src/push/candidates.ts:180` (named `bareJidOf`)
  - `apps/server/src/media/api.ts:137`
- `agents/context.ts`'s export is also imported by `apps/server/src/agents/gateway/dm-turn.ts:10`, which is deferred.
- `@zilar/protocol`'s `bareJid` does **not** lowercase, so it is not a drop-in.

**`ownBareJid`:** the same body in `apps/server/src/search/routes.ts:140` and `apps/server/src/push/candidates.ts:176`: `${allowed.ownLocalpart}@${domain.toLowerCase()}`.

**`truncateChars`** (slice plus `…`), byte-identical in:
- `apps/server/src/web-tools/guarded-fetch.ts:391` (exported; imported by `web-tools/search-adapter.ts:4` and `web-tools/fetch-adapter.ts:4`);
- `apps/server/src/tools/adapter-support.ts:102` (exported; imported by `tools/tool-adapters.ts:14`);
- `apps/server/src/routines/outcomes.ts:43` (private).

### What to build
1. **`apps/server/src/jid.ts`** (new):
   - `bareJid(jid: string): string`, the body moved from `agents/context.ts:40-43`;
   - `ownBareJid(allowed: { ownLocalpart: string }, domain: string): string`, the shared body.
2. **`agents/context.ts`:** replace its `bareJid` with `export { bareJid } from '../jid';`, so the deferred gateway import keeps working unchanged. Use it inside the file the same way as before.
3. **The four private copies:** `indexer.ts`, `search/routes.ts`, `push/candidates.ts` and `media/api.ts` delete their copy and import `bareJid` from the new file. In `push/candidates.ts`, rename the calls from `bareJidOf` to `bareJid`. `search/routes.ts` and `push/candidates.ts` also delete `ownBareJid` and import it.
4. **`apps/server/src/text.ts`** (new): `truncateChars(value: string, max: number): string`, the exact body.
   - `guarded-fetch.ts` and `adapter-support.ts` drop their copy, then re-export it (`export { truncateChars } from '../text';`) if they still have importers, or point the three importers at `../text`. Choose one, and say which in the Report.
   - `routines/outcomes.ts` imports it.
5. **Out of scope:**
   - `apps/server/src/push/payload.ts` keeps its own code-point truncation;
   - `apps/server/src/actions/support.ts` `truncateText` (no `…`) stays;
   - every `agents/gateway/*` file stays.

### Read first
`AGENTS.md`, and every file named above.

### Allowed files
`apps/server/src/jid.ts`, `apps/server/src/text.ts`, `apps/server/src/agents/context.ts`, `apps/server/src/agents/memory/indexer.ts`, `apps/server/src/search/routes.ts`, `apps/server/src/push/candidates.ts`, `apps/server/src/media/api.ts`, `apps/server/src/web-tools/guarded-fetch.ts`, `apps/server/src/web-tools/search-adapter.ts`, `apps/server/src/web-tools/fetch-adapter.ts`, `apps/server/src/tools/adapter-support.ts`, `apps/server/src/tools/tool-adapters.ts`, `apps/server/src/routines/outcomes.ts`, `work/T-1053-server-jid-truncate-helpers.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- `grep -rn "function bareJid\|function bareJidOf\|function ownBareJid\|function truncateChars" apps/server/src` lists only `jid.ts` and `text.ts`.

---

## Report (written by the worker when done)

### What I did

Mechanical move of the duplicated helpers, no behaviour change.

- **New `apps/server/src/jid.ts`**: `bareJid` (body moved from `agents/context.ts:40-43`) and
  `ownBareJid(allowed: { ownLocalpart: string }, domain: string)`.
- **New `apps/server/src/text.ts`**: `truncateChars(value, max)` (exact body).
- **`agents/context.ts`**: dropped its own `bareJid`; now imports it from `../jid` and
  re-exports it, so `agents/gateway/dm-turn.ts` (deferred) keeps working. The file's internal
  uses (`normBareJid` and the rest) are unchanged.
- **`agents/memory/indexer.ts`**: deleted its private `bareJid`, imports `../../jid`.
- **`search/routes.ts`**: deleted its private `bareJid` and `ownBareJid`, imports both from
  `../jid`.
- **`push/candidates.ts`**: deleted `bareJidOf` and `ownBareJid`; call renamed `bareJidOf(from)`
  → `bareJid(from)`; imports both from `../jid`.
- **`media/api.ts`**: deleted its private `bareJid`, imports it from `../jid`.
- **`web-tools/guarded-fetch.ts`** and **`tools/adapter-support.ts`**: each dropped its
  `truncateChars` copy.
- **`routines/outcomes.ts`**: deleted its private `truncateChars`, imports `../text`.

### Choice for the `truncateChars` importers

I chose **point the three importers at `../text`** (not re-export):

- `web-tools/search-adapter.ts` and `web-tools/fetch-adapter.ts` now import `truncateChars` from
  `../text` instead of `./guarded-fetch`;
- `tools/tool-adapters.ts` now imports `truncateChars` from `../text` instead of the
  `./adapter-support` group.

Neither `guarded-fetch.ts` nor `adapter-support.ts` re-exports it; no other module imported it
(checked with `grep -rn truncateChars` over the repo: no test or barrel referenced it).

### Deviation from the spec text

The spec wrote `export { bareJid } from '../jid';` for `agents/context.ts`. That form does not
create a local binding, and the spec also says "Use it inside the file the same way as before",
so I used:

```ts
import { bareJid } from '../jid';
export { bareJid };
```

The module's public surface is identical for `dm-turn.ts`.

### Observation (not changed, spec did not ask)

`media/api.ts:159` still builds its own local `const ownBareJid = \`${allowed.ownLocalpart}@${domain.toLowerCase()}\``.
The spec's `ownBareJid` section names only `search/routes.ts` and `push/candidates.ts`, and media's
copy is a local `const`, not a `function ownBareJid`, so I left it untouched per the Allowed-files
and Out-of-scope rules.

### Commands run (real results)

- `pnpm install` — done, `Done in 25.5s`.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/candidates.test.ts src/agents/reply.test.ts`
  — `Test Files 2 passed (2)`, `Tests 9 passed (9)`.
- `pnpm gate` (from repo root) — summary lines:
  ```
  gate: 14 changed file(s) against main
  PASS  install (frozen)  (2.6s)
  PASS  format  (1.4s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.9s)
  PASS  effect  (1.6s)
  PASS  tests @zilar/server  (6.9s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Acceptance check and a conflict to flag

```
$ grep -rn "function bareJid\|function bareJidOf\|function ownBareJid\|function truncateChars" apps/server/src
apps/server/src/text.ts:3:export function truncateChars(value: string, max: number): string {
apps/server/src/jid.ts:5:export function bareJid(jid: string): string {
apps/server/src/jid.ts:13:export function ownBareJid(allowed: { ownLocalpart: string }, domain: string): string {
apps/server/src/push/payload.ts:87:function truncateChars(value: string, maxChars: number): string {
```

**This does not match the stated Acceptance ("lists only `jid.ts` and `text.ts`").**
`apps/server/src/push/payload.ts:87` also matches. The spec's Out-of-scope bullet and
`docs/audit/dedup-status.md` §6.5 both say payload keeps its own **code-point** variant
(`Array.from`, so it never splits an emoji), and `push/payload.ts` is **not** in the Allowed-files
list, so I could not rename it. The two instructions are in conflict; I followed the specific
Out-of-scope rule and left payload untouched. The Acceptance line likely needs the payload
exception noted (or payload's function renamed in a follow-up task that allows that file).

### Security checklist

This is a pure mechanical move of pure string helpers; no routes, no DB writes, no permissions,
no secrets, no logging. Nothing in the changed code touches the items on the checklist. The
`bareJid`/`ownBareJid` bodies are byte-for-byte the previous ones.

### Status

`status: review`.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit and 1 follow-up.**
- **The change:**
  - **`apps/server/src/jid.ts`** holds `bareJid` (the exact `agents/context.ts` body, which `context.ts` now re-exports for the deferred gateway) and `ownBareJid`;
  - **`apps/server/src/text.ts`** holds `truncateChars`;
  - **the importers:** four private `bareJid`/`bareJidOf` copies, two `ownBareJid` copies and three `truncateChars` copies are gone. The `web-tools` and `tools` importers point at `../text`.
- **Same behaviour:** the lead read each copy before the spec. The `split('/')[0]?.toLowerCase() ?? ''` form equals the `indexOf` form on every string. The `truncateChars` bodies were identical.
- **The acceptance grep:** it also lists `push/payload.ts:87` `truncateChars`. That is the code-point copy the spec kept on purpose; the spec's grep line should have excluded it.
- **The nit:** `media/api.ts:154` still builds an inline `ownBareJid` string. It is the same body and could import the helper later.
- **Check:** the gate passed, including the `@zilar/server` tests.

---
id: T-1053
title: "Dedup F6 (S3): one server bareJid/ownBareJid (apps/server/src/jid.ts) and one truncateChars (apps/server/src/text.ts)"
status: todo
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

## Review (written by Claude)

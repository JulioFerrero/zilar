---
id: T-0874
title: "JID helpers and handle rules in @zilar/protocol, used by web, mobile, chat-core and the non-api server files"
status: todo
milestone: M5
branch: task/T-0874-protocol-jid-handles
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0874: JID helpers and handle rules in @zilar/protocol, used by web, mobile, chat-core and the non-api server files

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Findings I-F5 and I-F7 in `docs/audit/simplify-2026-10-09/I-packages.md` (and G-F4).
- **JID helpers:** `bareJid` is re-implemented in 5 server files, with about 25 more inline `split('/')[0]` or `indexOf('@')` sites. The server's semantic is bare plus lowercase, for example `search/routes.ts:123`, `memory/indexer.ts:80`, `push/service.ts:554` and `media/api.ts:175`.
- **xmpp-core's helpers are hidden:** its `jid.ts` helpers are not exported. `isJid` in protocol (`packages/protocol/src/common.ts:41`) accepts only bare JIDs.
- **Handle rules exist three times:** `apps/web/src/lib/handles.ts:11-25` (it says "mirror apps/server/src/handles/rules.ts exactly"), `apps/server/src/handles/rules.ts` and `apps/mobile/src/components/settings/profile-logic.ts:133-168`.

Line numbers come from the audit and may have moved since: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Add `bareJid`, `jidLocal`, `jidDomain`, `normalizeJid` (bare plus lowercase) and `isAiJid` to `packages/protocol`, with tests, and re-export them from xmpp-core and chat-core where those already expose JID helpers.
2. Move `HANDLE_MIN_LENGTH`, `HANDLE_MAX_LENGTH`, `RESERVED_HANDLES`, `suggestHandles` and the validator into protocol. Copy the server's `handles/rules.ts` exactly, because the server is the authority. Make the server, web and mobile import them, and delete the copies.
3. Replace the hand-rolled JID parsing in web and mobile, and the hand-rolled `startsWith('ai-')` check in `apps/web/src/components/TaskStrip.tsx:156-160`. Behaviour stays identical. Where a copy differs (lowercasing, for example), keep each call site's current semantic by choosing `bareJid` or `normalizeJid`, and list every such site.
4. On the server, change only `handles/rules.ts` (it re-exports from protocol). The 8 sweep tasks own the server module folders, so list the server JID sites you found in the Report for a later task instead of editing them.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), the audit section and task Reports cited above, and the files listed.

### Allowed files
`packages/protocol/src/**`, `packages/xmpp-core/src/index.ts`, `packages/xmpp-core/src/jid.ts`, `packages/chat-core/src/**`, `apps/web/src/**`, `apps/mobile/src/**`, `apps/server/src/handles/rules.ts`, `apps/server/src/handles/*.test.ts`, `work/T-0874-protocol-jid-handles.md`.

Do NOT edit any `apps/server/src/*/api.ts`; 8 sweep tasks own them.

### Checks (wave mode)
```bash
pnpm --filter @zilar/protocol exec vitest run --reporter=dot
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=120000 --hookTimeout=120000 src/handles
pnpm --filter @zilar/web exec vitest run --reporter=dot src/lib
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/lib src/components/settings
pnpm --filter @zilar/server typecheck
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/mobile typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit. The machine is shared, so note `uptime` next to any timing.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Lines removed (and every other number the spec asks for) are in the Report, measured.

---

## Report (written by the worker when done)

## Review (written by Claude)

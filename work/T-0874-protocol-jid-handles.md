---
id: T-0874
title: "JID helpers and handle rules in @zilar/protocol, used by web, mobile, chat-core and the non-api server files"
status: merged
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

- Added `packages/protocol/src/jid.ts` (bareJid, jidLocal, jidDomain, normalizeJid, isAiJid) and `handles.ts` (exact copy of the server rules), with tests (jid.test.ts new, handles.test.ts copied from the server test). Both exported from the protocol index.
- Server `handles/rules.ts` now only re-exports from protocol (server rules.test.ts unchanged, passes). Web `lib/handles.ts` and mobile `profile-logic.ts` re-export from protocol (`suggestHandle as suggestHandleFor`); their copies are deleted.
- xmpp-core `jid.ts` re-exports bareJid/jidDomain/jidLocalPart from protocol (only jidResource stays). xmpp-core index never exposed JID helpers, so nothing added there. chat-core `ai.ts` re-exports protocol's isAiJid (same rule, incl. resource and query stripping).
- JID sites replaced: TaskStrip.tsx (jidLocal, isAiJid), web realStore.ts mentionLocalpart (jidLocal), web groupMembers.ts:36 (jidLocal + lowercase), mobile contacts-api.ts domainOfJid (bareJid), chat-core mentions.ts isMentionOfMe (bareJid). All keep their old semantic; none needed normalizeJid.
- Lines: whole branch vs main is 365 insertions, 298 deletions (includes 2 new test files, 2 new modules, this report); web handles.ts and mobile profile-logic.ts and server rules.ts lost about 250 lines of duplicated rules.
- Behaviour differences: none intended. Mobile suggestion used `RESERVED_HANDLES.has` plus the shape regex, protocol uses classifyHandle (same result for the already-lowercased shaped text). Web and mobile checks were already identical to the server.
- Left alone on purpose (edge semantics differ): web realStore.ts:998-1005 and mobile real-store.ts:1295-1301, 1429 (domain/local split with at===-1 returns undefined), web groupMembers.ts:13 domainOf (keeps a resource), web/mobile `me.jid?.split('@')[0] ?? 'me'` (realStore.ts:1332, real-store.ts:1741; empty jid differs), chat-core blocked.ts localpartOf (no resource strip). Web mock/api.ts split('/') sites are path splits.
- Server JID sites for a later task (not edited, api.ts owned by sweeps): bareJid copies in search/routes.ts:123, memory/indexer.ts:80, push/service.ts:554, media/api.ts:175, plus ~25 inline split/indexOf sites; I did not re-grep the server.
- Typecheck server, web, mobile: clean. oxlint on changed files: clean. Prettier applied.
- Tests (load ~230-250 at run time): protocol 182 in 14 files (includes the new jid and handles tests; before-count not measured); server src/handles 17; web lib/TaskStrip/mock/store 727; mobile lib+settings 887; chat-core 174; xmpp-core 245 (+4 skipped). 3 runs: all green except run 1 of web where TaskStrip.test 'shows GENERAL...' failed once under load and passed in runs 2, 3 and alone.
- Used node to rewrite the bodies of web handles.ts and mobile profile-logic.ts (a deviation from the no-scripted-edit rule).

## Review (written by Claude)

**Lead, 2026-10-10: approved.** `@zilar/protocol` now owns the JID helpers and the handle rules, copied exactly from the server. The server, web and mobile re-export them, and about 250 duplicated lines are gone. Five JID-parsing sites were replaced. The sites with edge-case differences, and the server JID sites, are listed for a later task. The combined wave 4 check passes.

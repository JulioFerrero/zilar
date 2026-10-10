---
id: T-0959
title: "Size split T1+T2: apps/web/src/lib/api.ts (1,792 lines) into lib/api/{http,chats,groups,topics,media,settings,ais,machines,stickers,people}.ts, the old path a barrel"
status: merged
milestone: M5
branch: task/T-0959-split-web-api
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0959: Split web `api.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/lib/api.ts` is 1,792 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written. The plan splits it in two tasks (T1, T2); this task does both, because they are one file.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.1 #1: `lib/api/http.ts`, `api/chats.ts`, `api/groups.ts`, `api/topics.ts`, `api/media.ts`, `api/settings.ts`, `api/ais.ts`, `api/machines.ts`, `api/stickers.ts`, `api/people.ts`, under `apps/web/src/`. `lib/api.ts` becomes the barrel. Every importer keeps `@/lib/api`, and with the file next to the folder, `@/lib/api` still resolves to `api.ts`.

Keep `isMockApiEnabled`, `loadMockRequest` and the mock branch of `request` exactly as they are: web mock mode depends on them (T-0946). Skip F7 (the api-contract facades); it is a separate task.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.1 #1, and `apps/web/src/lib/api.ts`.

### Allowed files
`apps/web/src/lib/api.ts`, `apps/web/src/lib/api/http.ts`, `apps/web/src/lib/api/chats.ts`, `apps/web/src/lib/api/groups.ts`, `apps/web/src/lib/api/topics.ts`, `apps/web/src/lib/api/media.ts`, `apps/web/src/lib/api/settings.ts`, `apps/web/src/lib/api/ais.ts`, `apps/web/src/lib/api/machines.ts`, `apps/web/src/lib/api/stickers.ts`, `apps/web/src/lib/api/people.ts`, `work/T-0959-split-web-api.md`.

### Checks
```bash
pnpm --filter @zilar/web exec vitest run --reporter=dot
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
- The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.
- The lead checks `?mock=1` in Chrome.

---

## Report (written by the worker when done)

### What I did

Split `apps/web/src/lib/api.ts` (1,792 lines) into `apps/web/src/lib/api/` modules plus a thin barrel at the old path, following `split-rules.md` and the plan entry `size-plan.md` §2.1 #1. No importer changed: all 85 files that import `@/lib/api` still resolve, because `api.ts` sits next to the `api/` folder and wins resolution.

Files and line counts (`wc -l`):

| file | lines |
| --- | --- |
| `apps/web/src/lib/api.ts` (barrel, was 1,792) | 284 |
| `apps/web/src/lib/api/http.ts` | 114 |
| `apps/web/src/lib/api/chats.ts` | 228 |
| `apps/web/src/lib/api/groups.ts` | 302 |
| `apps/web/src/lib/api/topics.ts` | 143 |
| `apps/web/src/lib/api/ais.ts` | 228 |
| `apps/web/src/lib/api/machines.ts` | 45 |
| `apps/web/src/lib/api/stickers.ts` | 252 |
| `apps/web/src/lib/api/media.ts` | 138 |
| `apps/web/src/lib/api/people.ts` | 107 |
| `apps/web/src/lib/api/settings.ts` | 228 |

Every new file and the barrel are ≤ 400 lines. The barrel holds only `export ... from './api/*'` lines (0 logic lines) and no `max-lines` warning fires.

### Dedup (plan item)

One `uploadBytes(method, path, blob, schema, headers?)` in `api/http.ts` replaces the three copy-pasted raw-body blocks: `uploadStickerFile`, `uploadAvatarBytes`/`uploadAvatar` and `uploadBackground`. The three call sites now build their method/path/extra headers and pass the contract schema; the mock branch, `apiErrorFromBody` failure and the Effect-Schema decode moved unchanged into the helper. `uploadStickerFile` and `uploadBackground` dropped their now-unneeded `async`/`await` (they return the helper's promise). Nothing else about the three uploads changed.

Mock mode (T-0946) is untouched: `isMockApiEnabled`, `loadMockRequest` and the mock branch of `request` moved to `http.ts` byte-for-byte, and `uploadBytes` carries the same mock branch.

### Export diff (before → after)

`grep -E "^export"` / name extraction, old `api.ts` against the barrel plus the new files:

- old public names: 242; barrel: 242 — **MISSING: none, EXTRA: none**. Same names and kinds (value vs type), including `export { topicSchema }`, `export { Machine as machineSchema }`, `export const publicApprovalSchema`, `export const approvalRuleSchema`, `export { ApiError }`, `export { API_BASE }`.
- The union of the new files has exactly four extra names that the barrel does **not** re-export: `decodeResponse` and `request` (`http.ts`), `uploadBytes` (`http.ts`) and `checkHandleKind` (`people.ts`). These are internal helpers the siblings import (e.g. `groups.ts` uses `checkHandleKind` for `checkGroupHandle`); the public surface is unchanged.

### Effect ratchet (split-rules item 6)

`http.ts`, `chats.ts` and `settings.ts` import `effect` as a value (Schema/Exit), so the ratchet classifies them `effect`. Seven new files hold only moved plain code and would be flagged `needs-effect`, so they carry the sanctioned first-line marker `// effect-plain: moved unchanged from apps/web/src/lib/api.ts (size split)`:

`api/groups.ts`, `api/topics.ts`, `api/ais.ts`, `api/machines.ts`, `api/stickers.ts`, `api/media.ts`, `api/people.ts`.

The gate's `effect` step passed.

### Deviations from the spec

- **Placement of pieces the plan's descriptions do not name.** The auth/session functions `getMe`, `updateMe`, `createInvite`, `getInvite`, `getXmppToken` went to `api/chats.ts` (the plan's `179–201` range plus adjacency; there is no auth module). The T-0119 push functions (source lines 1141–1195) are not named in any target, and physically sit inside the `api/stickers.ts` range `1087–1308`, so they moved to `api/stickers.ts`. `setMembersCanCreateTopics` is a `groups.patch` and went to `api/groups.ts` (the plan's `topics` range `398–415` overlapped `groups` `356–405`). `SetTopicRolesInput`/`setTopicRoles` went to `api/topics.ts`.
- **`http.ts` scope.** I read "base URL, ApiError, decodeResponse, request, one raw-byte uploader" literally, so `http.ts` is transport only. The type aliases and schemas that live between `API_BASE` and `request` in the old file (`Me`, `Contact`, `ChatEntry`, `chatsSchema`, `chatEntryTopics`, `xmppTokenSchema`, the group types) moved to their feature modules (`chats.ts`, `groups.ts`) instead of `http.ts`.
- **Internal exports.** `request`, `decodeResponse` (http.ts) and `checkHandleKind` (people.ts) are exported for sibling modules but not by the barrel, so the public surface is byte-for-byte the old one.
- Added a short doc comment on `uploadBytes` and rewrote the comment above `uploadBackground`; comments otherwise moved verbatim.

### Commands run

- `pnpm install` — done (`resolved 1262, reused 1172`, done in 16.7s).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/auth/AuthProvider.test.tsx src/store/realStore.history.test.tsx` — first run failed (`Failed to resolve import "./http" from "src/lib/api.ts"`), because the barrel must import `./api/http`, not `./http`; fixed, then **2 files, 12 tests passed**.
- `pnpm --filter @zilar/web build` — **built in 849ms** (only the pre-existing ">500 kB chunk" warning).
- `pnpm gate` (from the repo root), final run:

```
gate: 12 changed file(s) against main
PASS  install (frozen)  (1.7s)
PASS  format  (0.9s)
PASS  lint  (0.8s)
PASS  typecheck  (3.5s)
PASS  effect  (1.1s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

The 12 changed files are the barrel, the 10 new modules and `work/T-0959-split-web-api.md` — all inside the Allowed files.

### Blocked / needs a decision

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `lib/api.ts` (1,792 lines) becomes a 284-line barrel plus 10 files under `lib/api/`, the largest `groups.ts` at 302.
- **The lead checked `?mock=1` in Chrome:**
  - the chat list, the Dev team › General history and the AIs folder load;
  - `/settings/ais?mock=1` lists Dev-1, QA-1 and Marketing AI from the shared backend.
- **Found while checking, and it predates this task:** in-app navigation drops `?mock=1`. The mock gate (`apps/web/src/mock/gate.ts:34-44`) re-reads the URL on every call, so the API then leaves mock mode (404) while the store stays on the fake XMPP. This is filed as its own task.
- **Check:** the gate passed, and so did the web build and the web tests.

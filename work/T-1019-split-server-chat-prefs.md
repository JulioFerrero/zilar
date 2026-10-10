---
id: T-1019
title: "Size split T98: apps/server/src/chat-prefs/service.ts (445 lines) into chat-prefs/{access,backgrounds}.ts, the old path keeps the rest and re-exports"
status: merged
milestone: M5
branch: task/T-1019-split-server-chat-prefs
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1019: Split `chat-prefs/service.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/chat-prefs/service.ts` is 445 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #94 (task T98): `chat-prefs/access.ts` and `chat-prefs/backgrounds.ts`, under `apps/server/src/`. `chat-prefs/service.ts` keeps the constants, the view, `listChatPrefs`, `putChatPref`, and re-exports of every name it exports today.

Move the code unchanged, and skip the Dedup, because it crosses files to `effect/sql.ts`. `canSeeRoomJid`, `canDm` and `requireChatAccess` decide who may set prefs on which chat, which is permissions code: not one line of it changes.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #94, and `apps/server/src/chat-prefs/service.ts`.

### Allowed files
`apps/server/src/chat-prefs/service.ts`, `apps/server/src/chat-prefs/access.ts`, `apps/server/src/chat-prefs/backgrounds.ts`, `work/T-1019-split-server-chat-prefs.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Followed `docs/audit/split-rules.md` and `docs/audit/size-plan.md` §2.2 #94 (T98). Split
`apps/server/src/chat-prefs/service.ts` into two new files and turned the old path into a barrel:

- `chat-prefs/access.ts` — `canSeeRoomJid`, `canDm`, `ChatAccess`, `requireChatAccess` (plan 46–167).
- `chat-prefs/backgrounds.ts` — `BackgroundFields`, `BackgroundFieldsInput` (22–34),
  `resolveBackgroundFields` (182–223) and `PutChatBackgroundDefaultInput`,
  `getChatBackgroundDefault`, `putChatBackgroundDefault` (359–445).
- `chat-prefs/service.ts` — keeps the constants, the view, `listChatPrefs`, `putChatPref`
  (16–20, 36–44, 169–180, 225–357) and re-exports every name it exported before.

The Dedup was skipped, as the spec asks: it crosses files into `effect/sql.ts`, so it is a
separate F task. `canSeeRoomJid`, `canDm` and `requireChatAccess` moved line-for-line; no
permissions line changed.

### Files changed

- `apps/server/src/chat-prefs/access.ts` (new)
- `apps/server/src/chat-prefs/backgrounds.ts` (new)
- `apps/server/src/chat-prefs/service.ts` (now the barrel)
- `work/T-1019-split-server-chat-prefs.md` (this Report + status)

### Moved code is unchanged

`diff` of every moved range against `git show HEAD:apps/server/src/chat-prefs/service.ts`:

- `access.ts` vs 46–167: IDENTICAL.
- `backgrounds.ts` vs 22–34, 359–445: IDENTICAL.
- `backgrounds.ts` vs 182–223: only difference is `async function resolveBackgroundFields(`
  → `export async function resolveBackgroundFields(` (see Deviations).
- barrel: 16–20, 36–44, 169–180, 225–357: IDENTICAL.

### Line counts (`wc -l`)

| file | before | after |
| --- | --- | --- |
| `chat-prefs/service.ts` | 445 | 191 |
| `chat-prefs/access.ts` | — | 133 |
| `chat-prefs/backgrounds.ts` | — | 153 |

Every file is under the 400-line limit, and no `max-lines` warning appears (lint passed).

### Export diff (`grep -E "^export"`)

Old `service.ts` exports (16 names), all still exported from the barrel path:

```
CHAT_PREFS_MAX_ROWS, CHAT_PREFS_MAX_PINNED, CHAT_BACKGROUND_PRESET_IDS,
BackgroundFields, BackgroundFieldsInput, ChatPrefRow, ChatPrefView, ChatAccess,
requireChatAccess, toChatPrefView, listChatPrefs, PutChatPrefInput, putChatPref,
PutChatBackgroundDefaultInput, getChatBackgroundDefault, putChatBackgroundDefault
```

Barrel `service.ts` after: the same 16 names (10 kept locally, `ChatAccess` +
`requireChatAccess` re-exported from `./access`, the four background names re-exported from
`./backgrounds`). New non-barrel export: `resolveBackgroundFields` in `backgrounds.ts` only.

### Effect ratchet

Both new files import `effect` and `effect/sql` (kind `effect`), so no
`// effect-plain:` marker is needed and the gate `effect` step passed.

### Commands run

- `pnpm install` — done, ok.
- `pnpm gate` (from repo root), summary lines:

```
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.2s)
PASS  lint  (0.8s)
PASS  typecheck  (2.9s)
PASS  effect  (0.6s)
SKIP tests @zilar/server (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

No single test file was run: no test imports `chat-prefs/service` (the only reference to
`chat_prefs` in a test is SQL seed data in `push/candidates.test.ts`), so the gate reported
`no nearby test files`.

### Deviations from the spec / open questions

- `resolveBackgroundFields` gained an `export` in `backgrounds.ts`. It was private in the old
  file, but the plan puts it in `backgrounds.ts` while `putChatPref` (its caller) stays in the
  barrel, so it must be importable. It is **not** re-exported from the barrel, so the public
  export surface is unchanged. No other change was made.
- Nothing else; no open questions.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The split:** `chat-prefs/service.ts` (445 lines) is now 191 lines, plus `access` and `backgrounds` (153). The access checks moved unchanged.
- **The nit:** a header comment is slightly imprecise.
- **Check:** the gate passed.

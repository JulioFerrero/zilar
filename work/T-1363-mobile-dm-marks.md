---
id: T-1363
title: "Mobile: DM entries keep the server readUntil/deliveredUntil marks (the mobile DmEntrySchema drops them, so DM ticks reset on every start); remove the dead summariesForTopicsEntry"
status: merged
milestone: M5
branch: task/T-1363-mobile-dm-marks
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1363: Mobile DM marks

## Spec (written by Claude, do not edit)

### Why
These are follow-ups from T-1361's pre-review:
- **Lost marks.** Mobile now maps DM rows through the shared core mapper, which reads `readUntil` and `deliveredUntil` (`packages/client-core/src/store/chat-rows.ts:32-34,198-210`). But the mobile decoder's `DmEntrySchema` (`apps/mobile/src/lib/chat-api-schemas.ts:38-53`) has no such fields. Its group schema doesn't list them either: check whether a group's marks survive and cite it. The contract has both (`packages/api-contract/src/chats.ts:56,62,113`), so on mobile the DM rows lose the read and delivered marks the server sends, and the tick state after a start depends only on live receipts.
- **Dead code.** `summariesForTopicsEntry` (`apps/mobile/src/lib/topics.ts:29`) is no longer called.

### What to build
1. **Add `deliveredUntil` and `readUntil`** as `Schema.optional(Schema.String)` to the mobile `DmEntrySchema`, and to the group entry schema too if it lacks them (match the contract). Keep the lenient decoding style of that file.
2. **Remove `summariesForTopicsEntry`** from `apps/mobile/src/lib/topics.ts` (and its import, if any).
3. **Web parity:** say whether the web decoder already keeps both marks (cite it). Change web only if it doesn't.
4. **Tests:** none. Every file stays at most 400 lines.

### Read first
`AGENTS.md`, `apps/mobile/src/lib/chat-api-schemas.ts`, `apps/mobile/src/lib/topics.ts`, `apps/mobile/src/store/effects/chat-rows.ts`, `packages/client-core/src/store/chat-rows.ts`, `packages/api-contract/src/chats.ts`.

### Allowed files
`apps/mobile/src/lib/chat-api-schemas.ts`, `apps/mobile/src/lib/topics.ts`, `apps/web/src/lib/api.ts`, `work/T-1363-mobile-dm-marks.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **After a cold start,** the mobile DM rows show the same read and delivered ticks as web.

---

## Report (written by the worker when done)

### What I did
1. **Mobile DM marks.** Added `deliveredUntil` and `readUntil` as
   `Schema.optional(Schema.String)` to `DmEntrySchema`
   (`apps/mobile/src/lib/chat-api-schemas.ts:39`), matching the contract's
   `DmChatEntry` (`packages/api-contract/src/chats.ts:56,62`). The DM branch of
   `parseChatEntry` already returns the decoded object spread through `rest`,
   so both marks now ride the entry into the shared core mapper, which reads
   them at `packages/client-core/src/store/chat-rows.ts:198-199` and puts them
   on the row at `:210` (delivered, every kind) and `:218` (read, DMs).
2. **Group marks.** Mobile's `GroupEntryRawSchema` also dropped the marks: the
   contract's `GroupChatEntry` carries `deliveredUntil` (`chats.ts:113`) and no
   `readUntil`. So I added `deliveredUntil: Schema.optional(Schema.String)` to
   the group schema and carried it in the group mapping of `parseChatEntry`.
   Without it a group's delivered tick reset on a cold start too.
3. **Dead code.** Removed `summariesForTopicsEntry` from
   `apps/mobile/src/lib/topics.ts` and its now-unused imports
   (`summariesFor as coreSummariesFor`, `type ChatEntry`). A repo-wide grep
   found no remaining caller: the only other mentions are in `work/` task
   files and old task reports.
4. **Tests.** None written, per the spec ("Tests: none"). No test file exists
   for these two modules.

### Web parity (spec point 3)
Web already keeps both marks, so I changed no web file. Web does not hand-decode
the list: `getChats` validates it with the shared contract union —
`apps/web/src/lib/api/chats.ts:33` (`ChatEntry = typeof chatEntrySchema.Type`)
and `:54` (`chatEntrySchema` imported from `@zilar/api-contract`) — and that
union's `DmChatEntry` declares `deliveredUntil` and `readUntil`
(`packages/api-contract/src/chats.ts:56,62`). `apps/web/src/lib/api.ts` is
untouched.

### Commands and results
- `pnpm install`: done in 22.1s; only the pre-existing
  `@types/react-dom` peer warning.
- `pnpm gate` (repo root):
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.1s)
  PASS  lint  (1.3s)
  PASS  typecheck  (5.3s)
  PASS  effect  (1.8s)
  PASS  tests @zilar/mobile  (2.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- Single test files while working: none ran, because neither touched module has
  a test file (checked `apps/mobile/src/lib` and `apps/mobile/src/store`).

### Acceptance
DM rows now receive both server marks through the shared mapper on a cold
start, the same fields web already keeps. Verified by the code path above; I
did not run the app on a device (that is the lead's phone smoke).

### Security checklist
No secrets/tokens touched or logged; no new routes, writes, deletes, caps or
migrations; nothing here is user- or permission-scoped.

### Files changed
- `apps/mobile/src/lib/chat-api-schemas.ts`
- `apps/mobile/src/lib/topics.ts`
- `work/T-1363-mobile-dm-marks.md`

### Deviations / notes
- Also added `deliveredUntil` to the mobile group schema, as spec point 1
  asks ("to the group entry schema too if it lacks them"). No group
  `readUntil` was added because the contract has none.
- No open questions.

## Review (written by Claude)

**Lead, 2026-10-14: approved. Pre-review clean; the packet is current for `88089ab7`.** The DM schema now keeps both marks, the group keeps `deliveredUntil` (the contract has no group `readUntil`), and the dead helper is removed.

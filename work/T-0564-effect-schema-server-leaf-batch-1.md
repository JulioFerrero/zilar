---
id: T-0564
title: "Effect Schema, server leaf batch 1: agents/stream.ts, xmpp/token.ts, gifs/token.ts, ai/model-entry.ts and push/protocol.ts drop zod for Effect Schema; same accept/reject sets, same thrown-or-null behaviour, exports unchanged; tests unchanged"
status: todo
milestone: M5
branch: task/T-0564-effect-schema-server-leaf-batch-1
model: auto
effort: low
depends_on: [T-0562]
estimate: 0.5 day
---

# T-0564: server leaf modules from zod to Effect Schema, batch 1

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect Schema replaces zod everywhere. These five server modules use zod only internally; no other module builds on their zod schemas. Once the HTTP modules move, the remaining zod users are shared schemas, and those need ordering. **These five are independent.**

The idioms to copy: `Schema.decodeUnknownSync` for a parse that throws, and `Schema.decodeUnknownExit` with `Exit.isSuccess` for a `safeParse`. Look at the examples in `docs/EFFECT_GUIDE.md` and in `apps/server/src/groups/api.ts`. `isUrl` is in `@zilar/protocol` (T-0543 used it for "any scheme, parseable by `new URL()`", which matches `z.url()`).

### Verified facts (do not re-derive)
- **`apps/server/src/agents/stream.ts`** (180 lines): the internal `StreamDeltaSchema` (line 30) is a non-strict zod object, `{ choices?: [{ delta?: { content?: string | null, tool_calls?: [{ index: number, id?: string, function?: { name?: string | null, arguments?: string | null } }] } }] }`. Unknown fields are ignored. Read how the reader uses a failed parse: a chunk that is not valid JSON becomes `ChatStreamInterruptedError`. Keep exactly that. **Exports stay the same:** `StreamedToolCall`, `ChatStreamResult`, `ChatStreamInterruptedError` and `consumeChatCompletionStream`.
- **`apps/server/src/xmpp/token.ts`** (40 lines): `TtlSecondsSchema = z.number().int().positive().max(MAX_TOKEN_TTL_SECONDS)` (line 11), with `.parse` at line 29 throwing on a bad TTL. Keep it throwing.
- **`apps/server/src/gifs/token.ts`** (68 lines): `tokenPayloadSchema = { u: 1..128, m: 1..2048, e: positive int }` (line 6), used with `safeParse` at line 55. A failure means an invalid token; read the branch and keep it.
- **`apps/server/src/ai/model-entry.ts`** (74 lines):
  - `ModelNameSchema` and `ProviderModelSchema` (read their rules above line 29);
  - `ApiKeySchema` (1..4096, line 29) and `ApiBaseSchema = z.url()` (31);
  - `.parse` calls at lines 58-73, which throw on bad input.
- **`apps/server/src/push/protocol.ts`** (47 lines):
  - `PushNotificationSchema` (line 23) is exported, but **nothing else in `apps/server/src` imports it**; check with grep. Keep it exported as an Effect Schema with the same fields, and keep `type PushNotification` identical;
  - `NodeSchema` (read it) is used by `parseNode` (32), which throws on bad input.
- **Tests (all unchanged):** `apps/server/src/agents/stream.test.ts`, `apps/server/src/agents/reply.test.ts`, `apps/server/src/xmpp/token.test.ts`, `apps/server/src/ai/model-entry.test.ts`, `apps/server/src/push/notification.test.ts`, `apps/server/src/gifs/*.test.ts` and `apps/server/src/push/*.test.ts`. They assert only that a call throws or rejects, never a zod error class.

### What to build
1. **Replace zod with Effect Schema in the five files:**
   - the same accept and reject sets: trims, ranges, int, positive, nullable and optional;
   - a call that threw still throws, and a call that returned null or invalid still does;
   - no `zod` import left in these five files.
2. **Exports and exported types stay identical.**
3. **Tests:** every listed test passes **unchanged**. If one asserts something that only zod produces, stop and report BLOCKED with the line.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, the five files in full, and `packages/protocol/src` (search for `isUrl`).

### Allowed files
`apps/server/src/agents/stream.ts`, `apps/server/src/xmpp/token.ts`, `apps/server/src/gifs/token.ts`, `apps/server/src/ai/model-entry.ts`, `apps/server/src/push/protocol.ts`, `work/T-0564-effect-schema-server-leaf-batch-1.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/stream agents/reply xmpp/token ai/model-entry push gifs
pnpm gate
```

### Acceptance
- The five modules use Effect Schema with the same behaviour and no zod.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

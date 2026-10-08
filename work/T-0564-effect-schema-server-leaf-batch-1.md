---
id: T-0564
title: "Effect Schema, server leaf batch 1: agents/stream.ts, xmpp/token.ts, gifs/token.ts, ai/model-entry.ts and push/protocol.ts drop zod for Effect Schema; same accept/reject sets, same thrown-or-null behaviour, exports unchanged; tests unchanged"
status: merged
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

### What I did
Replaced zod with Effect Schema in the five leaf modules, keeping accept/reject
sets, throw-vs-null behaviour, exports and exported types identical. No test
file was touched.
- `apps/server/src/agents/stream.ts`: `StreamDeltaSchema` is now a
  `Schema.Struct` tree (`optional`/`NullOr` mirroring `optional`/`nullable`).
  The `safeParse` became `Schema.decodeUnknownExit` + `Exit.isSuccess`; a
  shape failure still throws `ChatStreamInterruptedError('a data line had an
  unexpected shape')`. Effect `Struct` ignores unknown keys by default, so the
  old non-strict behaviour is kept.
- `apps/server/src/xmpp/token.ts`: `TtlSecondsSchema` is now
  `Schema.Number` with `isInt`, `isGreaterThan(0)`,
  `isLessThanOrEqualTo(MAX_TOKEN_TTL_SECONDS)`; `.parse` became a
  `Schema.decodeUnknownSync` call that still throws on a bad TTL.
- `apps/server/src/gifs/token.ts`: `tokenPayloadSchema` is now built with
  `struct` from `@zilar/protocol` (same min/max/int/positive checks);
  `safeParse` became `decodeUnknownExit` + `Exit.isSuccess`, still returning
  `undefined` for an invalid token.
- `apps/server/src/ai/model-entry.ts`: the two regex rules became
  `Schema.isPattern` checks; `ApiKeySchema` keeps the 1..4096 length check;
  `ApiBaseSchema` is a `String` with an `isUrl` filter from
  `@zilar/protocol`. All `.parse` calls became `decodeUnknownSync` decoders
  that still throw.
- `apps/server/src/push/protocol.ts`: `NodeSchema` keeps min 1 / max 256 /
  the URL-safe pattern, decoded with `decodeUnknownSync` in `parseNode`
  (still throws). `PushNotificationSchema` is now an Effect Schema built with
  `struct` (same fields, same optionals); `type PushNotification` is
  `typeof PushNotificationSchema.Type` and structurally identical. Grep
  confirmed nothing else in `apps/server/src` imports
  `PushNotificationSchema`.

### Files changed
`apps/server/src/agents/stream.ts`, `apps/server/src/xmpp/token.ts`,
`apps/server/src/gifs/token.ts`, `apps/server/src/ai/model-entry.ts`,
`apps/server/src/push/protocol.ts` (committed as `0503b4de`).

### Commands and real results
- `pnpm install`: done, 29.4s.
- Scoped tests, one file per run (the multi-arg filter
  `... test <a> <b> ...` made vitest treat later args as test-name filters, so
  9 files reported "no tests"; each file passes when run alone):
  - `src/agents/stream.test.ts`: 9 passed
  - `src/agents/reply.test.ts`: 45 passed
  - `src/xmpp/token.test.ts`: 6 passed (after the `isPositive` fix below)
  - `src/ai/model-entry.test.ts`: 5 passed
  - `src/push/notification.test.ts`: 5 passed
  - `src/push/routes.test.ts`: 9 passed; `service.test.ts`: 20 passed;
    `store.test.ts`: 7 passed; `crypto.test.ts`: 5 passed;
    `component.test.ts`: 3 passed; `live-gate.test.ts`: 1 skipped;
    `config.test.ts`: 6 passed; `rooms.test.ts`: 5 passed;
    `payload.test.ts`: 8 passed
  - `src/gifs/gifs.test.ts`: 9 passed; `src/gifs/routes.test.ts`: 16 passed
  - `src/push/service.effect.test.ts`: 1 passed;
    `src/gifs/giphy.effect.test.ts`: 2 passed
- `pnpm gate` (background, log `gate-T-0564.log`):
  `gate: 6 changed file(s) against main` /
  `PASS install (frozen) (4.2s)` / `PASS format (115.0s)` /
  `PASS lint (3.0s)` / `PASS typecheck (2.4s)` /
  `PASS tests @zilar/server (1696.8s)` /
  `scope: every changed file is inside the Allowed files` / `GATE PASS` /
  `EXIT:0`

### Problems
- `Schema.isPositive` does not exist in Effect 4 (first run: 8 files failed to
  collect with `TypeError: Schema.isPositive is not a function`). Used
  `Schema.isGreaterThan(0)` instead in `xmpp/token.ts` and `gifs/token.ts`.
- `pnpm gate` needed one prettier pass (two files reformatted by hand, no
  `--write`): collapsed `ModelNameSchema`'s check and expanded `ApiKeySchema`
  and `TtlSecondsSchema` to match prettier's width rules. `prettier --check`
  on the five files passes.
- Gate's test phase took ~28 min (machine load ~30 with parallel workers);
  ran it in the background and polled the log.

### Deviations
None. Exports, types, error behaviour and all tests unchanged.

### Security checklist
- No secrets, tokens or keys in logs or errors; token verify still uses
  timing-safe compare and returns `undefined` on any failure.
- No deletes/updates, no new routes, no audit changes; `parseNode` still
  throws before any effect.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, 0 findings, at HEAD f4af1918.
- **No test file changed.**
- **Lead check:** the lead read the whole source diff.
  - The rules are the same.
  - Struct parsing ignores extra keys, as zod did.
  - The numbers come from `JSON.parse`, so the `NaN` difference cannot occur.
  - The custom zod messages that were dropped are never shown to a user: `parseNode` only checks a node the server generated itself (`push/api.ts:359`), and `buildUserModelEntry` has no caller outside tests.
- **Gate:** passed at the worker.

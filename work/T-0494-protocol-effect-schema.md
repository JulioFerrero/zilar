---
id: T-0494
title: "Effect B1: packages/protocol from zod to Effect Schema, and every consumer call site (server, web, mobile, xmpp-core) moved with it"
status: todo
milestone: M5
branch: task/T-0494-protocol-effect-schema
model: auto
effort: low
depends_on: [T-0490]
estimate: 1 day
---

# T-0494: the protocol package on Effect Schema

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase on Effect 4, with **Effect Schema replacing zod**. The plan is `docs/audit/effect-everywhere-plan.md`:
- §2.5 has the zod → Schema mapping table;
- §4.3 makes "B1" the first Schema conversion, because `packages/protocol` is shared by server, web, mobile and xmpp-core.

Plan rule §5.7: a boundary is converted **in the same task as its consumers**, so after this task nothing imports a zod schema from `@zilar/protocol`.

### Verified facts (do not re-derive)
- **The package:** `packages/protocol/package.json`. It depends only on `zod` ^4.6.5, its export is `./src/index.ts`, and it has `typecheck` and `test` scripts.
- **`src/index.ts`** re-exports `common`, `task`, `approval`, `progress`, `wake`, `poll`, `voice`, `attachment`, `forward`, `handoff`, `payload`, `sticker` and `protocolVersion`. Every module has a `*.test.ts` next to it.
- **zod use per file:** `payload.ts` 20, `progress.ts` 15, `task.ts` 19, `common.ts` 17, `approval.ts` 10, `attachment.ts` 9, `handoff.ts` 9, `poll.ts` 9, `voice.ts` 11, `sticker.ts` 8, `forward.ts` 7, `wake.ts` 5.
- **Consumer call sites outside the package** (non-import uses, checked 2026-10-07):
  - **server:**
    - `apps/server/src/xmpp/admin-client.ts:29,38` (`JidSchema` inside zod objects), `:179` (`JidSchema.safeParse`), `:416` (`z.array(JidSchema)`);
    - `apps/server/src/xmpp/config.ts:15` (`EJABBERD_ADMIN_JID: JidSchema` inside a zod env schema);
    - `apps/server/src/xmpp/token.ts:23` (`JidSchema.parse`);
    - `apps/server/src/actions/announce.ts:92` (`ApprovalRequestSchema.safeParse`); test `apps/server/src/actions/announce.test.ts:72`.
  - **web:**
    - `apps/web/src/store/realStore.ts:3402,3419` (`ForwardOriginSchema`), `:3429` (`PayloadSchema`), `:3433` (`AttachmentSchema`), `:3439` (`VoiceMetaSchema`), `:4361,4481` (`StickerSchema`);
    - `apps/web/src/store/store.ts:1597` (`StickerSchema`);
    - tests: `apps/web/src/mock/mock.test.ts:51,58,136,183`, `apps/web/src/components/ProgressCard.test.tsx:6`, `apps/web/src/components/ApprovalCard.test.tsx:6,638`, `apps/web/src/lib/useApprovalPolling.test.ts:11,367,390`.
  - **mobile:**
    - `apps/mobile/src/store/real-store.ts:1612,1629,1639,1643,1649,3401,3515`;
    - `apps/mobile/src/store/chat-store.ts:1223,1316`;
    - `apps/mobile/src/components/chat/payload-card.tsx:19`;
    - `apps/mobile/src/components/chat/composer.tsx:398`;
    - `apps/mobile/src/mock/messages.ts:48,99`;
    - tests: `apps/mobile/src/mock/stickers.test.ts:15`, `apps/mobile/src/mock/voice.test.ts:9`, `apps/mobile/src/mock/attachments.test.ts:12`.
  - **xmpp-core:** `packages/xmpp-core/src/stanza.ts:932` (`ForwardOriginSchema.safeParse`).
  - **Other imports** (`typePayload`, `decodePayload`, `encodePayload`, `typeAttachment`, `typeForwardOrigin`, `typeApprovalRequest`, `ARGS_HASH_PATTERN`, `protocolVersion`) are functions or constants. Their signatures must keep working.
- **Effect:** `effect` is in `apps/server` only today (^4.0.0). Use **`effect` ^4.0.2** (the 4.0.2 upgrade typechecks on the server: plan §3.3). Schema facts are in plan §2.5, with the `effect/dist/Schema.d.ts` line refs. Mobile Hermes: core Effect and Schema are safe (plan §2.7).

### What to build
1. **Add `effect` ^4.0.2** to `packages/protocol`, and to every package whose code now calls Schema directly: `apps/web`, `apps/mobile`, `packages/xmpp-core`. Bump `apps/server` to ^4.0.2. Remove `zod` from `packages/protocol`. Run `pnpm install` to update `pnpm-lock.yaml`.
2. **Rewrite every protocol module with Effect Schema,** following the plan §2.5 table.
   - **Keep the exported names** (`StickerSchema`, `ApprovalRequestSchema`, …) as Effect Schemas.
   - **Keep the exported TypeScript types identical in shape.** Use `typeof X.Type` for the decoded type and `typeof X.Encoded` where an input type was used.
   - **Keep every helper function's signature and behaviour:** `typePayload`, `decodePayload`, `encodePayload` and friends. Each returns what it returns today, and invalid input still fails the same way (null, throw or `success: false`, whatever it does today).
   - **Strict objects** (zod `strict`) reject excess keys with `onExcessProperty: "error"`.
3. **Add two tiny helpers in `packages/protocol/src/common.ts`** and export them: `isValid(schema)(u): boolean` (wraps `Schema.is`) and `decodeOrThrow(schema)(u)` (wraps `Schema.decodeUnknownSync`). Consumers use these, or `Schema.is` / `Schema.decodeUnknownSync` directly. Pick one style and use it everywhere.
4. **Move every consumer call site listed above.** `X.safeParse(v).success` → `Schema.is(X)(v)`. `X.safeParse(v)` used for its `data` → a decode that yields the same value or undefined. `X.parse(v)` → `Schema.decodeUnknownSync(X)(v)`.
   - The **server's zod objects that embed `JidSchema`** (`admin-client.ts`, `xmpp/config.ts`) get a zod-side check that uses the shared pattern instead: export a `JID_PATTERN` (or `isJid`) from protocol and use `z.string().refine(isJid, …)` there. That keeps the error messages, and the server's own zod disappears later in its own tasks.
5. **Tests:** every protocol test keeps asserting the **same accepted and rejected inputs**; rewrite only the parse calls. Consumer test files change only their `.parse` / `.safeParse` calls. **No assertion about behaviour may change.**

### Read first
`AGENTS.md`, `docs/audit/effect-everywhere-plan.md` §2.5 and §5, `docs/EFFECT_GUIDE.md`, `docs/effect-reference/LLMS.md` (the Schema sections), `packages/protocol/src/` (all files), then each consumer site listed above.

### Allowed files
- `packages/protocol/package.json`, `packages/protocol/src/*.ts`;
- `apps/server/package.json`, `apps/web/package.json`, `apps/mobile/package.json`, `packages/xmpp-core/package.json`, `pnpm-lock.yaml`;
- `apps/server/src/xmpp/admin-client.ts`, `apps/server/src/xmpp/config.ts`, `apps/server/src/xmpp/token.ts`, `apps/server/src/actions/announce.ts`, `apps/server/src/actions/announce.test.ts`;
- `apps/web/src/store/realStore.ts`, `apps/web/src/store/store.ts`, `apps/web/src/mock/mock.test.ts`, `apps/web/src/components/ProgressCard.test.tsx`, `apps/web/src/components/ApprovalCard.test.tsx`, `apps/web/src/lib/useApprovalPolling.test.ts`;
- `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/chat-store.ts`, `apps/mobile/src/components/chat/payload-card.tsx`, `apps/mobile/src/components/chat/composer.tsx`, `apps/mobile/src/mock/messages.ts`, `apps/mobile/src/mock/stickers.test.ts`, `apps/mobile/src/mock/voice.test.ts`, `apps/mobile/src/mock/attachments.test.ts`;
- `packages/xmpp-core/src/stanza.ts`;
- `work/T-0494-protocol-effect-schema.md`.

If any other file needs a change (another consumer found by typecheck), stop and report BLOCKED with the file list.

### Checks
```bash
pnpm --filter @zilar/protocol test --reporter=dot
pnpm --filter @zilar/xmpp-core test --maxWorkers=2 --reporter=dot
pnpm gate
```

### Acceptance
- `@zilar/protocol` has no zod and exports Effect Schemas with the same names, types and helper behaviour.
- Every consumer compiles and passes with only its parse calls changed.
- `pnpm gate` ends with GATE PASS (all packages) and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

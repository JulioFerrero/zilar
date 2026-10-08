---
id: T-0596
title: "Effect Schema: drop the dead zod request schemas left in pins/roles/topics services (their api.ts already decode with Effect Schema) and turn the topic/pin enums into Schema.Literals; exported TS types keep their names and shapes; no behaviour change; tests unchanged"
status: merged
milestone: M5
branch: task/T-0596-dead-zod-service-schemas
model: auto
effort: low
depends_on: [T-0571]
estimate: 0.5 day
---

# T-0596: the dead zod schemas in the pins, roles and topics services

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect Schema replaces zod. Plan §5.2 and §5.3 (`docs/audit/tool-args-schema-plan.md`) list these files.

Their `api.ts` files already decode request bodies with Effect Schema; the comments say "Replaces `createRoleBodySchema` (zod)", and so on. The zod schemas left in the services are **never parsed** (grep finds no `safeParse` or `.parse(` in these files); they only give TS types.

### Verified facts (do not re-derive)
- **`apps/server/src/pins/service.ts`:**
  - `pinKindSchema` (24, a zod enum) gives `type PinKind` (25);
  - `createPinBodySchema` (62-85) gives `type CreatePinBody` (87);
  - `CreatePinBody` is used inside `service.ts`. `pins/api.ts` has its **own** `CreatePinBody` const (75), so check that the name clash stays harmless.
- **`apps/server/src/roles/service.ts`:**
  - zod import at line 3;
  - `roleNameSchema`, `createRoleBodySchema` (44), `renameRoleBodySchema` (46) and `setRoleMembersBodySchema` (48-50);
  - `roles/api.ts` names them only in comments (57, 67, 72).
- **`apps/server/src/topics/service.ts`:**
  - zod import at line 3;
  - the schemas at 105-146 (`ownerSchema`, `nameSchema`, `glyphSchema`, `linkUrlSchema`, `linkLabelSchema`, `createTopicBodySchema`, `patchTopicBodySchema`, plus the types `CreateTopicBody` and `PatchTopicBody`);
  - `addTopicAiBodySchema` with `AddTopicAiBody` (754-756), and `setTopicRolesBodySchema` with `SetTopicRolesBody` (765-772);
  - `topics/api.ts` names them only in comments.
- **`apps/server/src/topics/access.ts:17-24`:** the zod enums `topicVisibilitySchema`, `topicKindSchema` and `topicStatusSchema`, plus their types. `topics/service.ts` uses these too; check how, with grep.
- **`apps/web/src/lib/api.ts`** has its **own** Effect `topicKindSchema` and so on (370); it does not import the server's. Leave the web untouched.
- **Out of scope:** `avatarOwnerKindSchema` (`db/schema.ts:898`, which drives drizzle) and `drafts/events.ts`.

### What to build
1. **Delete every zod schema that nothing parses.** Keep each exported TS type with the **same name and the same shape**, either as a plain TS type or interface or from an Effect schema; for each one, say in the Report which you chose. The callers of these types in services, api files and tests must compile unchanged.
2. **The three topic enums and `pinKindSchema`** become `Schema.Literals([...])` with the same members, and their types become `typeof X.Type`. If any of them is parsed at runtime somewhere, say where and keep it working with Effect.
3. **When done:** `pins/service.ts`, `roles/service.ts`, `topics/service.ts` and `topics/access.ts` have no `zod` import.
4. **Tests:** every listed test passes **unchanged**:
   - `apps/server/src/pins/*.test.ts`;
   - `apps/server/src/roles/*.test.ts`;
   - `apps/server/src/topics/*.test.ts`;
   - the authz sweep (`authz-sweep`).

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` ("Effect 4 facts"), the four files above, and `apps/server/src/roles/api.ts` (lines 55-80) as the example of the Effect side.

### Allowed files
`apps/server/src/pins/service.ts`, `apps/server/src/roles/service.ts`, `apps/server/src/topics/service.ts`, `apps/server/src/topics/access.ts`, `work/T-0596-dead-zod-service-schemas.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot pins roles topics authz-sweep
pnpm gate
```

### Acceptance
- There is no zod in the four files, every exported type keeps its name and shape, and behaviour is unchanged.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What changed.** Removed the dead zod request schemas from the four files and kept every exported
type's name and shape. Nothing parsed these schemas (`grep` finds no `safeParse`/`.parse(`), so no
runtime validation moved — the Effect HTTP layers in the `api.ts` files still decode the bodies.

- `apps/server/src/pins/service.ts`: `pinKindSchema` is now
  `Schema.Literals(['text', 'image', 'file', 'voice', 'card'])` and `type PinKind = typeof
  pinKindSchema.Type`. Deleted `createPinBodySchema` plus the `hasControlCharacters` helper and
  control-char constants that only it used. `CreatePinBody` is now a plain `interface` with the same
  inferred shape (`chat`, `messageId`, `senderName` required; `text?`, `kind?`). Dropped the `zod`
  import; added `Schema` to the `effect` import.
- `apps/server/src/roles/service.ts`: deleted `roleNameSchema`, `createRoleBodySchema`,
  `renameRoleBodySchema`, `setRoleMembersBodySchema` and the `hasControlCharacters` helper only they
  used. These had no exported TS types to preserve and nothing referenced them. Dropped the `zod`
  import.
- `apps/server/src/topics/service.ts`: deleted `nameSchema`, `glyphSchema`, `linkUrlSchema`,
  `linkLabelSchema`, `ownerSchema`, `createTopicBodySchema`, `patchTopicBodySchema`,
  `addTopicAiBodySchema`, `setTopicRolesBodySchema` and the helper only they used. Kept the exported
  types `CreateTopicBody`, `PatchTopicBody`, `AddTopicAiBody`, `SetTopicRolesBody` as plain
  interfaces with the same shape (the `owner` shape is inlined). The `./access` import now takes
  `type TopicKind/TopicStatus/TopicVisibility` instead of the schema values. Dropped the `zod`
  import.
- `apps/server/src/topics/access.ts`: the three enums are now `Schema.Literals([...])` with the same
  members and their types are `typeof X.Type`. Dropped the `zod` import; added `Schema` from
  `effect`.

**Type choice.** The four enums (`pinKindSchema`, `topicVisibilitySchema`, `topicKindSchema`,
`topicStatusSchema`) keep an Effect schema (spec item 2); every body type is a plain TS interface,
since there is no parse to drive from a schema. Optional fields carry explicit `| undefined` to match
zod's inferred type under `exactOptionalPropertyTypes`.

**Runtime parsing.** None of these schemas was parsed anywhere; the enum schemas were also only used
to derive types. No server code outside these files imports them — the `api.ts` files declare their
own local Effect schemas and only mention the old names in comments.

**Files changed.** `apps/server/src/pins/service.ts`, `apps/server/src/roles/service.ts`,
`apps/server/src/topics/service.ts`, `apps/server/src/topics/access.ts`, and this task file. All
inside the Allowed files.

**Commands.**
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot pins roles topics authz-sweep`:
  5 test files passed, 70 tests passed.
- `pnpm gate` (run 1): FAIL on `format` (`apps/server/src/topics/access.ts`). After wrapping the
  `topicStatusSchema` literal the way Prettier wants, `pnpm gate` (run 2): `PASS install (frozen)`,
  `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/server`, `scope: every changed
  file is inside the Allowed files`, `GATE PASS`.

**Deviations.** None.

**Open questions.** None.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean. The packet (13:46) is newer than HEAD 864a2cd8.
- **No test file changed.**
- **Lead check:**
  - none of the four files imports zod;
  - about 200 lines of dead request schemas are removed;
  - the topic and pin enums are now `Schema.Literals`, and the exported types keep their names.

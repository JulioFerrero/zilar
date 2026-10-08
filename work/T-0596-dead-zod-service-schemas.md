---
id: T-0596
title: "Effect Schema: drop the dead zod request schemas left in pins/roles/topics services (their api.ts already decode with Effect Schema) and turn the topic/pin enums into Schema.Literals; exported TS types keep their names and shapes; no behaviour change; tests unchanged"
status: todo
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

## Review (written by Claude)

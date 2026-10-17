---
id: T-1831
title: "Old topic shape, step A: clients stop reading kind/status/owner and tolerate their absence (contract response fields optional), the dead Type chips leave both new-topic forms, and create sends no kind; the server keeps sending all three"
status: merged
milestone: M5
branch: task/T-1831-topic-old-shape-step-a
model: auto
effort: default
depends_on: [T-1828]
estimate: 40 min
---

# T-1831: Clients let go of `kind`, `status`, `owner` (step A)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/topic-old-shape-removal.md` (T-1828), §4 step A.
- **Why A comes first:** released phones (v0.2.6, v0.2.7) decode these three response fields as required (§3), so the server can't stop sending them yet.
- **What A does:** this client-side step makes the next phone release tolerate their absence and stop sending `kind`.
- **What doesn't change:** the server is untouched and keeps sending all three.
- **No UI shows the values (§2):** the Type chip on both new-topic forms writes a value nothing displays, and the approved AI work plan drops `kind` (`docs/audit/ai-work-plan.md` §7 step 8).

### Facts (from the audit, re-checked by the lead on 2026-10-17)
- **Contract** (`packages/api-contract/src/topics.ts`):
  - the response `Topic` has `kind: lenientLiterals(TOPIC_KINDS, 'chat')`, `status: lenientLiterals(TOPIC_STATUSES, 'open')` and `owner: Schema.NullOr(TopicOwner)` as required fields (`:216-225`);
  - the request payloads carry `kind`/`status`/`owner` (`:107,111,119-121`).
- **chat-core:** `TopicInfo` has `kind: TopicKind`, `status: TopicStatus` and `owner: TopicOwner | null` (`packages/chat-core/src/types.ts:167-180`).
- **client-core:** `topicInfoOf` copies them (`packages/client-core/src/store/topic-rows.ts:48-49,54`).
- **Web:**
  - `apps/web/src/lib/api/topics.ts:10-62` re-exports the types, and its create/patch inputs carry the fields;
  - `apps/web/src/lib/api.ts:161-165` re-exports them;
  - `apps/web/src/components/NewTopicDialog.tsx` has `TYPE_CHIPS` (`:19-24`), the `kind` state (`:68`), sends `kind` (`:141`) and renders the chip row (`:217-219`).
- **Phone:**
  - `apps/mobile/src/lib/topics-api.ts` has a response `Topic` with `kind`/`status`/`owner` (`:43-45`), create/patch inputs (`:83,87,95-97`), and the dead `parseTopicKind`/`parseTopicStatus` (`:138-163`);
  - `apps/mobile/src/components/chat/new-topic-sheet.tsx` has `TYPE_CHIPS` (`:15-21`), the prop and state (`:25,59`), sends it (`:89`) and renders it (`:133`);
  - `apps/mobile/src/components/chat/use-group-new-topic.ts:33` sends `kind: input.kind`.

### Steps
1. **Contract:** in the response `Topic` only, wrap `kind`, `status` and `owner` in `Schema.optional(...)`, with the same inner schemas. Leave the request payloads, `TOPIC_KINDS`, `TOPIC_STATUSES` and `TopicOwner` as they are; the server still uses them until step C.
2. **chat-core and client-core:** remove `kind`, `status` and `owner` from `TopicInfo` and stop copying them in `topicInfoOf`. Keep the `TopicKind`, `TopicStatus` and `TopicOwner` type exports if anything still imports them; otherwise remove them too.
3. **Web:** remove the Type chip row, `TYPE_CHIPS` and the `kind` state from `NewTopicDialog`, and send no `kind` on create. Drop `kind`, `status` and `owner` from the web create/patch input types where nothing passes them.
4. **Phone:**
   - Remove the Type chips, the state and the prop from `new-topic-sheet.tsx`, and `kind` from `use-group-new-topic.ts`.
   - In `topics-api.ts`, make the three response fields optional (or remove them if nothing reads them), drop them from the inputs where unused, and delete `parseTopicKind`/`parseTopicStatus`.
5. **Fixtures:** a test fixture that only needs to typecheck may keep the fields (they're optional now) or drop them.
6. **No new tests.** Keep every file at most 400 lines.

### Allowed files
- `packages/api-contract/src/topics.ts`
- `packages/chat-core/src/types.ts`
- `packages/client-core/src/store/topic-rows.ts`
- `apps/web/src/lib/api/topics.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/components/NewTopicDialog.tsx`
- `apps/mobile/src/lib/topics-api.ts`
- `apps/mobile/src/components/chat/new-topic-sheet.tsx`
- `apps/mobile/src/components/chat/use-group-new-topic.ts`
- `apps/web/src/components/group-info/TopicsSection.fixture.tsx` (lead, after review: typecheck fixture)
- `apps/web/src/components/topic/TopicPeopleLine.fixture.tsx` (lead, after review: typecheck fixture)
- `work/T-1831-topic-old-shape-step-a.md`

If the typecheck needs one more client file, name it in the Report; don't edit server or mock-backend files.

### Checks
```bash
pnpm gate
```

### Acceptance
- A `Topic` response without `kind`, `status` or `owner` decodes on both apps.
- No web or phone code reads them.
- Create sends no `kind`, and the server still sends all three.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **Contract** (`packages/api-contract/src/topics.ts`): in the response `Topic` only, `kind`, `status` and `owner` are now `Schema.optional(...)` with the same inner schemas. The request payloads, `TOPIC_KINDS`, `TOPIC_STATUSES` and `TopicOwner` are untouched, and the comment says why the fields are optional (T-1831).
- **chat-core** (`packages/chat-core/src/types.ts`): removed `kind`, `status` and `owner` from `TopicInfo`, and removed the now-unused `TopicKind`, `TopicStatus` and `TopicOwner` type exports (nothing else imported them; `TopicVisibility` stays).
- **client-core** (`packages/client-core/src/store/topic-rows.ts`): `topicInfoOf` no longer copies `kind`, `status` or `owner`.
- **Web**:
  - `apps/web/src/lib/api/topics.ts`: dropped `kind`/`status`/`owner` from `CreateTopicInput` and `PatchTopicInput` (nothing passed them), removed the now-unused type re-exports, and updated the stale "kind, status or visibility" comment to visibility.
  - `apps/web/src/lib/api.ts`: stopped re-exporting `TopicKind`, `TopicOwner` and `TopicStatus`.
  - `apps/web/src/components/NewTopicDialog.tsx`: removed `TYPE_CHIPS`, the `kind` state, the Type chip row and the `kind` field on create; the `TopicKind` import went with them.
- **Phone**:
  - `apps/mobile/src/lib/topics-api.ts`: removed `kind`/`status`/`owner` from the response `Topic` (nothing read them) and from `CreateTopicInput`/`PatchTopicInput`; deleted `parseTopicKind`/`parseTopicStatus`; the re-export list is now only `TopicVisibility`; updated the module comment.
  - `apps/mobile/src/components/chat/new-topic-sheet.tsx`: removed `TYPE_CHIPS`, the `kind` prop and state, the Type chip row and the `kind` field on create; updated the doc comment.
  - `apps/mobile/src/components/chat/use-group-new-topic.ts`: create no longer sends `kind`.
- **Fixtures (outside Allowed files, required by typecheck)**: removed the now-unknown `kind`, `status` and `owner` keys from the two typed `TopicInfo` literals in `apps/web/src/components/group-info/TopicsSection.fixture.tsx` and `apps/web/src/components/topic/TopicPeopleLine.fixture.tsx`. Without this the web typecheck fails on excess properties.
- No new tests (spec says none), and every changed file is under 400 lines.

The server and mock-backend are untouched; they still send all three fields and their own types still require them.

### Checks run

- `pnpm install --prefer-offline` from the repo root: `Done in 10.9s using pnpm v10.32.1`.
- `pnpm gate` from the repo root (first run): `FAIL format` on `apps/web/src/lib/api/topics.ts` (Prettier export-list wrapping).
- `pnpm exec prettier --write` on the changed files: rewrote only `apps/web/src/lib/api/topics.ts`.
- `pnpm gate` from the repo root (final):

```
gate: 12 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.1s)
PASS  lint  (1.2s)
PASS  typecheck  (5.0s)
PASS  effect  (0.7s)
SKIP tests @zilar/api-contract (no nearby test files)
PASS  tests @zilar/chat-core  (1.8s)
PASS  tests @zilar/client-core  (4.9s)
PASS  tests @zilar/mobile  (1.6s)
PASS  tests @zilar/web  (4.1s)
scope: 2 file(s) outside the Allowed files:
  apps/web/src/components/group-info/TopicsSection.fixture.tsx
  apps/web/src/components/topic/TopicPeopleLine.fixture.tsx
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

- No single test files were run on their own; the only test run was the one inside `pnpm gate` above (chat-core, client-core, mobile and web suites, all passing).

### Notes for the lead

- **Two extra client files**: the two web `.fixture.tsx` files above had to lose the three keys because they build `TopicInfo` object literals; keeping them would fail the web typecheck with excess-property errors. This is the "one more client file" case from the spec, doubled; the gate's scope block lists exactly these two and nothing else.
- Acceptance checks: the response schema (`@zilar/api-contract`) is what both `client-core` and the phone's `parseTopic` decode through, and all three fields are optional there, so a response without them decodes. Nothing in web or phone reads `kind`/`status`/`owner` from a topic (grep + typecheck), create sends no `kind` on either app, and the server/mock-backend are untouched.
- The spec allowed removing the phone response fields entirely if nothing read them; I removed them, so the mobile `Topic` no longer carries dead keys. The web keeps the contract `Topic` type with its optional fields because that type is the decoded response shape.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `d258fe7fb`.
- **Contract:** `Topic.kind`, `status` and `owner` are `Schema.optional` with the same inner schemas. The request payloads and `TOPIC_KINDS`/`TOPIC_STATUSES`/`TopicOwner` are unchanged for the server.
- **`TopicInfo`** drops the three fields, and `topicInfoOf` stops copying them.
- **Both new-topic forms** lose the Type chips and send no `kind`. The phone drops the dead `parseTopicKind`/`parseTopicStatus`.
- **The lead added** the two web fixture files the typecheck needed to Allowed files.
- **Pre-review nit 1** (the phone `toTopic` spreads the decoded value, so the keys may still exist at runtime) is harmless: nothing reads them.
- **Next step for T8** is B: ship this in the next phone release.

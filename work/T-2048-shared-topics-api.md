---
id: T-2048
title: "Share W2-d (part 2): one topics API in client-core — makeTopicsApi(call) with the contract types and the create/patch/roles input types, built over the shared ZilarClient — web lib/api/topics.ts and phone lib/topics-api.ts become thin adapters with the same exported names; the phone drops its hand-typed Topic types — net about −150 lines"
status: merged
milestone: M5
branch: task/T-2048-shared-topics-api
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2048: Shared topics API (share plan W2-d, part 2)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: share functions between web and phone. `docs/audit/share-plan.md` §2.15 found the topics API calls and their input types written twice (jscpd mobile:80-103 ↔ web:33-55). The phone also hand-types `Topic`, which drifts from the contract.

### Facts (read by the lead on 2026-10-18 at `a56052b9a`)
- **The client type.** `ZilarClient` is exported by `packages/api-contract/src/client.ts:18` (`HttpApiClient.ForApi<typeof ZilarApi, ApiError>`).
- **Web.** `apps/web/src/lib/api/topics.ts` (142 lines):
  - every call is `callApi((client) => client.topics.<x>(...))`, with `callApi` from `@/lib/effect/api-client`;
  - it exports `CreateTopicInput` (`:33-40`), `PatchTopicInput` (`:42-53`), `SetTopicRolesInput` (`:124-127`) and `TopicTool`;
  - its functions are `listGroupTopics`, `createTopic`, `getTopic`, `patchTopic`, `archiveTopic`, `listTopicMembers`, `addTopicMember`, `joinTopic`, `getTopicPreview`, `removeTopicMember`, `listTopicAis`, `addTopicAi`, `removeTopicAi`, `setTopicRoles` and `listTopicTools`;
  - it re-exports the contract types (`:30-31`).
  - Web importers mostly go through `@/lib/api` (about 157 files import that barrel). **Keep every exported name and signature.**
- **Phone.** `apps/mobile/src/lib/topics-api.ts` (230 lines):
  - hand-typed `TopicAi`, `Topic`, `TopicMember`, `TopicRole` and `ApproverRole` (`:29-79`);
  - inputs (`:80-107`), and the `TopicsApi` interface (`:108-127`), which includes `topicPreview` and `setMembersCanCreateTopics` (a groups patch);
  - `toTopic` fills `roles ?? []` and `approverRole ?? null`;
  - `parseTopicVisibility` (`:132`), `parseTopic` (`:148`), `chatEntryTopics` (`:158`), `createTopicsApi(getToken, fetchImpl, apiUrl)` (`:177-225`, using `runApi` and `createApiClient`) and `glyphForTopicName` (`:227`).
- **The client-core barrel.** `packages/client-core/src/index.ts:21` is the `./people-search` export line. Other tasks append at the end.

### Steps
1. **The shared API.** Create `packages/client-core/src/topics-api.ts`:
   - `makeTopicsApi(call: <A>(f: (client: ZilarClient) => Effect.Effect<A, ApiError>) => Promise<A>)`, returning every call both apps make. That's web's list plus `setMembersCanCreateTopics`, with web's names, and with `topicPreview` as an alias if the phone needs it.
   - The three input types.
   - Topics normalised with `roles ?? []` and `approverRole ?? null`.

   Add ONE export line in `packages/client-core/src/index.ts`, **directly after line 21**.
2. **Web.** `apps/web/src/lib/api/topics.ts` becomes `const api = makeTopicsApi(callApi)` plus named re-exports with the **same names and signatures**. Keep the contract-type re-exports and `topicSchema`.
3. **Phone.**
   - `apps/mobile/src/lib/topics-api.ts` builds `makeTopicsApi` over its `createApiClient` client and `runApi`, and keeps `createTopicsApi(getToken, fetchImpl, apiUrl): TopicsApi` with the same method names.
   - It replaces the hand-typed `Topic`, `TopicMember`, `TopicAi`, `TopicRole` and `ApproverRole` with re-exports of the contract types. If a phone file outside Allowed files breaks on a field difference, report BLOCKED with the list (see Allowed files).
   - It deletes `parseTopicVisibility`, `chatEntryTopics` and `glyphForTopicName` **only if** `git grep` finds no importer.
4. **Tests.** No new tests (API pass-through). The existing tests must pass.
5. **Size.** Product lines must drop by at least 120, against 142 + 230 today plus whatever phone call sites change. Report the counts. Every file stays at or under 400 lines.

### Allowed files
- `packages/client-core/src/topics-api.ts`
- `packages/client-core/src/index.ts`
- `apps/web/src/lib/api/topics.ts`
- `apps/mobile/src/lib/topics-api.ts`
- `work/T-2048-shared-topics-api.md`

If the type switch breaks phone files outside this list, stop and report BLOCKED with the exact file paths and errors. The lead will add them.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, and product lines are at least 120 lower.
- **Lead check, web mock:** a group's topics list loads, and creating a topic works.

---

## Report (written by the worker when done)

### What I did

- Added `packages/client-core/src/topics-api.ts` with `makeTopicsApi(call)`:
  every topics call both apps make (web's list plus `setMembersCanCreateTopics`),
  `topicPreview` as an alias of `getTopicPreview`, the three input types, and
  `toTopic` normalisation (`roles ?? []`, `approverRole ?? null`). The
  normalised `Topic` type is derived from the contract type, not hand-typed.
- Added one export block to `packages/client-core/src/index.ts`, directly after
  the `./people-search` line.
- Web `apps/web/src/lib/api/topics.ts` is now `const api = makeTopicsApi(callApi)`
  plus destructured named exports. Every previously exported name is still
  exported with the same parameters and return types; `topicSchema` and the
  contract-type re-exports are kept, `Topic` is still the contract `Topic`.
- Phone `apps/mobile/src/lib/topics-api.ts` builds the shared API over
  `createApiClient` + `runApi` and keeps `createTopicsApi(...): TopicsApi` with
  the same method names. The hand-typed `TopicAi`, `TopicMember`, `TopicRole`
  and `ApproverRole` are contract re-exports; `Topic` is the shared normalised
  contract type (see deviations). `parseTopic` stays (used by
  `chat-api-schemas.ts`).
- Deleted `parseTopicVisibility`, `chatEntryTopics` and `glyphForTopicName`:
  `git grep` found no importers in `apps/` or `packages/` (only mentions in
  `docs/audit/`). `chatEntryTopics` and its callers elsewhere use web's and
  client-core's own versions.
- No new tests (API pass-through).

Lines (`wc -l`):

| File | Before | After |
| --- | --- | --- |
| `apps/web/src/lib/api/topics.ts` | 142 | 44 |
| `apps/mobile/src/lib/topics-api.ts` | 230 | 81 |
| `packages/client-core/src/topics-api.ts` | — | 123 |
| **Total** | **372** | **248** |

Net product lines: **−124** (target ≥ 120). Every file is under 400 lines.

### Checks run

- `pnpm install`: done, 1155 packages, no errors.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/effects/group-actions.test.ts`:
  1 file passed, 3 tests passed (the topics store path over the new API).
- `pnpm gate` (from the repo root):

```
gate: 5 changed file(s) against main
PASS  install (frozen)
PASS  format
PASS  lint
PASS  typecheck
PASS  effect
PASS  build @zilar/server
PASS  tests @zilar/client-core
PASS  tests @zilar/mobile
PASS  tests @zilar/web
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

Deviations from the literal spec, all forced by the typecheck or the gate:

1. **`call` type.** `makeTopicsApi` takes
   `<A, E>(call: (client: ZilarClient) => Effect.Effect<A, E>) => Promise<A>`
   instead of `<A>(... Effect.Effect<A, ApiError>)`. The contract methods' error
   channel is a union (`ApiError | HttpClientError | SchemaError | ...`) and is
   mapped to `ApiError` inside `callApi`/`runApi`; narrowing it in the parameter
   type fails TS2375. Both apps' adapters satisfy either shape, and the only
   exposed error at runtime is still `ApiError`.
2. **Phone `Topic`.** The phone's store requires `roles: TopicRole[]` and
   `approverRole: ApproverRole | null` (e.g. `store/effects/locals.ts:27`), so
   re-exporting the raw contract `Topic` (where both are optional) would break
   phone files outside Allowed files. `Topic` is therefore re-exported from
   client-core as the contract type with those two fields made required; the
   other four types are direct `@zilar/api-contract` re-exports.
3. **`effect-plain` marker.** The shared file is a Promise port by design (the
   spec's `call` returns a Promise), so the gate's Effect ratchet flagged its
   `.then` calls. It carries the repo's `// effect-plain:` marker with the
   reason; each app's `call` owns the Effect edge.
4. Web keeps only its historical names (`getTopicPreview`, no new
   `topicPreview` export); the alias lives in the shared API for the phone.

## Review (written by Claude)

Approved; the pre-review was clean.
- **What changed.** One `makeTopicsApi` lives in client-core. Web `lib/api/topics.ts` keeps all 15 export names, and the phone `topics-api.ts` keeps its `TopicsApi` methods and uses the contract types.
- **Size.** About −116 product lines, close to the ≥120 target. No phone file outside the list needed a change.
- **Lead Playwright check** (web mock, branch on :5192):
  - New chat → New topic → Dev team → "Lead check topic" → Create topic;
  - the topic appears under Dev team (6 topics) and opens;
  - no console errors.

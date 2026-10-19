# Server HTTP layer: boilerplate audit

Measured on `task/T-2227-server-http-audit`, 2026-10-19. Every file in the set was
opened and read before it was counted. Line counts are `wc -l` values and every range is
inclusive, so a range includes its blank lines and closing brackets. The "cut" columns
count only lines that disappear, never lines that move to another file.

## Inventory and scope

The spec's command:

```bash
git ls-files 'apps/server/src/*' | grep -E '(/api\.ts|routes.*\.ts|-api[^/]*\.ts)$' | grep -v test
```

returns **38 files, 10,693 lines** on this branch:

- **34 HTTP modules**: each builds an `HttpApi` and returns an `EffectApiMount`.
- **4 support modules** included by the pattern but holding no `HttpApi` code:
  `search/routes.ts` (search core), `integrations/routes.ts` (settings helpers),
  `voice-transcription/routes.ts` (URL settings helpers), `gifs/routes.ts` (media fetch).

`app/routes-messaging.ts` defines six APIs in one file, so the 34 modules produce
**38 mounts** (`apps/server/src/app.ts:213-217`: 23 in `messagingRoutes`, 10 in
`aiRoutes`, 5 in `mediaRoutes`).

The task header quotes 45 files / 12.4k lines. The command above does not: adding the
four modules the route files delegate their handler bodies to —
`stickers/api-handlers.ts` (534), `push/api-handlers.ts` (489),
`chats/reply-handler.ts` (176), `stickers/api-decode.ts` (118) — reaches 42 files and
12,010 lines. Those four are outside the audit set; where they matter they are called
out separately and never counted in the tables.

Not counted as boilerplate: the `handler()` calls and the route bodies themselves. The
question here is the scaffolding around them.

## Summary

| # | Pattern | Lines measured | Conservative cut | Where it goes |
| --- | --- | ---: | ---: | --- |
| 1 | Per-module setup (imports, deps type, `HttpApi.make`, group wrapper, mount) | 1,756 | 45 | 905 of the lines are import blocks and cannot go; the cut is the mount helper |
| 2 | Payload copying and defaults before a service call | 167 | 95 | six files |
| 3 | Repeated access checks and repeated preflight | 192 | 50 | chats, integrations, media/files/card-media, tools, groups |
| 4 | Error mapping that `handler()` already renders | 45 | 25 | chats, chat-prefs, audit, handles, chat-folders |
| 5 | Response shaping field by field | 224 | 105 | tools, routines, media, audit, contact-requests |
| 6 | The 38 mounts (overlaps pattern 1) | 749 | 300 | one shared `HttpApi`, high risk |
| 7 | `Effect.gen` wrappers around a single promise (**extra**, not in the six) | 98 | 90 | 49 handler bodies |
| — | Repeated 501/429/strict-decode preflight | 25 | 15 | gifs, media, files |
| | **Total** | **3,256** | **725** | |

The lead's guess was −2k to −3k. This set does not support it: about **−700 lines** are
really removable, and roughly −300 of those need the risky shared-`HttpApi` change.
The rest of the 12.4k is route bodies, security ordering, and imports.

## 1. Per-module setup

Setup counted per file: the contiguous import block (first to last `import`), the
`XApiDependencies` interface/type(s), every `HttpApi.make(...)` (one line each),
locally defined `HttpApiGroup.make(...)` blocks, the three-line
`HttpApiBuilder.group(...) / handlers / );` wrapper, and the `mountGroups`/`mountApi`
call. Handler chains are not included.

| File | Imports | Deps type | `HttpApi`/group | Wrapper | Mount | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `app/routes-messaging.ts` | 64 | 34 | 6 + 4 | 18 | 52 | 178 |
| `contact-requests/api.ts` | 45 | 11 | 1 | 3 | 15 | 75 |
| `chats/api.ts` | 43 | 22 | 1 | 3 | 5 | 74 |
| `groups/api.ts` | 38 | 11 | 1 | 3 | 14 | 67 |
| `topics/api.ts` | 37 | 12 | 1 | 3 | 14 | 67 |
| `machines/api.ts` | 45 | 8 | 1 | 3 | 10 | 67 |
| `ais/api.ts` | 36 | 15 | 1 | 3 | 6 | 61 |
| `auth/api.ts` | 37 | 8 | 1 | 6 | 9 | 61 |
| `voice-transcription/api.ts` | 45 | 0 | 1 | 3 | 12 | 61 |
| `tools/routes.ts` | 38 | 8 | 1 | 3 | 5 | 55 |
| `avatars/api.ts` | 21 | 7 | 1 + 17 | 3 | 4 | 53 |
| `agents/memory/api.ts` | 25 | 8 | 1 | 3 | 16 | 53 |
| `approvals/api.ts` | 29 | 9 | 1 | 3 | 9 | 51 |
| `media/api.ts` | 25 | 12 | 1 | 6 | 5 | 49 |
| `connections/api.ts` | 22 | 16 | 1 | 3 | 4 | 46 |
| `stickers/api.ts` | 12 | 16 | 1 | 0 | 13 | 42 |
| `integrations/api.ts` | 29 | 0 | 1 | 3 | 9 | 42 |
| `invite-links/api.ts` | 17 | 10 | 1 | 3 | 11 | 42 |
| `push/api.ts` | 12 | 21 | 1 | 0 | 5 | 39 |
| `files/api.ts` | 19 | 9 | 1 + 4 | 3 | 4 | 40 |
| `card-media/api.ts` | 17 | 7 | 1 + 8 | 3 | 4 | 40 |
| `handles/api.ts` | 21 | 6 | 1 | 3 | 7 | 38 |
| `chat-prefs/api.ts` | 23 | 6 | 1 | 3 | 5 | 38 |
| `audit/api.ts` | 23 | 1 | 1 | 3 | 6 | 34 |
| `message-blocks/api.ts` | 11 | 7 | 1 | 3 | 12 | 34 |
| `backgrounds/api.ts` | 12 | 6 | 1 | 3 | 11 | 33 |
| `routines/api.ts` | 18 | 6 | 1 | 3 | 5 | 33 |
| `chat-folders/api.ts` | 16 | 6 | 1 | 3 | 5 | 31 |
| `xmpp/api.ts` | 14 | 7 | 1 | 3 | 5 | 30 |
| `voice/api.ts` | 12 | 5 | 1 + 4 | 3 | 4 | 29 |
| `agents/log/api.ts` | 13 | 5 | 1 | 3 | 6 | 28 |
| `search/api.ts` | 15 | 0 | 1 | 3 | 6 | 25 |
| `setup/api.ts` | 38 | 14 | 1 + 10 | 3 | 3 | 69 |
| `gifs/api.ts` | 33 | 0 | 1 | 3 | 34 | 71 |
| **Total (34 modules)** | **905** | **313** | **86** | **117** | **335** | **1,756** |

Example: `apps/server/src/contact-requests/api.ts:1-53` (imports), `:121-131`
(dependencies), `:119` (`HttpApi.make`), `:162` (group), `:223-237` (mount).

**Cut: 45.** Imports (905) and dependency types (313) are structure, not waste. The
only clean win here is that six modules hand-roll what `mountGroups` now does:
`pins` (`routes-messaging.ts:355-371`), `gifs` (`gifs/api.ts:351-384`), `approvals`
(`approvals/api.ts:563-571`), `setup` (`setup/api.ts:364-366`), memory
(`agents/memory/api.ts:176-191`) and agent log (`agents/log/api.ts:159-164`). Most are
a few lines each; gifs needs a `mountGroups` router-config option to keep
`maxParamLength` (`gifs/api.ts:361`). Moving the five that fit saves ~45 lines.
The bigger consolidation is pattern 6.

## 2. Payload copying

Handlers that rebuild a decoded payload field by field, mostly to apply `?? false`,
`[...(x ?? [])]`, or to drop `undefined` keys for `exactOptionalPropertyTypes`.

| File | Lines | Example | Cut |
| --- | ---: | --- | ---: |
| `topics/api.ts` | 34 | `:226-239` (create), `:260-279` (patch) | 30 |
| `chat-folders/api.ts` | 31 | `:63-72` (create), `:99-119` (update) | 28 |
| `groups/api.ts` | 29 | `:102-116` (create), `:268-281` (patch) | 25 |
| `ais/api.ts` | 25 | `:313-321` (create), `:330-345` (patch) | 22 |
| `tools/routes.ts` | 26 | `:223-235`, `:309-321` (decoded body remapped) | 6 |
| `invite-links/api.ts` | 9 | `:79-87` | 8 |
| `search/api.ts` | 6 | `:64-69` | 6 |
| `voice-transcription/api.ts` | 5 | `:232-236` | 4 |
| `gifs/api.ts` | 2 | `:242`, `:278` | 2 |
| **Total** | **167** | | **131 gross → 95 net** |

**Row totals are gross.** The Cut cells sum to 131; the table applies a 36-line
conservatism discount for defaults and conditional spreads that stay in the service for
`exactOptionalPropertyTypes`, so the conservative cut used in the summary and the ranked
list is **95**.

The good shape already exists: `pins` passes the payload through
(`apps/server/src/app/routes-messaging.ts:345`,
`pinMessage(serviceDeps(), { ...request.payload, actorId: user.id })`). Every service
input that adds only `actorId`/`domain`/`now` can take `{ ...request.payload, ... }`.
The tools routes are the exception: they rename `version`/`message` and validate, so
only ~6 lines go.

## 3. Repeated access checks and preflight

| File | Lines | Repeated sequence | Cut |
| --- | ---: | --- | ---: |
| `integrations/api.ts` | 72 | two middleware layers each run `isInstanceOwner` (`:61`, `:92`), then four handlers run `requireOwner` again (`:156`, `:170`, `:194`, `:206`) | 25 |
| `chats/api.ts` | 30 | "access, limiter, manual 429" in `:69-73`, `:107-111`, `:329-331`, `:341-343` | 12 |
| `groups/api.ts` | 10 | `detail` `:122-128` and `members` `:137-145` reload the group; `requireGroup` already exists (`groups/queries.ts`, imported at `:29` and used at `:338`) | 6 |
| `tools/routes.ts` | 9 | `toolAccess` + `!access.manager` 404 at `:218-221`, `:257-262`, `:294-297` | 6 |
| `media/api.ts`, `files/api.ts`, `card-media/api.ts`, `search/routes.ts` | 47 | `allowedArchives` → `resolveChatFilter` → DM block → 404 at `media:180-193`, `files:181-194`, `card-media:70-82`, `search:192-197` | 15 |
| `approvals/api.ts` | 12 | owner/manager loads at `:459-463`, `:489-492`, `:519-529`; helpers exist (`canManageRuleFor`) | 5 |
| `agents/log/api.ts` | 8 | task owner check twice (`:129-132`, `:149-152`) | 3 |
| `routines/api.ts` | 4 | manager check at `:181-184` mirrors `changeStatus` `:197-200` | 2 |
| **Total** | **192** | | **74 gross → 50 net** |

**Row totals are gross.** The Cut cells sum to 74; the table applies a 24-line
conservatism discount for the shared helpers' own definitions and for checks that move
rather than disappear, so the conservative cut used in the summary and the ranked list is
**50**.

Most access rules already live in one place (`chatAccessFromParam`,
`requireChatAccess`, `getOwnedAi`, `requireOwnedMachine`, `toolAccess`,
`routineAccess`, `isGroupManager`). The duplication is the wrapper around them: the
same limiter check and the same 404 text. A small `requireManager(access, "Tool not
found")` and a shared `visibleChatOr404` remove the copies without moving the security
rules.

## 4. Error mapping `handler()` already does

`handler()` (`apps/server/src/effect/http-core.ts:187-209`) catches every defect and
renders an `HttpError` through the same envelope as `httpErrorResponse`
(`http-core.ts:154-167`). Inside a handler, therefore, this:

```ts
return httpErrorResponse(requestIdOf(request.request), new HttpError(429, ...));
```

and this:

```ts
throw new HttpError(429, ...);
```

produce the same response. The first form is used in:

| File | Lines | Example |
| --- | ---: | --- |
| `chats/api.ts` | 10 | `:69-72`, `:107-110`, `:330`, `:342` |
| `chat-folders/api.ts` | 21 | helper `:38-46` and four call sites `:59-62`, `:80-83`, `:95-98`, `:127-130` |
| `audit/api.ts` | 8 | `:66-69`, `:85-88` |
| `handles/api.ts` | 4 | `:81-84` |
| `chat-prefs/api.ts` | 2 | `:78`, `:107` |
| **Total in the 38** | **45** | |

`chats/reply-handler.ts:135,143,152,168` adds four more (8 lines) outside the set.

**Cut: 25.** The manual form costs 3–5 lines each; throwing costs one. The `audit`
case also has a duplicated invalid-scope branch (`:65-70` and `:85-88`) that can be a
single throw.

Separately, **~128 lines** of `catchDefect`/`try-catch` map domain errors to
`HttpError` (`approvals/api.ts:368-382`, `audit/api.ts:27-37`,
`machines/api.ts:133-139`, `tools/routes.ts:495-509`, `gifs/api.ts:210-217`,
`integrations/api.ts:173-184,226-231`, `connections/api.ts:237-246`,
`setup/api.ts:267-270,296-299,319-322`, `files/api.ts:201-238,245-254`). These encode
real behaviour and mostly move into the service rather than disappear, so they are not
in the cut.

## 5. Response shaping

Handlers or wire mappers that rebuild the service row field by field when the row
already matches the contract, usually to turn `Date` into an ISO string or drop
`null`s.

| File | Lines | Example | Cut |
| --- | ---: | --- | ---: |
| `tools/routes.ts` | 39 | `toListWire` `:349-364`, `toVersionListWire` `:406-415`, `toRunListWire` `:425-437` | 33 |
| `routines/api.ts` | 51 | `toListWire` `:19-38`, `toDetailWire` `:40-70` (the same 11 fields again) | 26 |
| `media/api.ts` | 19 | `toMediaItem` `:83-101` (eight `null` → omit lines) | 12 |
| `audit/api.ts` | 21 | `toPublicAuditEntry` `:265-285` | 8 |
| `auth/api.ts` | 45 | `meView` `:52-96` (joined row; only the final object is shaping) | 8 |
| `contact-requests/api.ts` | 10 | `toJson` `:133-142` | 6 |
| `agents/log/api.ts` | 10 | `eventOf` `:55-64` | 6 |
| `machines/api.ts` | 8 | `toMachineView` `:47-54` | 5 |
| `approvals/api.ts` | 12 | `toWireApproval`/`toWireRule` `:57-68` | 5 |
| `search/routes.ts` | 9 | `pushItem` object `:273-281` | 0 |
| **Total** | **224** | | **109 gross → 105 net** |

**Row totals are gross.** The Cut cells sum to 109; the table applies a 4-line
conservatism discount for date and `null` conversions that remain, so the conservative cut
used in the summary and the ranked list is **105**.

Where names already match, the whole mapper is `{ ...row, at: row.at.toISOString() }`.
That is true for `PublicTool`/`PublicToolVersion`/`AiToolRunRow` and `PublicRoutine`.
The strongest duplication is `routines/api.ts:56-69`, which repeats
`toListWire`'s eleven fields instead of spreading it.

## 6. The 38 mounts: one shared `HttpApi`?

Mount machinery overlaps pattern 1, so it is counted once: **335** lines of
`mountGroups`/`mountApi` options, **39** `HttpApi.make` lines, **117** wrapper lines,
plus the wiring in `app.ts:34-171` and `routes-messaging.ts:495-609` (about 205 lines
of `create*Api` calls and `mounts.push`). Total **~749**, of which ~300 would go if all
groups were declared once and the app built one `HttpApi`.

What a single shared `HttpApi` would save:

- the per-module `HttpApi.make(...)` (39 lines);
- the per-module mount call and its options object (~335 lines), replaced by one
  assembly point;
- `reflectRoutes` and the per-module `EffectApiMount` return type;
- the two wiring files' push/list scaffolding (~205 lines), replaced by a layer merge.

What it would risk, and why it is not free:

- **Per-group middleware order differs by design.** `contact-requests/api.ts:223-237`
  charges four budgets after the schema layer; `pins`
  (`routes-messaging.ts:359-363`) charges before the payload decodes; `media` and
  `files` charge per handler because access must run first
  (`media/api.ts:168-170`, `files/api.ts:165-167`). A single assembly must keep each
  group's order.
- **Custom schema-error layers** are declared per group (`contact-requests:226`,
  `handles:111`, `search/api:78`, `approvals:567`), and `auth` merges two groups
  with different middleware (`auth/api.ts:332`).
- **Public, session-less groups** (`setup`, `authInvitesPublic`, machine `pair`) use
  `mountApi`/`withErrorEnvelope` directly (`setup/api.ts:364-366`,
  `machines/api.ts:266-343`). A shared `HttpApi` must not force the session layer on
  them.
- **Router options**: gifs raises `maxParamLength` to 4096 (`gifs/api.ts:361`), which
  the shared layer would have to expose.
- **Test seams**: every `createXApi(deps)` is how tests inject clocks, limiters and
  fakes. A shared assembler either keeps those factories (little saving) or moves the
  seam up and touches many tests.

**Cut: 300 (range 250–350), high risk.** Do it last, if at all.

## 7. Extra: `Effect.gen` around one promise

Not one of the six patterns, but it is the largest idiom-level duplication found.
`handler()` accepts either a promise or an effect
(`apps/server/src/effect/http-core.ts:192-204`), yet **49 handler bodies** wrap a
promise in `Effect.gen`:

```ts
handler(logger, (request, user) =>
  Effect.gen(function* () {
    const topic = yield* Effect.promise(() => requireVisibleTopic(...));
    return yield* Effect.promise(() => toTopicView(...));
  }),
)
```

versus the same thing as `handler(logger, async (request, user) => ...)`. Each
conversion removes the `Effect.gen(function* () {` and `}),` pair, about **2 lines per
handler**; `yield* Effect.promise(...)` becomes `await`. The clearest cases are the
fourteen handlers in `topics/api.ts:205-442` (for example `:245-255`, `:296-306`,
`:307-317`), the single-call tools read handlers (`tools/routes.ts:158-201`),
`avatars/api.ts:93-135`, `agents/log/api.ts:124-156` and `xmpp/api.ts:41-75`.
Keep `Effect.gen` where it sequences an `Effect` combinator
(`topics/api.ts:347-360`, `files/api.ts:201-254`).

**Lines measured: 98. Cut: 90.**

## Repeated preflight (small)

`gifs/api.ts:224-236` and `:260-272` repeat the provider-configured, limiter and
strict-query-decode block; `media/api.ts:165-177` and `files/api.ts:162-174` repeat
"501, limiter, decode". A `searchPreflight`/`mediaPreflight` helper removes ~15 lines
and keeps the security order visible in one place. Low risk.

## Ranked follow-up tasks

1. **Pass decoded payloads through to services** — `topics/api.ts`,
   `groups/api.ts`, `chat-folders/api.ts`, `ais/api.ts`, `invite-links/api.ts`,
   `search/api.ts`. Let each service accept `{ ...payload, actorId, now }` (the `pins`
   shape) and delete the conditional spreads. **Net −95. Low risk.**
2. **Use `async` handler bodies instead of `Effect.gen` around one promise** — the 49
   sites in pattern 7, led by `topics/api.ts`, `tools/routes.ts`, `avatars/api.ts`,
   `agents/log/api.ts`, `xmpp/api.ts`. **Net −90. Low risk** (types unchanged).
3. **Shape responses from the contract types** — `tools/routes.ts`,
   `routines/api.ts`, `media/api.ts`, `audit/api.ts`, `contact-requests/api.ts`,
   `agents/log/api.ts`, `machines/api.ts`, `approvals/api.ts`. Spread the service row
   and convert dates once; delete `toDetailWire`'s copy of `toListWire`.
   **Net −105. Medium risk** (contract field names must match exactly).
4. **Throw `HttpError` inside handlers** — `chats/api.ts`, `chat-folders/api.ts`,
   `audit/api.ts`, `handles/api.ts`, `chat-prefs/api.ts`, plus
   `chats/reply-handler.ts`. Delete the manual `httpErrorResponse(requestIdOf(...))`
   form and let `handler()` render it. **Net −25 (−33 with reply-handler). Low risk.**
5. **Mount the six hand-rolled APIs through `mountGroups`** — `pins`
   (`routes-messaging.ts:355-371`), `gifs/api.ts:351-384` (add a router-config option),
   `approvals/api.ts:563-571`, `agents/memory/api.ts:176-191`,
   `agents/log/api.ts:159-164`. `setup` stays public. **Net −45. Low risk.**
6. **One helper for access + limit + 429** — `chats/api.ts` (four copies),
   `chat-folders/api.ts` (four), `integrations/api.ts` (two layers + four handler
   checks), `groups/api.ts` (two group loads), `tools/routes.ts` (three manager
   checks), `media/files/card-media/search` (four visible-chat blocks).
   **Net −50. Low risk** for chats/tools/groups, medium for integrations because the
   two budgets differ per route.
7. **One preflight for 501 + limiter + strict decode** — `gifs/api.ts`,
   `media/api.ts`, `files/api.ts`. **Net −15. Low risk.**
8. **One shared `HttpApi` for all 38 mounts** — `packages/api-contract/src/api.ts`,
   the 34 `create*Api` factories, `apps/server/src/app.ts`,
   `app/routes-messaging.ts`. Keep per-group middleware, custom schema-error layers,
   the public groups and the gifs router option. **Net −300 (range −250 to −350),
   high risk**; it also touches every factory's test seam. Do it only after 1–7.

Total of 1–7: **−425**, and **−725** if 8 is also done.

## Not worth it

- **A single dependency type instead of 313 lines of `XApiDependencies`.** Each type is
  the module's test seam; one `ServerCore`-sized type makes every test depend on the
  whole server and hides what a module really needs.
- **Deleting the 905 import lines.** They are the price of explicit imports (no barrels
  in apps, `docs/ARCHITECTURE.md:74`); a shared re-export file would move them, not
  remove them.
- **Rewriting `try/catch` around best-effort side effects** (`groups/api.ts:391-437`,
  `setup/api.ts:267-322`, `files/api.ts:201-254`, `voice/api.ts:64-110`). The rollback,
  log and continue behaviour is the feature; simplifying it would change outcomes.
- **Merging modules** (`audit`, `routines`, `agents/log`, `chat-*`) to cut imports and
  setup. Lines move, the domains do not merge, and the per-module setup stays.
- **Splitting the big files** (`contact-requests/api.ts` 636,
  `chats/api.ts` 594). Only files over 800 must split; splitting these moves lines and
  adds imports.
- **Stripping the security-order comments.** They are not boilerplate and removing
  them would cost a future reviewer the reason the limiter sits where it does.
- **Moving the public groups onto the session layer** to make the shared `HttpApi`
  simpler. `setup`, `authInvitesPublic` and machine `pair` are deliberately public and
  would answer 401 instead of their documented 404/400.

## Method notes

- Every file in the spec's set was opened in full. Ranges name the first and last line
  of the pattern, so blank lines and braces inside the range count.
- Pattern 1 counts imports even though they are not removable; the cut column says so.
- Pattern 6 overlaps patterns 1 and 3; its 300-line cut is the shared-`HttpApi` saving
  only and is not added to the per-module cuts.
- The 12.4k figure in the task header is reproducible only by adding the four
  delegation modules listed under "Inventory"; they are not in these tables.

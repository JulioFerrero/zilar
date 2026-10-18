# Big-cut plan (2026-10-18)

Julio, 10-18 19:35: "I don't see that we reduce code". The code map total went **up**:
- source lines on 10-17: 270,536;
- source lines on 10-18 at 19:35: 274,479.

The reduce and share tasks cut 1,970 lines that day, while 70 other merges added 5,110. Removing copied code cannot move a 274k total. This plan lists whole things to delete or shrink.

It comes from three read-only Claude audits (server, phone, web) run on 10-18 at `1aae88a44`. The line counts are the auditors' `wc -l` estimates; each task re-measures. Tests, mocks and generated files are out of scope: the code map counts them apart.

**Size by app on 10-18:**

| App | Source lines | Comment-only lines |
| --- | ---: | ---: |
| server | 81,579 | 15% |
| phone | 79,636 | 13% |
| web | 59,373 | 9.8% |

## Already done during the audits (10-18 evening)

| Task | What | Lines |
| --- | --- | ---: |
| T-2070 | phone: one API mock gate (16 copies) and one mockable-API hook | −441 |
| T-2066–T-2071 | shared twin logic, handle wording, server clones, web mute toggle, phone auth card | about −250 |

## Wave A: low risk, nobody notices (launch now, about 3,000 lines)

| # | App | Cut | Est. |
| --- | --- | --- | ---: |
| A1 | server | Delete the re-export-only barrels (`agents/tools.ts`, `agents/reply.ts`, `stickers/service.ts`, `routines/service.ts`, `ais/service.ts`, `xmpp/admin-client.ts`, `agents/memory/store.ts`, `handles/rules.ts`, `invite-links/service.ts`); importers point at the real module | ~300 |
| A2 | server | Dead code: `connections/smoke-client.ts`, `cancelDelegation`, `anchorParts`, `findAiForGateway`, `isAnimatedImage`, `effectMountsOf`. Single-value flags: `actions/demo.ts`, and the `maxRounds: 1` legacy path while `TOOLS_ENABLED` is always on. `topics/public-compat.ts`, whose flag is always true. The unused `GET /agents/tasks/:taskId/events` endpoint | ~370 |
| A3 | server | One rate-limit table instead of 62 `createRateLimiter` blocks and 119 constant lines | ~250 |
| A4 | server | Stale comments: 71 "moved unchanged / size split" headers (321 lines); 96 lines describing removed Hono, zod, drizzle or LiteLLM; the "async during the transition" notes. Test-only helpers counted as source (`agents/gateway.test-harness.ts`, `contract-smoke-support.ts`, `test-global-setup.ts`) move under a `test/` path | ~420 + ~580 moved |
| A5 | phone | 18 re-export shims and 24 `XApiError = ApiError` aliases; the unused `TextDecoder` fallback in `lib/polyfills.ts`; dead exports and props (`isTopicChat`, `checkInvite`, `openSearchHit`, `Avatar ai`, the approvals minute ticker…); mock-only `gradient:` demo images in production components | ~600 |
| A6 | web | Dead code: `ui/select.tsx` and its fixture, `node-builtins.d.ts`, unused components and exports, dead props. Old-server compat branches. `useContactRequestCount` reads the shared poll | ~530 |
| A7 | web | The `lib/api.ts` barrel becomes `export *` lines; one protected layout route in `AppRoutes` (19 × 8-line wrappers); size-split shims; stale comments | ~550 |

## Wave B: medium risk, nobody notices (after A, one at a time, each live-checked)

| # | App | Cut | Est. | Check |
| --- | --- | --- | ---: | --- |
| B1 | phone | Move the last hand-written HTTP clients (`chat-api`, `profile-api`, `directory-api`) onto the shared contract; `GET /api/me` has three parsers today. Also adds the timeout `getXmppToken` lacks | ~700 | emulator sign-in, profile, group join |
| B2 | web | The channel info panel becomes a variant of the group panel | ~500 | web screens vs the `WebChannel` board |
| B3 | server | The AI tool layer as one table per tool: the JSON Schema derives from the Effect Schema | ~450 | message pipeline: AI tool calls live |
| B4 | phone | The voice player as one small store | ~450 | emulator voice playback |
| B5 | server | One HttpApi instead of 37 mounts | ~400 | every route; needs a spike first |
| B6 | phone | One "pick, save, remove picture" hook (profile, group, `me`) | ~350 | emulator |
| B7 | server | Push MUC/Sub room subscriptions look dead (`group-notifier` polls instead) | ~345 | live: closed app gets a group push |
| B8 | server | One guarded fetch instead of three (web tools, sandbox host, connections) | ~275 | security review |
| B9 | phone | Message search on Effect fibers (web does it in 96 lines) | ~230 | emulator search |
| B10 | web | Test-only injection hooks whose tests were deleted | ~150 | typecheck |

## Julio's answer, 10-18 ~20:15

The audits found only about 3k safe lines, and they proposed dropping Whistle. Julio rejected that approach: **features stay**, and cuts must match the size of the codebase. Account deletion: **finish it** (a design canvas first). The J-list of feature removals is withdrawn.

## The big blocks (the lead measured on 10-18 at `804b12acb`, 273,775 source lines)

| Block | Lines | Plan | Est. cut |
| --- | ---: | --- | ---: |
| Comments | 35,839 (13%); 3,658 cite task IDs | `docs/COMMENTS.md` rules: keep WHY comments only. 16 tasks by folder (T-2072–T-2087), code untouched. A gate check plus an AGENTS.md rule stop regrowth | −15k to −18k |
| UI twins: phone components 51.9k, web components 43k | 95k | Move per-screen logic (state, effects, actions, derived values) into client-core view models, so each app keeps only markup. Biggest twin screens first | −10k over days |
| Hand-written API wrappers: phone `lib/*-api*.ts` 4,037, web `lib/api` 2,216 | 6.2k | One set of API wrappers in client-core over the derived `ZilarClient` (`packages/api-contract/src/client.ts`), used by both apps (like `makeTopicsApi` and `makeGroupsApi`) | −4k |
| Lead devtools `packages/devtools/src/lead` | 10k | Prune commands the lead no longer uses | −2k (measure first) |
| Wave A deletions (above) | — | Dead code, barrels, shims, rate-limit table | −3k |

Target: about −35k, with no feature removed.

**Not proposed:**
- The runner hub, machines and `apps/runner` (~6,000 lines): the agent-system plan needs them (P3).
- The Cosmos fixtures (2,050 lines): the lead uses them to check cards against the boards.

## Tracking

The code map total is the measure: https://julioferrero.github.io/zilar/. NOW.md records the total before and after each wave.

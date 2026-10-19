# Zilar architecture: where things live

This page is a map for the people and AIs who work on the code. Read it before your first change. It names folders and files, not line numbers, so it stays true when code moves. The product itself is described in `docs/FEATURES.md`. Worker rules are in `AGENTS.md`.

## The pieces

```
apps/web      React web app (Vite)                  ┐
apps/mobile   Expo / React Native app (expo-router) ┘─ same features on both (web first)
apps/server   TypeScript API server (Effect HTTP)   ── also runs the AI agents
apps/runner   CLI people install to host AI desks
apps/site     landing page (Next.js, www.zilar.app)
ejabberd      XMPP server: messages, presence, rooms (deploy/)
```

| Package | What it holds | Used by |
| --- | --- | --- |
| `packages/api-contract` | Every HTTP endpoint as an Effect `HttpApi` group, plus the derived client `makeZilarClient` and `runApi` (`src/client.ts`) | server, web, mobile |
| `packages/client-core` | Code shared by both apps: the chat store (`src/store/`), one API module per area (`*-api.ts`) and shared hooks | web, mobile |
| `packages/chat-core` | Pure chat logic with no React and no I/O: types, formatting, failures, message blocks | web, mobile, server |
| `packages/xmpp-core` | The XMPP client: connect, stanzas and events | web, mobile |
| `packages/protocol` | Wire rules shared with the server: JIDs, handles, tasks, approvals | all |
| `packages/desk`, `packages/runner-tunnel` | The AI desk tools, and the tunnel between the server and a runner | server, runner |
| `packages/ui-tokens` | The D24 palette, radius and depth values (`docs/design/ui-style.md`) | web, mobile |
| `packages/mock-backend` | An in-memory fake server used for mock mode (`?mock=1` on web, `ZILAR_SMOKE_MOCK=1` builds on the phone) | web, mobile |
| `packages/devtools` | The `lead` CLI, the autopilot and `pnpm gate` | repo tooling only |

## How a request flows

1. **Contract.** The endpoint is declared once, in `packages/api-contract/src/<area>.ts`, and listed in `src/api.ts`.
2. **Server.** `apps/server/src/<area>/api.ts` serves that group. The rule checks live in `service.ts` and the access checks in `access.ts`, and the handlers return plain values. Each domain has its own folder (`pins/`, `topics/`, `stickers/`, …).
3. **Shared client.** `packages/client-core/src/<area>-api.ts` exports `make<Area>Api(call)`. That one function holds every call and its normalisation. `topics-api.ts`, `chats-api.ts`, `ais-api.ts` and `stickers-api.ts` are the models to copy.
4. **Apps.** Each app only chooses the transport:
   - **web:** `make<Area>Api(callApi)`, where `callApi` is in `apps/web/src/lib/effect/api-client.ts`;
   - **phone:** a screen calls `useApi(make<Area>Api)` (`apps/mobile/src/lib/use-mockable-api.ts`), which picks the real or mock transport and keeps one API object across renders; store code passes `apiCall(transport)` (`apps/mobile/src/lib/effect/api-client.ts`).

Messages do not go through HTTP. They travel over XMPP (`packages/xmpp-core`) and land in the shared store (`packages/client-core/src/store/`, built around the message ledger). Each app wraps that store with its own provider: web in `apps/web/src/store/`, phone in `apps/mobile/src/store/`.

## Shared pieces to reuse

Before writing logic in an app, check whether it already lives here.

| Need | Where |
| --- | --- |
| Call an endpoint from an app | `packages/client-core/src/<area>-api.ts`. Today: chats, AIs, stickers, topics, groups, chat extras (pins, memory, media, search), tools (with routines and approvals), directory (explore, public join, visibility, handles), contacts (requests, blocks), settings (integrations, voice, audit, machines, message blocks) |
| The New AI flow (steps, fields, create) | `packages/client-core/src/new-ai-flow.ts` |
| Check an API key before saving it | `packages/client-core/src/key-check.ts` |
| Shared store rules: pins, chat prefs, group writes, the session check | `packages/client-core/src/store/` (`pins.ts`, `prefs.ts`, `group-actions.ts`, `session-check.ts`) |
| The store's state and action types | `ChatStoreCommonState` and `ChatStoreActions` in `packages/client-core/src/store/actions.ts`; each app adds only its own members |
| Error text for AI failures | `describeAiFailure` in `packages/chat-core/src/ai-errors.ts` |
| A rate limit on a server route | `limiter('name', now)` in `apps/server/src/rate-limit.ts`. Every budget is one line in its `RATE_LIMITS` table |
| A server module's deps | `extends Pick<ServerCore, 'db' \| 'auth' \| …>` from `apps/server/src/app/deps.ts` |
| Mounting a server API group | `mountGroups` in `apps/server/src/effect/http-core.ts` |
| Test helpers | a `test-support` file or folder, so the code map counts them as tests |

Plans for the next shared steps: `docs/audit/store-phase3-plan.md` (store wiring) and `docs/audit/agent-turns-plan.md` (one AI turn path for DMs and groups).

## Adding a feature end to end

1. **Contract and server.** Follow `docs/API_CONTRACT_RECIPE.md` steps 1–7.
2. **Client.** Add or extend `packages/client-core/src/<area>-api.ts`, then use it from both apps. Never write a second hand-written client in an app.
3. **Screens.** Keep the logic in client-core or chat-core whenever both apps need it. Only the screens differ: web in `apps/web/src/components` and `routes`, phone in `apps/mobile/src/components` and `app`.
4. **Database.** Add a hand-written SQL migration in `apps/server/drizzle/` (expand/contract, see `AGENTS.md`).

## House rules that shape the code

- **Fewer lines is the goal.** Share code between web and phone through the packages, and never copy it.
- **File size.** About 400 lines per file is a soft limit. Never split a file only to meet it; only a file over 800 lines must be split. `pnpm gate` warns over 400 and fails over 800.
- **No barrels in apps.** Import from the module that defines the name. Only a package's `src/index.ts` re-exports. One exception: `apps/web/src/lib/api.ts` gathers the web API wrappers (`lib/api/*.ts`) with `export *`, because one import path for about 110 screens costs fewer lines than per-module imports.
- **Comments** say only the why the code cannot say (`docs/COMMENTS.md`). Task IDs and history belong in git, not in comments.
- **Tests** cover only auth and keys, permissions and money, and the message pipeline. UI is checked by hand: on the phone with `pnpm phone:smoke`, on web in mock mode.
- **Validation.** Data is validated with Effect `Schema` at every boundary. The repo uses no zod.

---
id: T-2129
title: "Server: one core deps type (db, logger, auth, config, adminClient, audit) that the per-area *Dependencies/*Deps interfaces Pick from, and one mount helper for the repeated HttpApiBuilder.layer → sessionLayer → schemaErrorLayer → mountApi lines — same behaviour, fewer lines"
status: merged
milestone: M5
branch: task/T-2129-server-deps-mount
model: deepseek/deepseek-flash
effort: default
estimate: 60 min
---

# T-2129: One server deps type and one mount helper

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and code that reads the same everywhere. The lead counted at `48d057a3f`, outside `apps/server/src/agents/`:
- **Deps interfaces.** 64 hand-written `*Dependencies` / `*Deps` interfaces, in 54 files, repeat the same fields. Across the whole server:

  | Field | Times |
  | --- | ---: |
  | `db: ServerDatabase` | 79 |
  | `logger: Logger` | 45 |
  | `auth: Auth` | 44 |
  | `audit: AuditRecorder` | 41 |
  | `config: ServerConfig` | 33 |
  | `adminClient: EjabberdAdminClient` | 26 |

  Each interface also imports those types. The app-wide type already exists: `AppDependencies` in `apps/server/src/app/deps.ts:23`.
- **Mount lines.** 39 API modules end with the same lines, for example `apps/server/src/app/routes-messaging.ts:158-165` and `:246-253`:
  ```ts
  const apiLayer = HttpApiBuilder.layer(RolesApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );
  return mountApi(RolesApi, apiLayer);
  ```
  `sessionLayer` is provided 38 times and `schemaErrorLayer` 21 times (`apps/server/src/effect/http-core.ts:22,76`); `mountApi` is at `:240`.

### Steps
1. **The core type.** In `apps/server/src/app/deps.ts`, export one interface `ServerCore` with the always-present fields: `db`, `logger`, `auth`, `config`, `adminClient`, `audit`, with the types used today. Make `AppDependencies` reuse it where that saves lines, keeping `audit` optional there as it is today.
2. **The deps interfaces.** In each file listed under Allowed files, rewrite a deps interface that repeats two or more of those fields as:
   ```ts
   interface XDeps extends Pick<ServerCore, 'db' | 'auth'> {
     /* only the area's own fields */
   }
   ```
   Or use a `type` alias when nothing else remains. Keep every field's optionality exactly as it is (`audit?:` stays optional where it is optional). Drop the type imports that become unused.
3. **The mount helper.** In `apps/server/src/effect/http-core.ts`, add one helper next to `mountApi`, for example:
   ```ts
   mountGroups(api, groupLayer, { auth, logger, schemaErrors?: boolean, extra?: Layer })
   ```
   It builds `HttpApiBuilder.layer(api)`, provides the group layer, `sessionLayer(auth, logger)`, `schemaErrorLayer(logger)` when asked, and any extra layers, then calls `mountApi`. Use it in each API module whose mount matches that shape. Leave any module with a different shape as it is, and list it in the Report.
4. **No behaviour change:** same routes, same layers, in the same order. The only change is how types and mounts are written.
5. **Do not touch** `apps/server/src/agents/**`, `apps/server/src/auth/export.ts` or `apps/server/src/stickers/telegram/pack-input.ts`: other tasks hold them tonight.
6. **Size.** Report the line counts. Product lines must go down by at least 150.

### Allowed files
- `apps/server/src/app/deps.ts`
- `apps/server/src/effect/http-core.ts`
- `apps/server/src/actions/gateway.ts`
- `apps/server/src/ais/api.ts`
- `apps/server/src/ais/persona.ts`
- `apps/server/src/app/routes-messaging.ts`
- `apps/server/src/approvals/api-reads.ts`
- `apps/server/src/audit/api.ts`
- `apps/server/src/auth/api.ts`
- `apps/server/src/auth/sessions.ts`
- `apps/server/src/avatars/api.ts`
- `apps/server/src/avatars/service.ts`
- `apps/server/src/backgrounds/api.ts`
- `apps/server/src/blocks/service.ts`
- `apps/server/src/card-media/api.ts`
- `apps/server/src/chat-folders/api.ts`
- `apps/server/src/chat-prefs/api.ts`
- `apps/server/src/chats/api.ts`
- `apps/server/src/chats/delete-own.ts`
- `apps/server/src/connections/api.ts`
- `apps/server/src/contact-requests/api.ts`
- `apps/server/src/contact-requests/queries.ts`
- `apps/server/src/contacts/service.ts`
- `apps/server/src/files/api.ts`
- `apps/server/src/gifs/api.ts`
- `apps/server/src/gifs/routes.ts`
- `apps/server/src/groups/api.ts`
- `apps/server/src/groups/join.ts`
- `apps/server/src/handles/api.ts`
- `apps/server/src/integrations/api.ts`
- `apps/server/src/integrations/routes.ts`
- `apps/server/src/invite-links/api.ts`
- `apps/server/src/invite-links/tokens.ts`
- `apps/server/src/leader/start.ts`
- `apps/server/src/machines/api.ts`
- `apps/server/src/media/api.ts`
- `apps/server/src/message-blocks/api.ts`
- `apps/server/src/message-blocks/respond.ts`
- `apps/server/src/pins/service.ts`
- `apps/server/src/push/api-handlers.ts`
- `apps/server/src/push/api.ts`
- `apps/server/src/push/service.ts`
- `apps/server/src/roles/schemas.ts`
- `apps/server/src/routines/api.ts`
- `apps/server/src/search/api.ts`
- `apps/server/src/search/routes.ts`
- `apps/server/src/setup/api.ts`
- `apps/server/src/stickers/api.ts`
- `apps/server/src/stickers/routes.ts`
- `apps/server/src/stickers/schemas.ts`
- `apps/server/src/tools/adapter-support.ts`
- `apps/server/src/tools/routes.ts`
- `apps/server/src/topics/api.ts`
- `apps/server/src/topics/room-push.ts`
- `apps/server/src/topics/rooms.ts`
- `apps/server/src/topics/schemas.ts`
- `apps/server/src/voice-transcription/api.ts`
- `apps/server/src/voice-transcription/routes.ts`
- `apps/server/src/voice/api.ts`
- `apps/server/src/xmpp/api.ts`
- `work/T-2129-server-deps-mount.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, and the server tests the gate runs pass.
- Product lines are at least 150 lower.
- **Lead check:** after the deploy, the live server answers its routes as before (401 without a session), and the log shows 0 errors.

---

## Report (written by the worker when done)

### What I did

**One core deps type.** `apps/server/src/app/deps.ts` now exports `ServerCore` (`db`, `logger`, `auth`, `config`, `adminClient`, `audit`). `AppDependencies` extends `Omit<ServerCore, 'audit'>` so `audit` stays optional there, and `BaseDeps` is `Pick<ServerCore, ...>`.

**Deps interfaces.** In every allowed file, a `*Deps` / `*Dependencies` interface that repeated required core fields now extends `Pick<ServerCore, ...>` and keeps only the area's own fields. Optional core fields (`audit?`, `adminClient?`, `config?`, `logger?`) were left as written, so optionality is unchanged. Where nothing else remained the interface became a type alias (or `Parent & Pick<...>`). Unused type imports were dropped. Covered across 61 changed files, including the private route deps in `app/routes-messaging.ts`.

**Mount helper.** `apps/server/src/effect/http-core.ts` now exports `MountGroupOptions` and `mountGroups(api, groupLayer, { auth, logger, schemaErrors?, extra?, afterSchema? })`. It builds `HttpApiBuilder.layer(api)` and provides, in order: group, session, `extra` layers, the schema-error layer (`true` = shared `schemaErrorLayer`, or a custom `schemaErrorLayerFor(...)`), then `afterSchema` layers. `extra`/`afterSchema` accept one layer or an array; layers are provided sequentially in the same order as before. 33 mounts across 29 files use it.

**Line count (product code only, `apps/server/src`):** added 616, deleted 833, net **-217** lines (`git diff --numstat -- apps/server/src`).

**Left with their old mount shape (as the spec allows):**

- `apps/server/src/app/routes-messaging.ts` — `PinsApi` uses its own `HttpRouter.toWebHandler` handler and a hand-written route list, not `mountApi`.
- `apps/server/src/gifs/api.ts` — wraps the Effect handler with the media-token fallback, so it does not call `mountApi`.
- `apps/server/src/setup/api.ts` — setup runs before a session exists (group layer only, no `sessionLayer`).
- `apps/server/src/approvals/api.ts` — its mount lives in that file, which is not in Allowed files; only its deps type in `approvals/api-reads.ts` changed.

### Checks run

- `pnpm install` — completed, 29.7s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/authz-sweep.test.ts` — 5 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/sessions.test.ts` — 10 passed.
- `pnpm gate` — ended with `GATE PASS`. Summary lines:
  ```
  gate: 61 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (1.7s)
  PASS  lint  (1.2s)
  PASS  typecheck  (4.5s)
  PASS  effect  (2.2s)
  PASS  build @zilar/server  (0.4s)
  PASS  tests @zilar/server  (207.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: no changed source file is over 800 lines
  comments: no task IDs in added comments
  GATE PASS
  ```
  The five `size` WARNs are files that were already over the 400 soft limit and are now smaller (`ais/api.ts`, `app/routes-messaging.ts`, `leader/start.ts`, `message-blocks/respond.ts`, `search/routes.ts`, `topics/api.ts`).

### Notes for the lead

- The helper has one type assertion (`withAfter as MountedLayer`). `Layer.provide` cannot reduce a generic API's remaining requirements at the type level; the assertion is confined to the helper, and every call site still passes a fully built group layer and concrete middleware layers. No runtime behaviour differs.
- `schemaErrors` accepts either `true` (shared layer) or an already-built custom layer, which is how the modules with per-tag fixed messages (`audit`, `handles`, `stickers`, `search`, `contact-requests`, `ais`) keep their exact messages.
- Layer order is preserved per module: `extra` is provided before the schema layer, `afterSchema` after it. All of these layers are independent middleware, so no route or order changes.
- No test was added: this is a type/mount refactor with no new behaviour, and the gate runs the full server suite.

## Review (written by Claude)

Approved; the pre-review was clean (0 nits). Net −217 across 60 server files:
- `ServerCore` in `app/deps.ts` (`AppDependencies` extends it minus `audit`); the area deps interfaces now `Pick` from it;
- one `mountGroups` helper in `effect/http-core.ts` replaces the repeated `HttpApiBuilder.layer → session → schema errors → mountApi` lines.

**Lead read:**
- The helper keeps each module's layer order (`extra` before the schema layer, `afterSchema` after it).
- Modules with their own schema-error messages pass their custom layer.
- One type assertion is confined to the helper.

The gate ran the full server suite, including the contract smoke tests for roles and invite links. The live route probe follows the push.

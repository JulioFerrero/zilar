---
id: T-0544
title: "Effect C (HTTP): owner integration settings (GET, Telegram PUT/DELETE, email PUT) onto the HttpApi adapter, zod to Effect Schema; secrets never in responses or logs; helpers stay in routes.ts; only the route-shape test is rewritten"
status: todo
milestone: M5
branch: task/T-0544-effect-http-integrations
model: auto
effort: low
depends_on: [T-0536]
estimate: 1 day
---

# T-0544: integration settings on Effect HTTP

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono, and Effect Schema replaces zod. **The recipe is in `docs/EFFECT_GUIDE.md`, "Moving a server route module onto Effect HTTP"** (read items 8-10 too). The worked example is `apps/server/src/groups/api.ts`. **These routes carry secrets: the Telegram bot token, and the email SMTP or API key.** No secret may appear in a response, a log line or an error text, the same as today.

### Verified facts (do not re-derive; read each route for its exact step order, statuses, bodies, audit calls and texts)
- **`apps/server/src/integrations/routes.ts`** (487 lines):
  - constants `INTEGRATIONS_TELEGRAM_RATE_LIMIT_MAX`, `INTEGRATIONS_TELEGRAM_RATE_LIMIT_WINDOW_MS`, `INTEGRATIONS_EMAIL_RATE_LIMIT_MAX` and `INTEGRATIONS_EMAIL_RATE_LIMIT_WINDOW_MS` (lines 60-63);
  - `IntegrationsRoutesDependencies` (105), `BotTokenResolverDeps` (151) and `createGetBotToken` (163; not a route, used by `app.ts:451`);
  - `createIntegrationsRoutes` (181), with two limiters (186 and 193) and four routes:
    - `GET /settings/integrations` (220);
    - `PUT /settings/integrations/telegram` (234), with `telegramBodySchema`;
    - `DELETE /settings/integrations/telegram` (289);
    - `PUT /settings/integrations/email` (312), with `emailBodySchema`.
  - It imports `voiceTranscriptionStatusFor` from `../voice-transcription/routes` (line 52). Keep that import as it is.
- **The owner-only rule:** everyone except the owner gets the same 404 as an unknown route (comment at `app.ts:500`). Keep it.
- **`apps/server/src/app.ts`** (around line 503) mounts `app.route('/api', createIntegrationsRoutes({ auth, db, config, logger, mailer: currentMailer, audit: auditRecorder, ...integrations }))`. Keep it at the same position.
- **`apps/server/src/integrations/routes.test.ts`** builds the app through `createApp({ …, integrations: {…} })` (line 66), so most tests pass through unchanged. It imports `INTEGRATIONS_EMAIL_RATE_LIMIT_MAX`, `INTEGRATIONS_TELEGRAM_RATE_LIMIT_MAX`, `createGetBotToken`, `createIntegrationsRoutes` and `type IntegrationsRoutesDependencies` from `./routes` (lines 22-28).
- **One exception:** the test "registers exactly GET, PUT/DELETE telegram and PUT email under /api/settings/integrations" (around line 506) reads Hono's `sub.routes`.

### What to build
1. **Create `apps/server/src/integrations/api.ts`** with the four routes on `HttpApi`:
   - the same statuses, bodies, audit calls, texts and step order;
   - injectable limiters;
   - Effect Schema for the two bodies, with the same rules and no zod in `api.ts`;
   - success schemas listing every field the handler returns (item 8).
   
   Export an `INTEGRATIONS_API_ROUTES` list of method and path pairs, as `groups/api.ts` exports `GROUPS_API_ROUTES`.
2. **`integrations/routes.ts`:** remove the Hono factory and the zod body schemas. **Keep** the four constants, `IntegrationsRoutesDependencies`, `BotTokenResolverDeps` and `createGetBotToken` exported from it (`createIntegrationsApi` may import them), so the test imports still resolve.
3. **`app.ts`:** mount with `mountEffectRoutes(...)` at the same position, and keep `createGetBotToken` imported from `./integrations/routes`.
4. **The only test edit:** in `routes.test.ts`, rewrite **that one shape test** to assert the same four pairs, with length 4, on `INTEGRATIONS_API_ROUTES`. Change the import line to match: drop `createIntegrationsRoutes` and add `INTEGRATIONS_API_ROUTES` from `./api`. Every other test stays byte-identical.
5. **Secrets:** the test that asserts the serialised responses and logs never contain the sentinel key, sender or owner address (near line 495) passes unchanged.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe), `apps/server/src/effect/http.ts`, `apps/server/src/groups/api.ts`, `apps/server/src/integrations/routes.ts` (all of it), `apps/server/src/integrations/routes.test.ts`, and the integrations mount in `apps/server/src/app.ts`.

### Allowed files
`apps/server/src/integrations/api.ts`, `apps/server/src/integrations/routes.ts`, `apps/server/src/integrations/routes.test.ts` (only the shape test and its import), `apps/server/src/app.ts`, `work/T-0544-effect-http-integrations.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot integrations voice-transcription authz-sweep app.test
pnpm gate
```

### Acceptance
- Integration settings are served by Effect `HttpApi`, with the same answers, the owner-only 404 and no secrets leaked.
- Only the shape test changed.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

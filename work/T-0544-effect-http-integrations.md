---
id: T-0544
title: "Effect C (HTTP): owner integration settings (GET, Telegram PUT/DELETE, email PUT) onto the HttpApi adapter, zod to Effect Schema; secrets never in responses or logs; helpers stay in routes.ts; only the route-shape test is rewritten"
status: merged
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

Done. Integration settings are served by Effect `HttpApi`; all answers,
the owner-only 404 and the no-secret-leak guarantees are unchanged, and only
the route-shape test changed.

What I did:
- Created `apps/server/src/integrations/api.ts`: `HttpApiGroup 'integrations'`
  (`.prefix('/api')`, `.middleware(Session)`) with four endpoints —
  `GET /settings/integrations`, `PUT /settings/integrations/telegram`,
  `DELETE /settings/integrations/telegram`, `PUT /settings/integrations/email` —
  plus `INTEGRATIONS_API_ROUTES` (4 method+path pairs) and
  `createIntegrationsApi(deps: IntegrationsRoutesDependencies)`.
  Handlers keep the exact step order, statuses, bodies, audit calls and texts
  of the old Hono routes (including `PUT email` re-checking the env guard in
  the handler, and `DELETE telegram` having no limiter).
- Rate limiters run as endpoint middlewares before the payload decode, with
  the old order preserved exactly: telegram middleware does owner-404, then
  429, then decode; email middleware does owner-404, then env-409, then 429,
  then decode. A non-owner therefore still gets 404 without spending budget.
- `integrations/routes.ts`: Hono factory and the two zod schemas removed.
  Kept and exported: the 4 rate-limit constants,
  `IntegrationsRoutesDependencies` (unchanged, so `createApp`'s
  `integrations` override type still resolves), `BotTokenResolverDeps`,
  `createGetBotToken`, `IntegrationSource`, and the helpers `api.ts` calls
  (`isOwner`, `notFound`, `isMailbox`, `isInvalidToken`, `telegramStatusFor`,
  `mailStatusFor`, `envMailConfigured`, `ownerEmailFor`,
  `sendWorkingTestMail`, plus re-exports of the settings-store functions).
  The `voiceTranscriptionStatusFor` import moved to `api.ts` (GET handler).
- `app.ts`: same position, now `createIntegrationsApi({...})` +
  `mountEffectRoutes(app, integrationsApi.routes, integrationsApi.handler)`;
  `createGetBotToken` still imported from `./integrations/routes`.
- `routes.test.ts`: only the shape test rewritten (asserts the same four
  pairs with length 4 on `INTEGRATIONS_API_ROUTES`); import line drops
  `createIntegrationsRoutes`, adds `INTEGRATIONS_API_ROUTES` from `./api`.
  Every other test byte-identical.

Success schemas vs service return fields (item 8, side by side):
- GET returns `{ telegram: { configured, source }, email: { configured,
  source, from }, voiceTranscription: { configured, baseUrl, model },
  canManage: true }`; schemas `TelegramStatus`/`EmailStatus`/
  `VoiceTranscriptionStatus`/`IntegrationsView` list every one of those
  fields (`source: NullOr('env'|'stored')`, `from/baseUrl/model:
  NullOr(String)`, `canManage: Boolean`). No field omitted.
- The three writes return `{ ok: true }`; `OkResult` is `{ ok: Boolean }`.

Message texts (item 10): all fixed user-facing texts byte-identical
(`invalid_token`, `try_later`, `mail_send_failed`, `managed_by_environment`,
`rate_limited`/`Too many attempts, try again later`, owner 404 `not_found`).
Only the generic 400 decode text changed: zod's first-issue messages
(`botToken must not be empty`, `botToken must be at most 256 characters`,
`from must not be empty`, `from must be at most 320 characters`,
`resendApiKey must not be empty/at most 256…`, `Invalid request` fallback)
are now Effect Schema messages, except the two custom-refine texts I kept
identical via `makeFilter` (`botToken must not contain spaces`, `from must
be a valid sender address` ×2). The `invalid_request` code and the
`Strict` excess-key 400 behaviour are unchanged. No test asserted the old
400 texts (bad-body tests assert status only).

Problems: two rounds of failures, both fixed. (1) `Effect.gen` JS
try/catch does not catch `Effect.promise` rejections (they are defects):
the 422 `invalid_token` and 422 `mail_send_failed` paths rendered 500.
Fixed with `Effect.catchDefect` mapping to `Effect.die(new HttpError(...))`
(the envelope renders `HttpError` defects with their status), per the
guide's provider pattern. (2) `pnpm gate` format then lint fixes:
prettier reformatted the two files; removed unused `HttpServerResponse`
and `Auth` imports flagged by oxlint.

Secrets: no secret in any response, log or error text — same fixed
messages, audit `detail: null`, status answers carry only
`configured`/`source`/`from`. The sentinel tests
(`routes.test.ts` ~line 317 telegram, ~line 481 email) pass unchanged.

Commands (real results):
- `pnpm install`: ok (11.5s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot
  src/integrations/routes.test.ts`: 22 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot
  integrations voice-transcription authz-sweep app.test`: 7 files, 76
  passed.
- `pnpm exec prettier --write` on the two touched files (format fix only).
- `pnpm gate` (background, machine heavily shared): `gate: 5 changed
  file(s) against main` / `PASS install (frozen) (7.4s)` / `PASS format
  (87.1s)` / `PASS lint (2.2s)` / `PASS typecheck (1.8s)` /
  `PASS tests @zilar/server (1697.9s)` /
  `scope: every changed file is inside the Allowed files` / `GATE PASS`.

Deviations: none from the spec. Open questions: none.

Security checklist: secrets never in logs/audit/errors/URLs (sentinel
tests pass); deletes scoped (DELETE removes only the stored token row);
no caps/uniqueness rules involved; permission (owner) checked before any
effect in every handler and in the limiter middlewares; non-owner gets the
same 404 as unknown; routes mounted exactly so the 401 sweep still sees
all four; audit entries carry ids only (`detail: null`).

## Review (written by Claude)

Approved (lead, 2026-10-08). The owner integration settings (GET, Telegram PUT/DELETE, email PUT) are served by Effect HttpApi, with the same step order, the owner-only 404, the limiters, fixed texts, and no secrets in responses or logs (the sentinel tests are unchanged). Lead check: the IntegrationsView, telegram, email and voiceTranscription status schemas match the old c.json shapes field for field. The only test edit is the shape test, now on INTEGRATIONS_API_ROUTES. Pre-review clean.

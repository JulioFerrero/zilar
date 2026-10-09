// AIs module on the Effect `HttpApi` adapter (T-0555): the same methods,
// paths, statuses (201 on create, 204 on delete, 503 gating), bodies, audit
// calls and step order as the deleted Hono router (`routes.ts`), mounted
// under Hono by `apps/server/src/effect/http.ts`. Handlers keep calling the
// drizzle service; the DB rewrite is a separate lane.

import { Effect, Layer, Schema } from 'effect';
import { HttpServer, HttpServerRequest, HttpServerResponse, HttpRouter } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from 'effect/http-api';
import type { Logger } from 'pino';
import type { LitellmAdminClient } from '../ai/litellm-client';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import { avatarIdsByOwner, avatarUrlFor } from '../avatars/service';
import type { ServerConfig } from '../config';
import type { KeyCipher } from '../connections/crypto';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import {
  CurrentUser,
  Session,
  failureResponse,
  httpErrorResponse,
  requestIdOf,
  sessionLayer,
  withErrorEnvelope,
  type EffectApiMount,
  type EffectApiRoute,
} from '../effect/http-core';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import {
  assignMachine,
  createAi,
  deleteAi,
  getOwnedAi,
  listAis,
  MAX_MONTHLY_USD,
  resumeAi,
  stopAi,
  updateAi,
  type AiLimits,
  type AiLogger,
  type PublicAi,
} from './service';
import { AI_TEMPLATES } from './templates';
import { getAiUsage } from './usage';

export interface AisApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  adminClient: EjabberdAdminClient;
  logger: AiLogger;
  /** Absent when the gateway or the key master key is not configured: routes
   * that touch an AI answer 503 instead of failing halfway. */
  litellm?: LitellmAdminClient;
  cipher?: KeyCipher;
  /** Audit recorder (T-0083): when present, a successful stop / resume that
   * actually flipped the AI's status writes one entry; an idempotent repeat
   * writes nothing; a 4xx writes nothing. The recorder swallows its own
   * errors, so the response is never affected. */
  audit?: AuditRecorder;
}

// The spend summary the AI list and detail carry (T-0058). Null when LiteLLM
// cannot be reached: the UI shows "unavailable" and turns fail open.
export interface AiUsageSummary {
  todayUsd: number;
  windowUsd: number;
}

export type PublicAiWithUsage = PublicAi & { usage: AiUsageSummary | null };

// One AI's usage read may hang with LiteLLM, so every read races this
// timeout: on timeout the AI answers `usage: null` rather than holding the
// whole list.
export const USAGE_TIMEOUT_MS = 2_000;

// Replaces `LimitsSchema` (zod): both bounds finite and positive, the day
// inside the month, the month under the server ceiling.
const LimitsBody = Schema.Struct({
  perDayUsd: Schema.Number.check(
    Schema.makeFilter((value) =>
      Number.isFinite(value) && value > 0 ? undefined : 'perDayUsd must be positive',
    ),
  ),
  perMonthUsd: Schema.Number.check(
    Schema.makeFilter((value) =>
      Number.isFinite(value) && value > 0 ? undefined : 'perMonthUsd must be positive',
    ),
  ),
}).check(
  Schema.makeFilter((value) =>
    value.perDayUsd <= value.perMonthUsd
      ? undefined
      : 'perDayUsd must not be greater than perMonthUsd',
  ),
  Schema.makeFilter((value) =>
    value.perMonthUsd <= MAX_MONTHLY_USD
      ? undefined
      : `perMonthUsd must be at most ${MAX_MONTHLY_USD}`,
  ),
);

// Replaces the zod string trims (`z.string().trim().min(1).max(N)`): trimmed
// before the length checks, exactly like the old schemas.
const Name = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(64));
const Persona = Schema.Trim.check(Schema.isMaxLength(4000));
const ConnectionId = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const Model = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(256));
const MachineId = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const AiTemplateBody = Schema.Literals(AI_TEMPLATES);

// Replaces `CreateAiSchema` (zod): strict, so an unknown key is a 400.
const CreateAiBody = Schema.Struct({
  name: Name,
  template: AiTemplateBody,
  persona: Schema.optional(Persona),
  providerConnectionId: ConnectionId,
  model: Model,
  limits: LimitsBody,
});

// Replaces `UpdateAiSchema` (zod): strict, any subset, but a new provider
// connection needs an explicit model.
const UpdateAiBody = Schema.Struct({
  name: Schema.optional(Name),
  persona: Schema.optional(Persona),
  limits: Schema.optional(LimitsBody),
  model: Schema.optional(Model),
  providerConnectionId: Schema.optional(ConnectionId),
  // T-0474: the two delegation opt-ins (plan §8, decision 3). Owner only.
  canDelegate: Schema.optional(Schema.Boolean),
  acceptsDelegation: Schema.optional(Schema.Boolean),
}).check(
  Schema.makeFilter((value) =>
    value.providerConnectionId === undefined || value.model !== undefined
      ? undefined
      : 'A new provider connection needs an explicit model',
  ),
);

// Replaces `AssignMachineSchema` (zod): strict, `null` clears the assignment.
const AssignMachineBody = Schema.Struct({
  machineId: Schema.NullOr(MachineId),
});

const AiLimitsView = Schema.Struct({
  perDayUsd: Schema.Number,
  perMonthUsd: Schema.Number,
});

const AiUsageView = Schema.Struct({
  todayUsd: Schema.Number,
  windowUsd: Schema.Number,
});

// The success shape carries every `PublicAi` field plus the usage summary:
// `id`, `name`, `template`, `persona`, `model`, `jid`, `status`,
// `providerConnectionId`, `limits`, `machineId` (nullable), `canDelegate`,
// `acceptsDelegation`, `avatarUrl` (optional, never null), `createdAt` (a Date
// encoded as the same ISO string), and `usage` (`{ todayUsd, windowUsd } | null`).
const AiView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  template: AiTemplateBody,
  persona: Schema.String,
  model: Schema.String,
  jid: Schema.String,
  status: Schema.Literals(['active', 'disabled', 'stopped']),
  providerConnectionId: Schema.String,
  limits: AiLimitsView,
  machineId: Schema.NullOr(Schema.String),
  canDelegate: Schema.Boolean,
  acceptsDelegation: Schema.Boolean,
  avatarUrl: Schema.optional(Schema.String),
  createdAt: Schema.Date,
  usage: Schema.NullOr(AiUsageView),
});

// The write routes (create, patch, stop, resume, machine) answer the plain
// public AI, exactly like the old router: no `usage` summary.
const PublicAiView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  template: AiTemplateBody,
  persona: Schema.String,
  model: Schema.String,
  jid: Schema.String,
  status: Schema.Literals(['active', 'disabled', 'stopped']),
  providerConnectionId: Schema.String,
  limits: AiLimitsView,
  machineId: Schema.NullOr(Schema.String),
  canDelegate: Schema.Boolean,
  acceptsDelegation: Schema.Boolean,
  avatarUrl: Schema.optional(Schema.String),
  createdAt: Schema.Date,
});

const AiList = Schema.Array(AiView);

const AiIdParams = Schema.Struct({ id: Schema.String });

// Applied to the group so a payload decode failure renders like the old zod
// path: a 400 `invalid_request` carrying the first schema message.
class AisSchemaErrors extends HttpApiMiddleware.Service<AisSchemaErrors>()(
  'zilar/effect/http/AisSchemaErrors',
) {}

// The route `logger` only warns, but the error envelope logs defects with
// `error`. Both read the same `(fields, message)` pair, so adapt one to the
// other without touching the service's logger shape.
function toLogger(logger: AiLogger): Logger {
  return {
    error: (fields: Record<string, unknown>, message: string) => {
      logger.warn(fields, message);
    },
  } as unknown as Logger;
}

function schemaErrorLayer(logger: Logger): Layer.Layer<AisSchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(AisSchemaErrors, (error) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return failureResponse(
        logger,
        requestIdOf(request),
        new HttpError(400, 'invalid_request', error.cause.message || 'Invalid AI request'),
      );
    }),
  );
}

// Runs the 503 availability gate before the payload is decoded, exactly like
// the old routes' `requireConfigured()` -> `safeParse` order: a malformed
// body on an unconfigured server still answers 503, not 400. `requires:
// CurrentUser` is satisfied by `Session`. The gate needs no decode, so it
// also covers the no-payload writes (delete) for free; stop/resume/machine
// need only the DB and skip it, as they did before.
class AisConfigured extends HttpApiMiddleware.Service<AisConfigured, { requires: CurrentUser }>()(
  'zilar/effect/http/AisConfigured',
) {}

function configuredLayer(deps: {
  litellm?: LitellmAdminClient;
  cipher?: KeyCipher;
}): Layer.Layer<AisConfigured> {
  return Layer.succeed(
    AisConfigured,
    AisConfigured.of(
      Effect.fnUntraced(function* (httpEffect) {
        if (deps.litellm === undefined || deps.cipher === undefined) {
          const request = yield* HttpServerRequest.HttpServerRequest;
          return httpErrorResponse(
            requestIdOf(request),
            new HttpError(503, 'ais_unavailable', 'AI management is not configured on this server'),
          );
        }
        return yield* httpEffect;
      }),
    ),
  );
}

const AisGroup = HttpApiGroup.make('ais')
  .add(
    HttpApiEndpoint.get('list', '/ais', {
      success: AiList,
    }),
    HttpApiEndpoint.get('detail', '/ais/:id', {
      params: AiIdParams,
      success: AiView,
    }),
    HttpApiEndpoint.post('create', '/ais', {
      payload: CreateAiBody,
      success: PublicAiView,
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' })
      .middleware(AisConfigured),
    HttpApiEndpoint.patch('patch', '/ais/:id', {
      params: AiIdParams,
      payload: UpdateAiBody,
      success: PublicAiView,
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' })
      .middleware(AisConfigured),
    HttpApiEndpoint.delete('remove', '/ais/:id', {
      params: AiIdParams,
      success: HttpApiSchema.NoContent,
    }).middleware(AisConfigured),
    HttpApiEndpoint.post('stop', '/ais/:id/stop', {
      params: AiIdParams,
      success: PublicAiView,
    }),
    HttpApiEndpoint.post('resume', '/ais/:id/resume', {
      params: AiIdParams,
      success: PublicAiView,
    }),
    HttpApiEndpoint.put('assignMachine', '/ais/:id/machine', {
      params: AiIdParams,
      payload: AssignMachineBody,
      success: PublicAiView,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
  )
  .middleware(Session)
  .middleware(AisSchemaErrors)
  // The adapter forwards `c.req.raw` unchanged, so paths keep Hono's `/api`.
  .prefix('/api');

const AisApi = HttpApi.make('ais').add(AisGroup);

export const AIS_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'GET', path: '/api/ais' },
  { method: 'GET', path: '/api/ais/:id' },
  { method: 'POST', path: '/api/ais' },
  { method: 'PATCH', path: '/api/ais/:id' },
  { method: 'DELETE', path: '/api/ais/:id' },
  { method: 'POST', path: '/api/ais/:id/stop' },
  { method: 'POST', path: '/api/ais/:id/resume' },
  { method: 'PUT', path: '/api/ais/:id/machine' },
];

export function createAisApi(deps: AisApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const effectLogger = toLogger(logger);
  const litellm = deps.litellm;
  const cipher = deps.cipher;
  const audit = deps.audit;

  const requireConfigured = (): { cipher: KeyCipher; litellm: LitellmAdminClient } => {
    // Unreachable when called through create/patch/remove: the AisConfigured
    // endpoint middleware already answered 503. Kept as a backstop so the
    // handler never runs half-configured.
    if (cipher === undefined || litellm === undefined) {
      throw new HttpError(503, 'ais_unavailable', 'AI management is not configured on this server');
    }
    return { cipher, litellm };
  };

  const serviceDeps = (configured: {
    cipher: KeyCipher;
    litellm: LitellmAdminClient;
  }): Parameters<typeof createAi>[0] => ({
    db: deps.db,
    adminClient: deps.adminClient,
    cipher: configured.cipher,
    litellm: configured.litellm,
    logger,
    domain: deps.config.xmpp.domain,
  });

  // T-0165: every AI response that already carries a name gets `avatarUrl`
  // when the AI has a picture (omitted when none, like today). One query
  // for the whole list, never one per AI.
  const withAvatars = async (list: PublicAi[]): Promise<PublicAi[]> => {
    if (list.length === 0) {
      return list;
    }
    const ids = await avatarIdsByOwner(
      deps.db,
      'ai',
      list.map((ai) => ai.id),
    );
    return list.map((ai) =>
      ids.get(ai.id) === undefined ? ai : { ...ai, avatarUrl: avatarUrlFor(ids.get(ai.id)!) },
    );
  };

  // Reads one AI's usage with a per-AI timeout. Without a LiteLLM client, or
  // on any failure or timeout, the AI answers `usage: null`: spend is
  // best-effort decoration on the management API, never a reason to fail it.
  const withUsage = async (ai: PublicAi): Promise<PublicAiWithUsage> => {
    if (litellm === undefined) {
      return { ...ai, usage: null };
    }
    const usage = await Promise.race([
      getAiUsage({ db: deps.db, litellm, logger }, ai.id).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), USAGE_TIMEOUT_MS)),
    ]);
    if (usage === null) {
      return { ...ai, usage: null };
    }
    return { ...ai, usage: { todayUsd: usage.todayUsd, windowUsd: usage.windowUsd } };
  };

  async function recordAudit(
    entry: Parameters<NonNullable<typeof audit>['record']>[0],
  ): Promise<void> {
    if (audit === undefined) {
      return;
    }
    try {
      await audit.record(entry);
    } catch {
      // The recorder contract says it must not throw, but a buggy one
      // must not break the AI route either.
    }
  }

  const groupLayer = HttpApiBuilder.group(AisApi, 'ais', (handlers) =>
    handlers
      .handle('list', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const ais = yield* Effect.promise(() => listAis(deps.db, user.id));
            const withAvatarList = yield* Effect.promise(() => withAvatars(ais));
            // Owner only, as today: every id here came from the owner's own listing.
            // The reads run in parallel so one slow AI never holds the whole list.
            return yield* Effect.promise(() =>
              Promise.all(withAvatarList.map((ai) => withUsage(ai))),
            );
          }),
          effectLogger,
          requestId,
        );
      })
      .handle('detail', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const ai = yield* Effect.promise(() => getOwnedAi(deps.db, request.params.id, user.id));
            if (!ai) {
              throw new HttpError(404, 'not_found', 'AI not found');
            }
            const [withAvatar] = yield* Effect.promise(() => withAvatars([ai]));
            return yield* Effect.promise(() => withUsage(withAvatar ?? ai));
          }),
          effectLogger,
          requestId,
        );
      })
      .handle('create', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const configured = requireConfigured();
            const payload = request.payload;
            const created = yield* Effect.promise(() =>
              createAi(serviceDeps(configured), {
                ownerId: user.id,
                name: payload.name,
                template: payload.template,
                ...(payload.persona === undefined ? {} : { persona: payload.persona }),
                providerConnectionId: payload.providerConnectionId,
                model: payload.model,
                limits: { ...payload.limits } as AiLimits,
              }),
            );
            return HttpServerResponse.jsonUnsafe(created, { status: 201 });
          }),
          effectLogger,
          requestId,
        );
      })
      .handle('patch', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const configured = requireConfigured();
            const payload = request.payload;
            return yield* Effect.promise(() =>
              updateAi(serviceDeps(configured), {
                id: request.params.id,
                ownerId: user.id,
                ...(payload.name === undefined ? {} : { name: payload.name }),
                ...(payload.persona === undefined ? {} : { persona: payload.persona }),
                ...(payload.limits === undefined
                  ? {}
                  : { limits: { ...payload.limits } as AiLimits }),
                ...(payload.model === undefined ? {} : { model: payload.model }),
                ...(payload.providerConnectionId === undefined
                  ? {}
                  : { providerConnectionId: payload.providerConnectionId }),
                ...(payload.canDelegate === undefined ? {} : { canDelegate: payload.canDelegate }),
                ...(payload.acceptsDelegation === undefined
                  ? {}
                  : { acceptsDelegation: payload.acceptsDelegation }),
              }),
            );
          }),
          effectLogger,
          requestId,
        );
      })
      .handle('remove', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const configured = requireConfigured();
            yield* Effect.promise(() =>
              deleteAi(serviceDeps(configured), request.params.id, user.id),
            );
          }),
          effectLogger,
          requestId,
        );
      })
      // T-0080: the owner's kill switch. Stop disconnects the AI at once and
      // prevents the gateway from waking it back up; resume reconnects it. Both
      // answer the public AI, so the panel can re-render against the server
      // truth without a second GET. Unlike the other writes they need only the
      // database: a kill switch must work when LiteLLM, the cipher or the
      // gateway are not configured or are down.
      //
      // T-0083: when an `audit` recorder is wired in, a real status flip writes
      // one entry (`ai.stopped` / `ai.resumed`); an idempotent repeat writes
      // nothing. The pre-read here is owner-checked, so a stranger gets the same
      // 404 whether or not the recorder is present, and we use it only to know
      // whether the service call actually changed the state. The service stays
      // free of audit code. The `try/catch` around `audit.record` is a defensive
      // backstop: the standard recorder swallows its own errors, but a custom or
      // buggy one must never turn a 200 into a 500 here.
      .handle('stop', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const id = request.params.id;
            const before = yield* Effect.promise(() => getOwnedAi(deps.db, id, user.id));
            const ai = yield* Effect.promise(() => stopAi({ db: deps.db }, id, user.id));
            if (before !== null && before.status !== ai.status) {
              yield* Effect.promise(() =>
                recordAudit({
                  actorUserId: user.id,
                  aiId: ai.id,
                  groupId: null,
                  action: 'ai.stopped',
                  subjectId: ai.id,
                  argsHash: null,
                  costCurrency: null,
                  costAmount: null,
                  result: 'ok',
                  detail: null,
                }),
              );
            }
            return ai;
          }),
          effectLogger,
          requestId,
        );
      })
      .handle('resume', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const id = request.params.id;
            const before = yield* Effect.promise(() => getOwnedAi(deps.db, id, user.id));
            const ai = yield* Effect.promise(() => resumeAi({ db: deps.db }, id, user.id));
            if (before !== null && before.status !== ai.status) {
              yield* Effect.promise(() =>
                recordAudit({
                  actorUserId: user.id,
                  aiId: ai.id,
                  groupId: null,
                  action: 'ai.resumed',
                  subjectId: ai.id,
                  argsHash: null,
                  costCurrency: null,
                  costAmount: null,
                  result: 'ok',
                  detail: null,
                }),
              );
            }
            return ai;
          }),
          effectLogger,
          requestId,
        );
      })
      // T-0091: assign or clear the AI's home machine. The audit entry is
      // written only when the value actually changed, mirroring how `stop` /
      // `resume` skip the audit on an idempotent call: a recorder that swallows
      // errors must not turn a 200 into a 500 here either. The `try/catch`
      // around `audit.record` is the same defensive backstop as the kill-switch
      // routes. `before.machineId` and `ai.machineId` are always either the
      // same string or one of them is `null`, so the inequality check is
      // straightforward.
      .handle('assignMachine', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const id = request.params.id;
            const machineId = request.payload.machineId;
            const before = yield* Effect.promise(() => getOwnedAi(deps.db, id, user.id));
            const ai = yield* Effect.promise(() =>
              assignMachine(
                { db: deps.db },
                {
                  aiId: id,
                  ownerId: user.id,
                  machineId,
                },
              ),
            );
            if (before !== null && before.machineId !== ai.machineId) {
              yield* Effect.promise(() =>
                recordAudit({
                  actorUserId: user.id,
                  aiId: ai.id,
                  groupId: null,
                  action: 'ai.machine_assigned',
                  subjectId: ai.id,
                  argsHash: null,
                  costCurrency: null,
                  costAmount: null,
                  result: 'ok',
                  detail: { machineId: ai.machineId },
                }),
              );
            }
            return ai;
          }),
          effectLogger,
          requestId,
        );
      }),
  );

  const apiLayer = HttpApiBuilder.layer(AisApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, effectLogger)),
    Layer.provide(schemaErrorLayer(effectLogger)),
    Layer.provide(
      configuredLayer({
        ...(litellm === undefined ? {} : { litellm }),
        ...(cipher === undefined ? {} : { cipher }),
      }),
    ),
  );

  // Hono keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: AIS_API_ROUTES };
}

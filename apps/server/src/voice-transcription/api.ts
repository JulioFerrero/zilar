// Voice transcription routes on the Effect `HttpApi` adapter (T-0545): the
// same methods, paths, statuses, bodies, limiter order and audit calls as the
// old Hono router (`routes.ts`), mounted under Hono by
// `apps/server/src/effect/http.ts`. Handlers keep calling the drizzle
// pipeline; the DB rewrite is a separate lane. The owner settings carry the
// provider API key, which never appears in a response, log line or error text.

import { Effect, Layer, Schema } from 'effect';
import { HttpServer, HttpServerRequest, HttpRouter } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from 'effect/http-api';
import { SqlClient } from 'effect/sql';
import type { Logger } from 'pino';
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
} from '../effect/http';
import { sqlRuntimeFor } from '../effect/sql';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import {
  defaultAudioFetcher,
  defaultTranscriber,
  fetchAndTranscribe,
  shareInFlight,
} from './pipeline';
import { silentVerificationWav, TranscriptionProviderError } from './provider';
import {
  isOwner,
  normalizeBaseUrl,
  toInternalUploadUrl,
  voiceTranscriptUrlHash,
  VOICE_TRANSCRIPT_RATE_LIMIT_MAX,
  VOICE_TRANSCRIPT_RATE_LIMIT_OWNER_MAX,
  VOICE_TRANSCRIPT_RATE_LIMIT_OWNER_WINDOW_MS,
  VOICE_TRANSCRIPT_RATE_LIMIT_WINDOW_MS,
  type VoiceTranscriptionRoutesDependencies,
} from './routes';
import {
  deleteVoiceTranscriptionSettings,
  getVoiceTranscriptionSettings,
  saveVoiceTranscriptionSettings,
  VOICE_TRANSCRIPTION_DEFAULT_MODEL,
  type VoiceTranscriptionSettings,
} from './settings';
import { settingsCipherFor } from '../setup/settings';

// Replaces `transcriptBodySchema` (zod): a non-empty URL of at most 2048
// characters. Strict (`PayloadParseOptions` below) so an excess key fails like
// the old `.strict()`.
const TranscriptBody = Schema.Struct({
  url: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
});

// Replaces `voiceSettingsBodySchema` (zod): trimmed before the length checks,
// exactly like the old `.trim().min()/.max()`. Strict like the old `.strict()`.
const VoiceSettingsBody = Schema.Struct({
  baseUrl: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  apiKey: Schema.optional(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(512))),
  model: Schema.optional(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
});

// Every field of the handler's return value, so no field is stripped by the
// success encoder (recipe item 8): `{ enabled }`, `{ text }`, `{ ok: true }`.
const EnabledStatus = Schema.Struct({ enabled: Schema.Boolean });
const TranscriptResult = Schema.Struct({ text: Schema.String });
const OkResult = Schema.Struct({ ok: Schema.Boolean });

// Applied to the group so a payload decode failure renders like the old zod
// path: a 400 `invalid_request` carrying the schema message.
class VoiceTranscriptionSchemaErrors extends HttpApiMiddleware.Service<VoiceTranscriptionSchemaErrors>()(
  'zilar/effect/http/VoiceTranscriptionSchemaErrors',
) {}

function schemaErrorLayer(logger: Logger): Layer.Layer<VoiceTranscriptionSchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(VoiceTranscriptionSchemaErrors, (error) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return failureResponse(
        logger,
        requestIdOf(request),
        new HttpError(400, 'invalid_request', error.cause.message || 'Invalid request'),
      );
    }),
  );
}

// The transcript route answers 501 when the owner never configured an
// endpoint, before the payload is decoded (the old router's
// session -> settings -> decode -> limiter order). Endpoint middleware runs
// before the payload decode, the same pattern as `GroupsRoleRateLimit` in
// `groups/api.ts`. `requires: CurrentUser` keeps the session 401 first.
class TranscriptConfigured extends HttpApiMiddleware.Service<
  TranscriptConfigured,
  { requires: CurrentUser }
>()('zilar/effect/http/TranscriptConfigured') {}

function transcriptConfiguredLayer(
  settingsReader: () => Promise<VoiceTranscriptionSettings | null>,
): Layer.Layer<TranscriptConfigured> {
  return Layer.succeed(
    TranscriptConfigured,
    TranscriptConfigured.of(
      Effect.fnUntraced(function* (httpEffect) {
        yield* CurrentUser;
        if ((yield* Effect.promise(() => settingsReader())) === null) {
          const request = yield* HttpServerRequest.HttpServerRequest;
          return httpErrorResponse(
            requestIdOf(request),
            new HttpError(
              501,
              'transcription_not_configured',
              'Voice transcription is not set up on this server',
            ),
          );
        }
        return yield* httpEffect;
      }),
    ),
  );
}

// The owner settings answer 404 for non-owners and 429 over budget before
// the payload is decoded (the old router's session -> owner -> limiter ->
// decode order). The handler drops both checks so the budget is charged
// exactly once. `requires: CurrentUser` keeps the session 401 first.
class VoiceSettingsOwnerLimit extends HttpApiMiddleware.Service<
  VoiceSettingsOwnerLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/VoiceSettingsOwnerLimit') {}

function voiceSettingsOwnerLimitLayer(
  ownerOf: (userId: string) => Promise<boolean>,
  limiter: RateLimiter,
): Layer.Layer<VoiceSettingsOwnerLimit> {
  return Layer.succeed(
    VoiceSettingsOwnerLimit,
    VoiceSettingsOwnerLimit.of(
      Effect.fnUntraced(function* (httpEffect) {
        const user = yield* CurrentUser;
        if (!(yield* Effect.promise(() => ownerOf(user.id)))) {
          const request = yield* HttpServerRequest.HttpServerRequest;
          return httpErrorResponse(
            requestIdOf(request),
            new HttpError(404, 'not_found', 'Not found'),
          );
        }
        if (!limiter.allow(user.id)) {
          const request = yield* HttpServerRequest.HttpServerRequest;
          return httpErrorResponse(
            requestIdOf(request),
            new HttpError(429, 'rate_limited', 'Too many attempts, try again later'),
          );
        }
        return yield* httpEffect;
      }),
    ),
  );
}

const VoiceTranscriptionGroup = HttpApiGroup.make('voiceTranscription')
  .add(
    HttpApiEndpoint.get('status', '/voice/transcription', {
      success: EnabledStatus,
    }),
    HttpApiEndpoint.post('transcript', '/voice/transcript', {
      payload: TranscriptBody,
      success: TranscriptResult,
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' })
      .middleware(TranscriptConfigured),
    HttpApiEndpoint.put('setSettings', '/settings/integrations/voice-transcription', {
      payload: VoiceSettingsBody,
      success: OkResult,
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' })
      .middleware(VoiceSettingsOwnerLimit),
    HttpApiEndpoint.delete('removeSettings', '/settings/integrations/voice-transcription', {
      success: OkResult,
    }),
  )
  .middleware(Session)
  .middleware(VoiceTranscriptionSchemaErrors)
  // The adapter forwards `c.req.raw` unchanged, so paths keep Hono's `/api`.
  .prefix('/api');

const VoiceTranscriptionApi = HttpApi.make('voiceTranscription').add(VoiceTranscriptionGroup);

export const VOICE_TRANSCRIPTION_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'GET', path: '/api/voice/transcription' },
  { method: 'POST', path: '/api/voice/transcript' },
  { method: 'PUT', path: '/api/settings/integrations/voice-transcription' },
  { method: 'DELETE', path: '/api/settings/integrations/voice-transcription' },
];

export function createVoiceTranscriptionApi(
  deps: VoiceTranscriptionRoutesDependencies,
): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  const transcriptLimiter =
    deps.transcriptLimiter ??
    createRateLimiter({
      max: VOICE_TRANSCRIPT_RATE_LIMIT_MAX,
      windowMs: VOICE_TRANSCRIPT_RATE_LIMIT_WINDOW_MS,
      now,
    });
  const settingsLimiter =
    deps.settingsLimiter ??
    createRateLimiter({
      max: VOICE_TRANSCRIPT_RATE_LIMIT_OWNER_MAX,
      windowMs: VOICE_TRANSCRIPT_RATE_LIMIT_OWNER_WINDOW_MS,
      now,
    });
  const fetchAudio = deps.audioFetcher ?? defaultAudioFetcher;
  const transcribe = deps.transcribe ?? defaultTranscriber();
  // In-flight transcripts by URL hash: two simultaneous taps on the same
  // voice message share one fetch + provider call instead of double-billing.
  // `shareInFlight` removes the entry in `finally`, so a failure (or an
  // interrupted request) never poisons the next tap; the DB row (re-checked
  // under the lock at insert time) is the durable cache, this map only
  // dedupes the overlap window.
  const inFlight = shareInFlight();

  function storedSettings(): Promise<VoiceTranscriptionSettings | null> {
    return getVoiceTranscriptionSettings(deps.db, settingsCipherFor(deps.config)).catch(() => {
      // Fail closed (reads as "not configured"), but say so: a DB or
      // decrypt failure must not silently look like an unset endpoint. The
      // message is fixed — no error text, no key.
      deps.logger.warn({}, 'voice transcription settings could not be read');
      return null;
    });
  }

  const groupLayer = HttpApiBuilder.group(VoiceTranscriptionApi, 'voiceTranscription', (handlers) =>
    handlers
      // The enabled flag for any signed-in user.
      .handle('status', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const settings = yield* Effect.promise(() => storedSettings());
            return { enabled: settings !== null };
          }),
          logger,
          requestId,
        );
      })
      // The transcript route. The 501 for an unconfigured server already ran
      // in endpoint middleware, before the payload decode; the re-check
      // below is only a backstop for settings removed mid-flight. Validation
      // still runs before the rate limiter: malformed requests fail at the
      // payload decode and never burn the caller's budget. Cached hits still
      // count (fine — they cost a row read, and the budget is generous).
      .handle('transcript', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const settings = yield* Effect.promise(() => storedSettings());
            if (settings === null) {
              throw new HttpError(
                501,
                'transcription_not_configured',
                'Voice transcription is not set up on this server',
              );
            }
            // The URL is validated against this install before any request is
            // made: same origin as `PUBLIC_URL`, path under `/upload/`.
            const internalUrl = toInternalUploadUrl(request.payload.url, deps.config);
            if (internalUrl === null) {
              throw new HttpError(400, 'invalid_request', 'The voice URL is not from this server');
            }
            if (!transcriptLimiter.allow(user.id)) {
              throw new HttpError(429, 'rate_limited', 'Too many attempts, try again later');
            }
            const urlHash = voiceTranscriptUrlHash(request.payload.url);
            const db: ServerDatabase = deps.db;

            // Fast path: the durable cache, no lock. Misses share one
            // in-flight fetch + provider call per URL hash (no transaction
            // and no advisory lock is held across the network — the lock only
            // covers the re-check + insert below, with `onConflictDoNothing`
            // as the backstop).
            const [fastHit] = yield* Effect.promise(() =>
              sqlRuntimeFor(db).runPromise(
                Effect.gen(function* () {
                  const sql = yield* SqlClient.SqlClient;
                  return yield* sql<{
                    text: string;
                  }>`SELECT text FROM voice_transcripts WHERE url_hash = ${urlHash} LIMIT 1`;
                }),
              ),
            );
            // Every successful request is audited, cache hits included (ids
            // and the URL hash only, never the text).
            const auditRequested = (): void => {
              void deps.audit?.record({
                actorUserId: user.id,
                aiId: null,
                groupId: null,
                action: 'voice.transcript_requested',
                subjectId: null,
                argsHash: null,
                costCurrency: null,
                costAmount: null,
                result: 'ok',
                detail: { urlHash },
              });
            };
            if (fastHit !== undefined) {
              auditRequested();
              return { text: fastHit.text };
            }

            const text = yield* Effect.promise(() =>
              inFlight.run(urlHash, () =>
                fetchAndTranscribe({
                  db,
                  urlHash,
                  internalUrl,
                  settings,
                  fetchAudio,
                  transcribe,
                }),
              ),
            );

            auditRequested();
            return { text };
          }),
          logger,
          requestId,
        );
      })
      // The owner-only endpoint settings, verified with a 1-second generated
      // silent WAV before storing. The owner 404 and the settings budget
      // already ran in endpoint middleware, before the payload decode (old
      // order: owner -> limiter -> decode), so the handler starts at the
      // base-URL check.
      .handle('setSettings', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const { normalized, problem } = normalizeBaseUrl(request.payload.baseUrl);
            if (normalized === null) {
              throw new HttpError(400, 'invalid_request', problem ?? 'The base URL is not valid');
            }
            const candidate: VoiceTranscriptionSettings = {
              baseUrl: normalized,
              apiKey: request.payload.apiKey ?? null,
              model: request.payload.model ?? VOICE_TRANSCRIPTION_DEFAULT_MODEL,
            };

            // Verify before storing: the silent WAV goes through the real
            // provider path (same `transcribe` seam the transcript route
            // uses). A clip the endpoint accepts proves the URL/key/model
            // work; a refusal answers 422 `endpoint_rejected`, a transport
            // failure 422 `endpoint_unreachable` — and nothing is stored
            // either way.
            const verificationError: unknown = yield* Effect.promise(() =>
              transcribe({
                baseUrl: candidate.baseUrl,
                apiKey: candidate.apiKey,
                model: candidate.model,
                audio: silentVerificationWav(),
                filename: 'verify.wav',
                mime: 'audio/wav',
              }).then(
                () => null,
                (error: unknown) => error,
              ),
            );
            if (
              verificationError instanceof TranscriptionProviderError &&
              verificationError.kind === 'unreachable'
            ) {
              throw new HttpError(
                422,
                'endpoint_unreachable',
                'The transcription endpoint could not be reached. Check the URL.',
              );
            }
            if (verificationError instanceof TranscriptionProviderError) {
              throw new HttpError(
                422,
                'endpoint_rejected',
                'The transcription endpoint rejected the test request. Check the URL, key and model.',
              );
            }
            if (verificationError !== null) {
              throw new HttpError(
                422,
                'endpoint_unreachable',
                'The transcription endpoint could not be reached. Check the URL.',
              );
            }

            const cipher = settingsCipherFor(deps.config);
            yield* Effect.promise(() => saveVoiceTranscriptionSettings(deps.db, cipher, candidate));

            void deps.audit?.record({
              actorUserId: user.id,
              aiId: null,
              groupId: null,
              action: 'integrations.voice_transcription_set',
              subjectId: null,
              argsHash: null,
              costCurrency: null,
              costAmount: null,
              result: 'ok',
              detail: null,
            });
            return { ok: true as const };
          }),
          logger,
          requestId,
        );
      })
      // The owner-only endpoint removal.
      .handle('removeSettings', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            if (!(yield* Effect.promise(() => isOwner(deps.db, user.id)))) {
              throw new HttpError(404, 'not_found', 'Not found');
            }
            yield* Effect.promise(() => deleteVoiceTranscriptionSettings(deps.db));
            void deps.audit?.record({
              actorUserId: user.id,
              aiId: null,
              groupId: null,
              action: 'integrations.voice_transcription_removed',
              subjectId: null,
              argsHash: null,
              costCurrency: null,
              costAmount: null,
              result: 'ok',
              detail: null,
            });
            return { ok: true as const };
          }),
          logger,
          requestId,
        );
      }),
  );

  const apiLayer = HttpApiBuilder.layer(VoiceTranscriptionApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(transcriptConfiguredLayer(storedSettings)),
    Layer.provide(
      voiceSettingsOwnerLimitLayer((userId) => isOwner(deps.db, userId), settingsLimiter),
    ),
    Layer.provide(schemaErrorLayer(logger)),
  );

  // Hono keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: VOICE_TRANSCRIPTION_API_ROUTES };
}

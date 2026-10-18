import { Effect, Layer } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import {
  VoiceTranscriptionGroup,
  TranscriptConfigured,
  VoiceSettingsOwnerLimit,
} from '@zilar/api-contract';
import { SqlClient } from 'effect/sql';
import { type ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import {
  handler,
  mountApi,
  schemaErrorLayer,
  sessionLayer,
  type EffectApiMount,
  CurrentUser,
  httpErrorResponse,
  requestIdOf,
} from '../effect/http-core';
import { runSql } from '../effect/sql';
import { limiter, type RateLimiter } from '../rate-limit';
import {
  defaultAudioFetcher,
  defaultTranscriber,
  fetchAndTranscribe,
  shareInFlight,
} from './pipeline';
import { silentVerificationWav, TranscriptionProviderError } from './provider';
import {
  normalizeBaseUrl,
  toInternalUploadUrl,
  voiceTranscriptUrlHash,
  type VoiceTranscriptionRoutesDependencies,
} from './routes';
import {
  deleteVoiceTranscriptionSettings,
  getVoiceTranscriptionSettings,
  saveVoiceTranscriptionSettings,
  VOICE_TRANSCRIPTION_DEFAULT_MODEL,
  type VoiceTranscriptionSettings,
} from './settings';
import { isInstanceOwner } from '../setup/instance-owner';
import { settingsCipherFor } from '../setup/settings';
import { HttpServerRequest } from 'effect/http';
// The transcript route answers 501 when no endpoint is configured, before the payload is
// decoded. `requires: CurrentUser` keeps the session 401 first.
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

// The owner settings answer 404 for non-owners and 429 over budget before the payload is
// decoded; the handler drops both checks so the budget is charged once.
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

const VoiceTranscriptionApi = HttpApi.make('voiceTranscription').add(VoiceTranscriptionGroup);

export function createVoiceTranscriptionApi(
  deps: VoiceTranscriptionRoutesDependencies,
): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  const transcriptLimiter = deps.transcriptLimiter ?? limiter('voiceTranscript', now);
  const settingsLimiter = deps.settingsLimiter ?? limiter('voiceTranscriptOwner', now);
  const fetchAudio = deps.audioFetcher ?? defaultAudioFetcher;
  const transcribe = deps.transcribe ?? defaultTranscriber();
  // ejabberd resolves the upload vhost from the Host header, so the internal fetch carries
  // the public host, not `ejabberd:5280`.
  const uploadHost = new URL(deps.config.PUBLIC_URL).host;
  // In-flight transcripts by URL hash: simultaneous taps share one fetch + provider call
  // instead of double-billing. The DB row, re-checked under the lock at insert time, is the
  // durable cache; this map only dedupes the overlap window.
  const inFlight = shareInFlight();

  function storedSettings(): Promise<VoiceTranscriptionSettings | null> {
    return getVoiceTranscriptionSettings(deps.db, settingsCipherFor(deps.config)).catch(() => {
      // Fail closed (reads as "not configured"), but say so with a fixed message: no error
      // text, no key.
      deps.logger.warn({}, 'voice transcription settings could not be read');
      return null;
    });
  }

  const groupLayer = HttpApiBuilder.group(VoiceTranscriptionApi, 'voiceTranscription', (handlers) =>
    handlers
      .handle(
        'status',
        handler(logger, async () => ({ enabled: (await storedSettings()) !== null })),
      )
      // The 501 for an unconfigured server already ran in endpoint middleware. Validation
      // runs before the rate limiter, so malformed requests never burn budget; cached hits
      // still count.
      .handle(
        'transcript',
        handler(logger, async (request, user) => {
          const settings = await storedSettings();
          if (settings === null) {
            throw new HttpError(
              501,
              'transcription_not_configured',
              'Voice transcription is not set up on this server',
            );
          }
          // The URL is validated against this install first: same origin as `PUBLIC_URL`,
          // path under `/upload/`.
          const internalUrl = toInternalUploadUrl(request.payload.url, deps.config);
          if (internalUrl === null) {
            throw new HttpError(400, 'invalid_request', 'The voice URL is not from this server');
          }
          if (!transcriptLimiter.allow(user.id)) {
            throw new HttpError(429, 'rate_limited', 'Too many attempts, try again later');
          }
          const urlHash = voiceTranscriptUrlHash(request.payload.url);
          const db: ServerDatabase = deps.db;

          // Fast path: the durable cache, no lock. Misses share one in-flight call per hash;
          // the lock only covers the re-check and insert, with `onConflictDoNothing` as the
          // backstop.
          const [fastHit] = await runSql(
            db,
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              return yield* sql<{
                text: string;
              }>`SELECT text FROM voice_transcripts WHERE url_hash = ${urlHash} LIMIT 1`;
            }),
          );
          // Every request is audited, cache hits included: ids and the URL hash only, never
          // the text.
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

          const text = await inFlight.run(urlHash, () =>
            fetchAndTranscribe({
              db,
              urlHash,
              internalUrl,
              uploadHost,
              settings,
              fetchAudio,
              transcribe,
            }),
          );

          auditRequested();
          return { text };
        }),
      )
      // Owner-only, verified with a 1-second silent WAV before storing. The owner 404 and
      // the settings budget already ran in middleware, so the handler starts at the base-URL
      // check.
      .handle(
        'setSettings',
        handler(logger, async (request, user) => {
          const { normalized, problem } = normalizeBaseUrl(request.payload.baseUrl);
          if (normalized === null) {
            throw new HttpError(400, 'invalid_request', problem ?? 'The base URL is not valid');
          }
          const candidate: VoiceTranscriptionSettings = {
            baseUrl: normalized,
            apiKey: request.payload.apiKey ?? null,
            model: request.payload.model ?? VOICE_TRANSCRIPTION_DEFAULT_MODEL,
          };

          // The silent WAV goes through the real provider path, so an accepted clip proves
          // URL, key and model work. A refusal answers 422 `endpoint_rejected`, a transport
          // failure 422 `endpoint_unreachable`, and nothing is stored either way.
          const verificationError: unknown = await transcribe({
            baseUrl: candidate.baseUrl,
            apiKey: candidate.apiKey,
            model: candidate.model,
            audio: silentVerificationWav(),
            filename: 'verify.wav',
            mime: 'audio/wav',
          }).then(
            () => null,
            (error: unknown) => error,
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
          await saveVoiceTranscriptionSettings(deps.db, cipher, candidate);

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
      )
      .handle(
        'removeSettings',
        handler(logger, async (_request, user) => {
          if (!(await isInstanceOwner(deps.db, user.id, logger))) {
            throw new HttpError(404, 'not_found', 'Not found');
          }
          await deleteVoiceTranscriptionSettings(deps.db);
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
      ),
  );

  const apiLayer = HttpApiBuilder.layer(VoiceTranscriptionApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(transcriptConfiguredLayer(storedSettings)),
    Layer.provide(
      voiceSettingsOwnerLimitLayer(
        (userId) => isInstanceOwner(deps.db, userId, logger),
        settingsLimiter,
      ),
    ),
    Layer.provide(schemaErrorLayer(logger)),
  );

  return mountApi(VoiceTranscriptionApi, apiLayer);
}

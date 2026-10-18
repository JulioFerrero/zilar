import { Effect, Layer } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { TranscriptConfigured, VoiceSettingsOwnerLimit } from '@zilar/api-contract';
import { HttpError } from '../errors';
import { CurrentUser, httpErrorResponse, requestIdOf } from '../effect/http-core';
import type { RateLimiter } from '../rate-limit';
import type { VoiceTranscriptionSettings } from './settings';

// The transcript route answers 501 when no endpoint is configured, before the payload is
// decoded. `requires: CurrentUser` keeps the session 401 first.
export function transcriptConfiguredLayer(
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
export function voiceSettingsOwnerLimitLayer(
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

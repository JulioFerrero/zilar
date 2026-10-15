// The AI API declaration and the two layers the mount applies to it (T-1457):
// the schema-error renderer that turns a malformed body into 400
// `invalid_request`, and the availability gate that answers 503 before any
// payload is decoded. Split out of `api.ts` so the routes file stays inside the
// 400-line budget.

import { Effect, Layer } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { HttpApi } from 'effect/http-api';
import { AisConfigured, AisGroup } from '@zilar/api-contract';
import { HttpError } from '../errors';
import { httpErrorResponse, requestIdOf, type SchemaErrorRender } from '../effect/http-core';
import type { KeyCipher } from '../connections/crypto';

export const renderSchemaError: SchemaErrorRender = (error) =>
  Effect.succeed(
    new HttpError(400, 'invalid_request', error.cause.message || 'Invalid AI request'),
  );

// Runs the 503 availability gate before the payload is decoded, exactly like
// the old routes' `requireConfigured()` -> `safeParse` order: a malformed
// body on an unconfigured server still answers 503, not 400. `requires:
// CurrentUser` is satisfied by `Session`. The gate needs no decode, so it
// also covers the no-payload writes (delete) for free; stop/resume/machine
// need only the DB and skip it, as they did before. The only requirement is
// the key cipher (to seal provider keys at rest).

export function configuredLayer(deps: { cipher?: KeyCipher }): Layer.Layer<AisConfigured> {
  return Layer.succeed(
    AisConfigured,
    AisConfigured.of(
      Effect.fnUntraced(function* (httpEffect) {
        if (deps.cipher === undefined) {
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

export const AisApi = HttpApi.make('ais').add(AisGroup);

// The AI API declaration and the two mount layers: the schema-error renderer
// (malformed body → 400) and the 503 gate that runs before any payload decode.

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

// The 503 gate runs before the payload is decoded, so a malformed body on an
// unconfigured server answers 503, not 400.

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

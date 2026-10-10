// The schema-error layer of the chain A groups that moved into the shared
// contract (T-0892): a params, query or payload decode failure renders as 400
// `invalid_request` through the shared envelope, exactly like
// `schemaErrorLayer` in `../effect/http-core`.

import { Effect, Layer } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { HttpApiMiddleware } from 'effect/http-api';
import { ChainASchemaErrors } from '@zilar/api-contract';
import type { Logger } from 'pino';
import { HttpError } from '../errors';
import { failureResponse, requestIdOf } from '../effect/http-core';

export function chainASchemaErrorLayer(logger: Logger): Layer.Layer<ChainASchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(ChainASchemaErrors, (error) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return failureResponse(
        logger,
        requestIdOf(request),
        new HttpError(400, 'invalid_request', error.cause.message),
      );
    }),
  );
}

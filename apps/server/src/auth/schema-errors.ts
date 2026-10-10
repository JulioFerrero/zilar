// The layer of chain D's schema-error tag (T-0895), used by the groups that
// moved into `@zilar/api-contract`: a params, query or payload decode failure
// renders as 400 `invalid_request` through the shared envelope, exactly like
// `schemaErrorLayer` in `effect/http-core.ts` (that file is outside this task's
// scope, so the contract has its own tag, `ChainDSchemaErrors`).

import { Effect, Layer } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { HttpApiMiddleware } from 'effect/http-api';
import { ChainDSchemaErrors } from '@zilar/api-contract';
import type { Logger } from 'pino';
import { failureResponse, requestIdOf } from '../effect/http-core';
import { HttpError } from '../errors';

export function contractSchemaErrorLayer(logger: Logger): Layer.Layer<ChainDSchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(ChainDSchemaErrors, (error) =>
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

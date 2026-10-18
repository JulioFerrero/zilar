import { Effect, Schema } from 'effect';
import {
  FetchHttpClient,
  HttpBody,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
} from 'effect/http';
import { HttpApiClient } from 'effect/http-api';
import { ZilarApi } from './api';
import { ApiError, apiErrorFromBody } from './errors';

export type ZilarClient = HttpApiClient.ForApi<typeof ZilarApi, ApiError>;

const NETWORK_ERROR_MESSAGE = 'Could not reach the server';
const INVALID_RESPONSE_MESSAGE = 'The server sent an unexpected response';
const UNSENT_REQUEST_MESSAGE = 'The request could not be sent';

// The function is read per request, so a test that stubs `globalThis.fetch` later still reaches its stub.
export function withFetch(fetch: typeof globalThis.fetch) {
  return <E, R>(client: HttpClient.HttpClient.With<E, R>): HttpClient.HttpClient.With<E, R> =>
    client.pipe(
      HttpClient.transform((effect) => Effect.provideService(effect, FetchHttpClient.Fetch, fetch)),
    );
}

// A JSON payload reaches `fetch` as the string it was built from.
function withTextBody(request: HttpClientRequest.HttpClientRequest) {
  const body = request.body;
  if (body._tag !== 'Uint8Array' || body.text === undefined) {
    return request;
  }
  return HttpClientRequest.setBody(
    request,
    HttpBody.raw(body.text, { contentType: body.contentType }),
  );
}

export function withApiErrors<E, R>(client: HttpClient.HttpClient.With<E, R>) {
  return client.pipe(
    HttpClient.transformResponse(
      Effect.flatMap((response) =>
        response.status < 400
          ? Effect.succeed(response)
          : response.json.pipe(
              Effect.orElseSucceed(() => null),
              Effect.flatMap((raw) => Effect.fail(apiErrorFromBody(response.status, raw))),
            ),
      ),
    ),
  );
}

// A success body the contract cannot decode fails with `invalid_response`; any status of 400 or more fails with the envelope's `ApiError`.
export function makeZilarClient<E, R>(
  httpClient: HttpClient.HttpClient.With<E, R>,
  options: { readonly baseUrl?: string } = {},
) {
  return HttpApiClient.makeWith(ZilarApi, {
    httpClient: withApiErrors(
      httpClient.pipe(
        HttpClient.mapRequest((request) => withTextBody(HttpClientRequest.acceptJson(request))),
      ),
    ),
    transformResponse: (effect) =>
      Effect.mapError(effect, (error) =>
        Schema.isSchemaError(error)
          ? new ApiError(200, 'invalid_response', INVALID_RESPONSE_MESSAGE)
          : error,
      ),
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
  });
}

// A schema error here comes from encoding the request: the input the server would answer with 400 `invalid_request` is rejected before it is sent.
export function toApiError(cause: unknown): ApiError {
  if (cause instanceof ApiError) {
    return cause;
  }
  if (HttpClientError.isHttpClientError(cause)) {
    const reason = cause.reason;
    switch (reason._tag) {
      case 'TransportError':
        return new ApiError(0, 'network_error', NETWORK_ERROR_MESSAGE);
      case 'EncodeError':
      case 'InvalidUrlError':
        return new ApiError(0, 'invalid_request', UNSENT_REQUEST_MESSAGE);
      default:
        return new ApiError(reason.response.status, 'invalid_response', INVALID_RESPONSE_MESSAGE);
    }
  }
  if (Schema.isSchemaError(cause)) {
    return new ApiError(400, 'invalid_request', cause.message);
  }
  return new ApiError(0, 'request_failed', UNSENT_REQUEST_MESSAGE);
}

export function runApi<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(Effect.mapError(effect, toApiError));
}

// `fetchPinned` GETs one validated address with SNI/`Host` kept as the hostname;
// `FetchFailed` is the request's failure mode.
import { request as httpsRequest } from 'node:https';
import { Data, Effect, type Effect as EffectType } from 'effect';
import { classifyFetchFailureReason, type FetchFailureReason } from './guarded-fetch-helpers';

export class FetchFailed extends Data.TaggedError('FetchFailed')<{
  readonly reason: FetchFailureReason;
}> {}

export type PinnedFetchResult = {
  response: { status: number; rawContentType: string | null; location: string | null };
  raw: Uint8Array;
};

export function classifyFetchError(error: unknown): FetchFailed {
  return new FetchFailed({ reason: classifyFetchFailureReason(error) });
}

export function fetchPinned(
  url: URL,
  address: string,
  options: {
    headers: Record<string, string>;
    timeoutMs: number;
    maxResponseBytes: number;
    truncateAtMax: boolean;
  },
): EffectType.Effect<PinnedFetchResult, FetchFailed> {
  const { timeoutMs, maxResponseBytes, truncateAtMax } = options;
  const headers: Record<string, string> = {
    accept: '*/*',
    connection: 'close',
    ...options.headers,
  };
  const path = `${url.pathname}${url.search}`;
  return Effect.callback<PinnedFetchResult, FetchFailed>((resume) => {
    // The body end, a truncation, a stream error and a request error race here.
    let settled = false;
    const succeed = (result: PinnedFetchResult): void => {
      if (!settled) {
        settled = true;
        resume(Effect.succeed(result));
      }
    };
    const failWith = (error: unknown): void => {
      if (!settled) {
        settled = true;
        resume(Effect.fail(classifyFetchError(error)));
      }
    };
    const req = httpsRequest(
      {
        host: address,
        port: 443,
        path: path.length === 0 ? '/' : path,
        method: 'GET',
        servername: url.hostname,
        headers: {
          host: url.hostname,
          ...headers,
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const rawContentType = Array.isArray(res.headers['content-type'])
          ? (res.headers['content-type'][0] ?? null)
          : (res.headers['content-type'] ?? null);
        const rawLocation = Array.isArray(res.headers.location)
          ? (res.headers.location[0] ?? null)
          : (res.headers.location ?? null);
        if (status >= 300 && status < 400) {
          res.resume();
          succeed({
            response: { status, rawContentType, location: rawLocation },
            raw: new Uint8Array(0),
          });
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        let stopped = false;
        const body = (): PinnedFetchResult => ({
          response: { status, rawContentType, location: rawLocation },
          raw: new Uint8Array(Buffer.concat(chunks)),
        });
        res.on('data', (chunk: Buffer) => {
          if (settled || stopped) {
            return;
          }
          if (total + chunk.length > maxResponseBytes) {
            if (truncateAtMax) {
              // The `<head>` is in the first few KB; the rest is not needed.
              chunks.push(chunk.subarray(0, maxResponseBytes - total));
              succeed(body());
              req.destroy();
              return;
            }
            stopped = true;
            req.destroy(new Error('response too large'));
            return;
          }
          total += chunk.length;
          chunks.push(chunk);
        });
        res.on('end', () => {
          if (!stopped) {
            succeed(body());
          }
        });
        res.on('error', (error: Error) => {
          failWith(error);
        });
      },
    );
    // An idle timeout only; the hard deadline is the `timeoutOrElse` in `guardedGetEffect`.
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('fetch timeout'));
    });
    req.on('timeout', () => {
      req.destroy(new Error('fetch timeout'));
    });
    req.on('error', (error: Error) => {
      failWith(error);
    });
    req.end();
    // Interruption destroys the request, so its socket is released.
    return Effect.sync(() => {
      req.destroy();
    });
  });
}

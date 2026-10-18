import { request as httpsRequest } from 'node:https';
import { Effect } from 'effect';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config/load';
import type { GifProvider } from './provider';

// Media previews fan out per search, so the proxy gets its own high budget. The token
// already binds user, URL and expiry; the limiter only caps volume.
export const GIF_PAGE_LIMIT = 25;
export const GIF_PROXY_MAX_BYTES = 8 * 1024 * 1024;
export const GIF_PROXY_TIMEOUT_MS = 10_000;
export const GIF_MEDIA_TYPES = ['image/gif', 'image/webp', 'video/mp4', 'video/webm'] as const;

export interface GifsRoutesDependencies {
  auth: Auth;
  config: ServerConfig;
  logger: Logger;
  provider?: GifProvider | undefined;
  mediaFetcher?: MediaFetch | undefined;
  now?: () => number;
}

export interface MediaFetch {
  (url: URL, address: string): Promise<{ status: number; contentType: string; body: Uint8Array }>;
}

interface ProxiedMedia {
  status: number;
  contentType: string;
  body: Uint8Array;
}

// Fetch one provider URL with the full SSRF guard: resolve every address, reject any
// non-public one, connect to the validated IP with SNI and Host kept, follow no redirects.
export function fetchProxiedMediaEffect(
  url: URL,
  address: string,
  options: { timeoutMs: number; maxBytes: number; port?: number },
): Effect.Effect<ProxiedMedia, Error> {
  return Effect.callback<ProxiedMedia, Error>((resume) => {
    const path = `${url.pathname}${url.search}`;
    let settled = false;
    const finish = (effect: Effect.Effect<ProxiedMedia, Error>): void => {
      if (settled) return;
      settled = true;
      resume(effect);
    };

    const req = httpsRequest(
      {
        host: address,
        port: options.port ?? 443,
        path: path.length === 0 ? '/' : path,
        method: 'GET',
        servername: url.hostname,
        headers: { host: url.hostname, accept: '*/*', connection: 'close' },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          finish(Effect.fail(new Error('redirect refused')));
          return;
        }
        const contentType = (res.headers['content-type'] ?? '').split(';')[0]?.trim() ?? '';
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > options.maxBytes) {
            req.destroy(new Error('response too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          finish(
            Effect.succeed({ status, contentType, body: new Uint8Array(Buffer.concat(chunks)) }),
          ),
        );
        res.on('error', (error: Error) => finish(Effect.fail(error)));
      },
    );
    req.setTimeout(options.timeoutMs, () => req.destroy(new Error('fetch timeout')));
    req.on('timeout', () => req.destroy(new Error('fetch timeout')));
    req.on('error', (error: Error) => finish(Effect.fail(error)));
    req.end();

    return Effect.sync(() => {
      if (settled) return;
      settled = true;
      req.destroy();
    });
  });
}

export function fetchProxiedMedia(
  url: URL,
  address: string,
  options: { timeoutMs: number; maxBytes: number; port?: number },
): Promise<ProxiedMedia> {
  return Effect.runPromise(fetchProxiedMediaEffect(url, address, options));
}

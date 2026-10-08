import { request as httpsRequest } from 'node:https';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { GifProvider } from './provider';

export const GIF_RATE_LIMIT_MAX = 30;
export const GIF_RATE_LIMIT_WINDOW_MS = 60 * 1000;
// Media previews fan out per search: one page mints 25 tokens and every
// rendered cell fetches, so the proxy gets its own much higher budget. The
// token already binds user + URL + expiry; the limiter only caps volume.
export const GIF_MEDIA_RATE_LIMIT_MAX = 600;
export const GIF_PAGE_LIMIT = 25;
export const GIF_PROXY_MAX_BYTES = 8 * 1024 * 1024;
export const GIF_PROXY_TIMEOUT_MS = 10_000;
export const GIF_MEDIA_TYPES = ['image/gif', 'image/webp', 'video/mp4', 'video/webm'] as const;

export interface GifsRoutesDependencies {
  auth: Auth;
  config: ServerConfig;
  logger: Logger;
  /** Injected in tests; production builds the real adapter from config. */
  provider?: GifProvider | undefined;
  /** Injected in tests so the media fetch never touches the network. */
  mediaFetcher?: MediaFetch | undefined;
  /** Injected in tests so token expiry and the rate window can advance. */
  now?: () => number;
}

export interface MediaFetch {
  (url: URL, address: string): Promise<{ status: number; contentType: string; body: Uint8Array }>;
}

// The media proxy fetches one provider URL with the full SSRF guard: resolve
// every address, reject if any is non-public, connect to the validated IP
// with SNI and Host kept as the hostname, follow no redirects.
export async function fetchProxiedMedia(
  url: URL,
  address: string,
  options: { timeoutMs: number; maxBytes: number; port?: number },
): Promise<{ status: number; contentType: string; body: Uint8Array }> {
  return new Promise((resolve, reject) => {
    const path = `${url.pathname}${url.search}`;
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
          reject(new Error('redirect refused'));
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
          resolve({ status, contentType, body: new Uint8Array(Buffer.concat(chunks)) }),
        );
        res.on('error', (error: Error) => reject(error));
      },
    );
    req.setTimeout(options.timeoutMs, () => req.destroy(new Error('fetch timeout')));
    req.on('timeout', () => req.destroy(new Error('fetch timeout')));
    req.on('error', (error: Error) => reject(error));
    req.end();
  });
}

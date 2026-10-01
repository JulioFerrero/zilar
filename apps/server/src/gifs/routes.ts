import { createHmac } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerConfig } from '../config';
import { HttpError } from '../errors';
import { createRateLimiter } from '../rate-limit';
import { classifyIp } from '../sandbox/ip-guard';
import { GIPHY_MEDIA_HOSTS, createGiphyProvider } from './giphy';
import type { GifItem, GifProvider } from './provider';
import { createGifTokenIssuer, type GifTokenIssuer } from './token';

export const GIF_RATE_LIMIT_MAX = 30;
export const GIF_RATE_LIMIT_WINDOW_MS = 60 * 1000;
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

const searchQuerySchema = z
  .object({
    q: z.string().min(1).max(100),
    pos: z.string().max(128).optional(),
  })
  .strict();

const trendingQuerySchema = z
  .object({
    pos: z.string().max(128).optional(),
  })
  .strict();

interface MediaFetch {
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

async function resolvePublicAddress(host: string): Promise<string | undefined> {
  let addresses: string[];
  try {
    const records = await dnsLookup(host, { all: true });
    addresses = records.map((record) => record.address);
  } catch {
    return undefined;
  }
  if (addresses.length === 0) {
    return undefined;
  }
  for (const address of addresses) {
    if (isIP(address) === 0 || classifyIp(address) === 'blocked') {
      return undefined;
    }
  }
  return addresses[0];
}

function providerConfigured(config: ServerConfig): boolean {
  return config.GIF_PROVIDER !== undefined && config.GIF_API_KEY !== undefined;
}

function tokenSecret(config: ServerConfig): string {
  // The session/signing secret signs media tokens. Bound per feature so a
  // token minted elsewhere can never pass as a GIF token.
  return createHmac('sha256', config.BETTER_AUTH_SECRET).update('gifs-media').digest('hex');
}

export function createGifsRoutes(deps: GifsRoutesDependencies): Hono {
  const routes = new Hono();
  const now = deps.now ?? Date.now;
  const limiter = createRateLimiter({
    max: GIF_RATE_LIMIT_MAX,
    windowMs: GIF_RATE_LIMIT_WINDOW_MS,
    now,
  });

  const issuer: GifTokenIssuer = createGifTokenIssuer({ secret: tokenSecret(deps.config), now });
  const mediaFetcher: MediaFetch =
    deps.mediaFetcher ??
    ((requestUrl, validated) =>
      fetchProxiedMedia(requestUrl, validated, {
        timeoutMs: GIF_PROXY_TIMEOUT_MS,
        maxBytes: GIF_PROXY_MAX_BYTES,
      }));

  function providerFor(): GifProvider {
    if (deps.provider !== undefined) {
      return deps.provider;
    }
    const apiKey = deps.config.GIF_API_KEY;
    const configured = deps.config.GIF_PROVIDER !== undefined && apiKey !== undefined;
    if (!configured || apiKey === undefined) {
      throw new HttpError(501, 'gifs_unavailable', 'GIF search is not configured');
    }
    return createGiphyProvider({
      apiKey,
      rating: deps.config.GIF_RATING,
    });
  }

  function shape(item: GifItem, userId: string): Record<string, unknown> {
    const mediaUrl = item.mp4Url ?? item.gifUrl;
    if (mediaUrl === undefined) {
      return {};
    }
    return {
      id: item.id,
      title: item.title,
      mediaToken: issuer.issue(userId, mediaUrl),
      ...(item.mp4Url === undefined ? { kind: 'image' } : { kind: 'video' }),
      width: item.width,
      height: item.height,
      ...(item.sizeBytes === undefined ? {} : { sizeBytes: item.sizeBytes }),
    };
  }

  function searchBody(
    userId: string,
    page: { items: GifItem[]; nextPos?: string | undefined },
  ): Record<string, unknown> {
    return {
      items: page.items.flatMap((item) => {
        const shaped = shape(item, userId);
        return Object.keys(shaped).length === 0 ? [] : [shaped];
      }),
      ...(page.nextPos === undefined ? {} : { nextPos: page.nextPos }),
    };
  }

  routes.get('/gifs/search', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (!providerConfigured(deps.config) && deps.provider === undefined) {
      throw new HttpError(501, 'gifs_unavailable', 'GIF search is not configured');
    }
    if (!limiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many GIF requests, try again later');
    }
    const parsed = searchQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      throw new HttpError(400, 'invalid_request', 'Invalid GIF search');
    }
    const start = performance.now();
    const page = await providerFor().search(parsed.data.q, {
      limit: GIF_PAGE_LIMIT,
      ...(parsed.data.pos === undefined ? {} : { pos: parsed.data.pos }),
    });
    // The log carries counts and durations only — never the search text.
    deps.logger.info(
      {
        userId: user.id,
        results: page.items.length,
        durationMs: Math.round(performance.now() - start),
      },
      'gifs_search',
    );
    return c.json(searchBody(user.id, page));
  });

  routes.get('/gifs/trending', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (!providerConfigured(deps.config) && deps.provider === undefined) {
      throw new HttpError(501, 'gifs_unavailable', 'GIF search is not configured');
    }
    if (!limiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many GIF requests, try again later');
    }
    const parsed = trendingQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      throw new HttpError(400, 'invalid_request', 'Invalid GIF request');
    }
    const start = performance.now();
    const page = await providerFor().trending({
      limit: GIF_PAGE_LIMIT,
      ...(parsed.data.pos === undefined ? {} : { pos: parsed.data.pos }),
    });
    deps.logger.info(
      {
        userId: user.id,
        results: page.items.length,
        durationMs: Math.round(performance.now() - start),
      },
      'gifs_trending',
    );
    return c.json(searchBody(user.id, page));
  });

  routes.get('/gifs/media/:token', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (!providerConfigured(deps.config) && deps.provider === undefined) {
      throw new HttpError(501, 'gifs_unavailable', 'GIF search is not configured');
    }
    if (!limiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many GIF requests, try again later');
    }
    let rawToken: string;
    try {
      rawToken = decodeURIComponent(c.req.param('token'));
    } catch {
      throw new HttpError(404, 'not_found', 'GIF media not found');
    }
    const mediaUrl = issuer.verify(rawToken, user.id);
    if (mediaUrl === undefined) {
      // An unknown token and one the caller may not use answer the same 404.
      throw new HttpError(404, 'not_found', 'GIF media not found');
    }
    let url: URL;
    try {
      url = new URL(mediaUrl);
    } catch {
      throw new HttpError(404, 'not_found', 'GIF media not found');
    }
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
      throw new HttpError(404, 'not_found', 'GIF media not found');
    }
    const host = url.hostname.toLowerCase();
    if (!(GIPHY_MEDIA_HOSTS as readonly string[]).includes(host)) {
      throw new HttpError(404, 'not_found', 'GIF media not found');
    }
    const address = await resolvePublicAddress(host);
    if (address === undefined) {
      throw new HttpError(404, 'not_found', 'GIF media not found');
    }
    const fetcher: MediaFetch = mediaFetcher;
    let fetched: { status: number; contentType: string; body: Uint8Array };
    try {
      fetched = await fetcher(url, address);
    } catch {
      throw new HttpError(502, 'gif_media_failed', 'Could not load the GIF media');
    }
    if (fetched.status < 200 || fetched.status >= 300) {
      throw new HttpError(502, 'gif_media_failed', 'Could not load the GIF media');
    }
    if (!(GIF_MEDIA_TYPES as readonly string[]).includes(fetched.contentType)) {
      throw new HttpError(502, 'gif_media_failed', 'Could not load the GIF media');
    }
    return new Response(fetched.body, {
      status: 200,
      headers: {
        'content-type': fetched.contentType,
        'content-length': String(fetched.body.byteLength),
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, max-age=86400',
      },
    });
  });

  return routes;
}

// effect-plain: a fetch-compatible node:http(s) request; the Promise is the fetch contract
// T-1396: the only way a request to a user's OpenAI-compatible base URL
// leaves the server. Every call re-resolves the host, refuses an address the
// IP guard blocks (so DNS rebinding to a private address is caught here, not
// only at save), and connects to the pinned public address with the base
// host's SNI and `Host` — the same pinning `web-tools/guarded-fetch.ts` and
// `sandbox/host-fetch.ts` use. Redirects are never followed: a 3xx is handed
// back to the caller unchanged.
import type { ClientRequest, IncomingMessage } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import type { FetchLike } from '../ai/http';
import type { ModelTarget } from '../ai/providers';
import { resolveAll, resolvePublic, type ResolveHost } from './base-url';

/** The socket half, separated so a test can answer without a real socket. */
export type PinnedTransport = (url: URL, address: string, init: RequestInit) => Promise<Response>;

export interface PinnedFetchOptions {
  /** DNS seam; defaults to `node:dns`. Tests inject one. */
  resolver?: ResolveHost;
  /** Transport seam; defaults to a pinned `node:http(s)` request. */
  transport?: PinnedTransport;
  /**
   * Test only: accept an address the IP guard blocks, so a model-call test can
   * reach a loopback fake server. Production callers never set it and the
   * guard stays on by default.
   */
  allowBlockedAddresses?: boolean;
}

// A refused request. The message is fixed: it never carries the URL or the
// resolved address, so it cannot leak an internal host name into a log.
export class PinnedFetchError extends Error {
  constructor() {
    super('The base URL request was refused');
    this.name = 'PinnedFetchError';
  }
}

function bareHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
}

// Resolves the host to the address to connect to. The public check is
// `resolvePublic` (skipped only for the test-only `allowBlockedAddresses`).
async function pinnedAddress(
  host: string,
  resolver: ResolveHost,
  allowBlockedAddresses: boolean,
): Promise<string> {
  if (!allowBlockedAddresses) {
    try {
      return await resolvePublic(host, resolver);
    } catch {
      throw new PinnedFetchError();
    }
  }
  const addresses = await resolver(host).catch(() => {
    throw new PinnedFetchError();
  });
  const first = addresses[0];
  if (first === undefined || isIP(first) === 0) {
    throw new PinnedFetchError();
  }
  return first;
}

function writeBody(request: ClientRequest, body: RequestInit['body']): void {
  if (body === undefined || body === null) {
    request.end();
    return;
  }
  if (typeof body === 'string') {
    request.end(body);
    return;
  }
  if (body instanceof Uint8Array) {
    request.end(Buffer.from(body));
    return;
  }
  if (body instanceof ArrayBuffer) {
    request.end(Buffer.from(body));
    return;
  }
  if (typeof body === 'object' && 'getReader' in body) {
    // The model call streams its request too: pipe the fetch body straight to
    // the socket, which ends the request when the source ends.
    Readable.fromWeb(body as ReadableStream<Uint8Array>).pipe(request);
    return;
  }
  if (typeof body === 'object' && 'arrayBuffer' in body) {
    void (body as Blob).arrayBuffer().then(
      (bytes) => request.end(Buffer.from(bytes)),
      () => request.destroy(),
    );
    return;
  }
  request.end();
}

function responseFrom(res: IncomingMessage): Response {
  const status = res.statusCode ?? 502;
  const headers = new Headers();
  for (const [name, value] of Object.entries(res.headers)) {
    if (value === undefined) {
      continue;
    }
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  // A null-body status must not carry a body (the Fetch `Response` rules).
  const nullBody = status === 204 || status === 205 || status === 304;
  return new Response(nullBody ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>), {
    status,
    headers,
    ...(res.statusMessage === undefined ? {} : { statusText: res.statusMessage }),
  });
}

// Connects to the pinned address while SNI and `Host` keep the host name, so
// the certificate matches and a virtual host routes correctly.
const defaultTransport: PinnedTransport = (url, address, init) => {
  const secure = url.protocol === 'https:';
  const requestFn: typeof httpsRequest = secure
    ? httpsRequest
    : (httpRequest as unknown as typeof httpsRequest);
  const port = url.port === '' ? (secure ? 443 : 80) : Number(url.port);
  const headers = new Headers(init.headers);
  headers.set('host', url.host);

  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const fail = (): void => {
      if (!settled) {
        settled = true;
        reject(new PinnedFetchError());
      }
    };
    const signal = init.signal ?? undefined;
    if (signal?.aborted === true) {
      fail();
      return;
    }
    const request = requestFn(
      {
        host: address,
        port,
        path: `${url.pathname}${url.search}`,
        method: init.method ?? 'GET',
        ...(secure ? { servername: url.hostname } : {}),
        headers: Object.fromEntries(headers),
      },
      (res) => {
        if (!settled) {
          settled = true;
          resolve(responseFrom(res));
        }
      },
    );
    signal?.addEventListener('abort', () => request.destroy(new PinnedFetchError()), {
      once: true,
    });
    request.on('error', fail);
    writeBody(request, init.body);
  });
};

/**
 * A `fetch` for one validated base URL. A request to any other host is
 * refused before a socket is opened; each allowed request re-resolves the
 * host and pins the connection to a public address.
 */
export function createPinnedFetch(baseUrl: string, options: PinnedFetchOptions = {}): FetchLike {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' && base.protocol !== 'http:') {
    throw new PinnedFetchError();
  }
  const host = bareHost(base.hostname);
  const basePort = base.port === '' ? (base.protocol === 'https:' ? '443' : '80') : base.port;
  const resolver = options.resolver ?? resolveAll;
  const transport = options.transport ?? defaultTransport;
  const allowBlockedAddresses = options.allowBlockedAddresses === true;

  return async (input, init) => {
    const url = new URL(input);
    const port = url.port === '' ? (url.protocol === 'https:' ? '443' : '80') : url.port;
    if (bareHost(url.hostname) !== host || port !== basePort) {
      throw new PinnedFetchError();
    }
    const address = await pinnedAddress(host, resolver, allowBlockedAddresses);
    return transport(url, address, init);
  };
}

/**
 * The fetch a model call uses for a custom provider: a pinned fetch for
 * `openai-compatible`, `undefined` for every other provider (whose clients use
 * their own fixed transport). Kept here so the call path cannot forget the
 * guard. `options` is a test seam (an injected resolver / the allow-private
 * hook); production passes none.
 */
export function customProviderFetch(
  target: ModelTarget,
  options?: PinnedFetchOptions,
): FetchLike | undefined {
  if (target.provider !== 'openai-compatible' || target.apiUrl === undefined) {
    return undefined;
  }
  return createPinnedFetch(target.apiUrl, options);
}

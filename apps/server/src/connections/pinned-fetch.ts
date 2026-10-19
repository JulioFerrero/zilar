// effect-plain: a fetch-compatible node:http(s) request; the Promise is the fetch contract
// The only way a request to a user's base URL leaves the server. Every call
// re-resolves the host and refuses a blocked address, so DNS rebinding is caught
// here too, then connects to the pinned public address with the base host's SNI
// and `Host`. Redirects are never followed: a 3xx is returned unchanged.
import type { ClientRequest, IncomingMessage } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import type { FetchLike } from '../ai/http';
import type { ModelTarget } from '../ai/providers';
import { bareHost, resolveAll, resolvePublic, type ResolveHost } from './base-url';

export type PinnedTransport = (url: URL, address: string, init: RequestInit) => Promise<Response>;

export interface PinnedFetchOptions {
  resolver?: ResolveHost;
  transport?: PinnedTransport;
  /** Test only: accept a blocked address so a test can reach a loopback fake. */
  allowBlockedAddresses?: boolean;
}

// The message is fixed: it never carries the URL or resolved address, so it
// cannot leak an internal host name into a log.
export class PinnedFetchError extends Error {
  constructor() {
    super('The base URL request was refused');
    this.name = 'PinnedFetchError';
  }
}

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
    // Pipe the fetch body straight to the socket, which ends with the source.
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

// SNI and `Host` keep the host name, so the certificate matches and a virtual
// host routes correctly.
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
 * A request to any other host is refused before a socket opens; each allowed
 * request re-resolves the host and pins a public address.
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
 * A pinned fetch for `openai-compatible`, `undefined` for every other provider
 * (whose clients use their own fixed transport), so the call path cannot forget
 * the guard.
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

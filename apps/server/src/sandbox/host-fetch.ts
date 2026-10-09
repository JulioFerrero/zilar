import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Data, Effect } from 'effect';
import { classifyIp, isIpLiteral } from './ip-guard';

// The narrow bridge between the sandbox and the network. Every rule lives
// here so it can be unit-tested with fakes; the VM layer only passes the
// validated address through.
export interface HostFetchRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyPresent: boolean;
}

export interface ValidatedFetchRequest {
  url: URL;
  address: string;
}

export interface FetchResponse {
  status: number;
  body: Uint8Array;
}

export type HostFetcher = (request: ValidatedFetchRequest) => Promise<FetchResponse>;

export type DnsResolver = (host: string) => Promise<string[]>;

export interface FetchBridgeOptions {
  allowedHosts: readonly string[];
  fetchTimeoutMs: number;
  maxResponseBytes: number;
  // Note: maxFetches is enforced in the worker (it owns the counter), not
  // here, so it is intentionally not part of these options.
  resolver?: DnsResolver | undefined;
}

export type FetchCheck =
  { ok: true; request: ValidatedFetchRequest } | { ok: false; message: string };

export const TOOL_USER_AGENT = 'ZilarTool/1';

export function normalizeHost(host: string): string {
  const trimmed = host.trim();
  const withoutDot = trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
  try {
    const parsed = new URL(`https://${withoutDot}`);
    const hostname = parsed.hostname.endsWith('.') ? parsed.hostname.slice(0, -1) : parsed.hostname;
    return hostname.toLowerCase();
  } catch {
    return withoutDot.toLowerCase();
  }
}

export function isHostAllowed(host: string, allowedHosts: readonly string[]): boolean {
  const normalized = normalizeHost(host);
  if (normalized.length === 0 || isIpLiteral(normalized)) {
    return false;
  }
  return allowedHosts.some((entry) => normalizeHost(entry) === normalized);
}
// A failed check carries the exact message the sandbox shows the tool.
class FetchRejected extends Data.TaggedError('FetchRejected')<{ readonly message: string }> {}

const defaultResolver: DnsResolver = (name) =>
  dnsLookup(name, { all: true }).then((records) => records.map((record) => record.address));

const checkFetchRequest = Effect.fnUntraced(function* (
  raw: HostFetchRequest,
  options: FetchBridgeOptions,
): Effect.fn.Return<ValidatedFetchRequest, FetchRejected> {
  const method = raw.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return yield* new FetchRejected({ message: 'method not allowed' });
  }
  if (raw.bodyPresent) {
    return yield* new FetchRejected({ message: 'request body not allowed' });
  }
  const url = yield* Effect.try({
    try: () => new URL(raw.url),
    catch: () => new FetchRejected({ message: 'invalid url' }),
  });
  if (url.protocol !== 'https:') {
    return yield* new FetchRejected({ message: 'only https is allowed' });
  }
  if (url.username !== '' || url.password !== '') {
    return yield* new FetchRejected({ message: 'credentials in url are not allowed' });
  }
  if (url.port !== '' && url.port !== '443') {
    return yield* new FetchRejected({ message: 'explicit port is not allowed' });
  }
  const host = url.hostname;
  if (host.length === 0) {
    return yield* new FetchRejected({ message: 'invalid url' });
  }
  if (!isHostAllowed(host, options.allowedHosts)) {
    return yield* new FetchRejected({ message: `host not allowed: ${host}` });
  }
  const resolver: DnsResolver = options.resolver ?? defaultResolver;
  const addresses = yield* Effect.tryPromise({
    try: () => resolver(host),
    catch: () => new FetchRejected({ message: `host not allowed: ${host}` }),
  });
  if (addresses.length === 0) {
    return yield* new FetchRejected({ message: `host not allowed: ${host}` });
  }
  for (const address of addresses) {
    if (isIP(address) === 0 || classifyIp(address) === 'blocked') {
      return yield* new FetchRejected({ message: `host not allowed: ${host}` });
    }
  }
  return { url, address: addresses[0] as string };
});

export function validateFetchRequestEffect(
  raw: HostFetchRequest,
  options: FetchBridgeOptions,
): Effect.Effect<FetchCheck> {
  return checkFetchRequest(raw, options).pipe(
    Effect.map((request): FetchCheck => ({ ok: true, request })),
    Effect.catchTag('FetchRejected', (rejected) =>
      Effect.succeed<FetchCheck>({ ok: false, message: rejected.message }),
    ),
  );
}

export function validateFetchRequest(
  raw: HostFetchRequest,
  options: FetchBridgeOptions,
): Promise<FetchCheck> {
  return Effect.runPromise(validateFetchRequestEffect(raw, options));
}

export function createDefaultFetcher(options: {
  fetchTimeoutMs: number;
  maxResponseBytes: number;
}): HostFetcher {
  return (request: ValidatedFetchRequest) =>
    fetchPinnedHttps(request.url, request.address, options);
}

// The request is an `Effect.callback`: the first outcome wins, and an
// interrupted fiber destroys the request so its socket is released.
export function fetchPinnedHttpsEffect(
  url: URL,
  address: string,
  options: { fetchTimeoutMs: number; maxResponseBytes: number; port?: number },
): Effect.Effect<FetchResponse, Error> {
  return Effect.callback<FetchResponse, Error>((resume) => {
    let settled = false;
    const finish = (effect: Effect.Effect<FetchResponse, Error>): void => {
      if (settled) return;
      settled = true;
      resume(effect);
    };
    const path = `${url.pathname}${url.search}`;
    const port = options.port ?? 443;
    const req = httpsRequest(
      {
        host: address,
        port,
        path: path.length === 0 ? '/' : path,
        method: 'GET',
        servername: url.hostname,
        headers: {
          host: url.hostname,
          accept: '*/*',
          'user-agent': TOOL_USER_AGENT,
          connection: 'close',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          finish(Effect.succeed({ status, body: new Uint8Array(0) }));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > options.maxResponseBytes) {
            req.destroy(new Error('response too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          finish(Effect.succeed({ status, body: new Uint8Array(Buffer.concat(chunks)) }));
        });
        res.on('error', (error: Error) => {
          finish(Effect.fail(error));
        });
      },
    );
    req.setTimeout(options.fetchTimeoutMs, () => {
      req.destroy(new Error('fetch timeout'));
    });
    req.on('timeout', () => {
      req.destroy(new Error('fetch timeout'));
    });
    req.on('error', (error: Error) => {
      finish(Effect.fail(error));
    });
    req.end();

    return Effect.sync(() => {
      if (settled) return;
      settled = true;
      req.destroy();
    });
  });
}

export function fetchPinnedHttps(
  url: URL,
  address: string,
  options: { fetchTimeoutMs: number; maxResponseBytes: number; port?: number },
): Promise<FetchResponse> {
  return Effect.runPromise(fetchPinnedHttpsEffect(url, address, options));
}

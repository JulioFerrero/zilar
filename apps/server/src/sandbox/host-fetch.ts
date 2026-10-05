import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
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

export async function validateFetchRequest(
  raw: HostFetchRequest,
  options: FetchBridgeOptions,
): Promise<FetchCheck> {
  const method = raw.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return { ok: false, message: 'method not allowed' };
  }
  if (raw.bodyPresent) {
    return { ok: false, message: 'request body not allowed' };
  }
  let url: URL;
  try {
    url = new URL(raw.url);
  } catch {
    return { ok: false, message: 'invalid url' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, message: 'only https is allowed' };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, message: 'credentials in url are not allowed' };
  }
  if (url.port !== '' && url.port !== '443') {
    return { ok: false, message: 'explicit port is not allowed' };
  }
  const host = url.hostname;
  if (host.length === 0) {
    return { ok: false, message: 'invalid url' };
  }
  if (!isHostAllowed(host, options.allowedHosts)) {
    return { ok: false, message: `host not allowed: ${host}` };
  }
  const resolver: DnsResolver =
    options.resolver ??
    (async (name: string) => {
      const records = await dnsLookup(name, { all: true });
      return records.map((record) => record.address);
    });
  let addresses: string[];
  try {
    addresses = await resolver(host);
  } catch {
    return { ok: false, message: `host not allowed: ${host}` };
  }
  if (addresses.length === 0) {
    return { ok: false, message: `host not allowed: ${host}` };
  }
  for (const address of addresses) {
    if (isIP(address) === 0 || classifyIp(address) === 'blocked') {
      return { ok: false, message: `host not allowed: ${host}` };
    }
  }
  return { ok: true, request: { url, address: addresses[0] as string } };
}

export function createDefaultFetcher(options: {
  fetchTimeoutMs: number;
  maxResponseBytes: number;
}): HostFetcher {
  return async (request: ValidatedFetchRequest) =>
    fetchPinnedHttps(request.url, request.address, options);
}

export function fetchPinnedHttps(
  url: URL,
  address: string,
  options: { fetchTimeoutMs: number; maxResponseBytes: number; port?: number },
): Promise<FetchResponse> {
  return new Promise<FetchResponse>((resolve, reject) => {
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
          resolve({ status, body: new Uint8Array(0) });
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
          resolve({ status, body: new Uint8Array(Buffer.concat(chunks)) });
        });
        res.on('error', (error: Error) => {
          reject(error);
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
      reject(error);
    });
    req.end();
  });
}

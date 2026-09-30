// T-0125: shared building blocks for the gateway-level web tools.
//
// Everything these tools return is untrusted content (a web page can say
// "ignore your instructions"). Adapters put it in `modelText` only; the
// gateway already wraps it in `<untrusted-tool-output>`, audits action
// names and args hashes only, and never logs URLs, queries or content.
// Summaries below carry host names and counts, never page content.
//
// The network path reuses the sandbox's guard: DNS resolved with
// `dnsLookup`, every address classified by `classifyIp` (private,
// loopback, link-local, 6to4, Teredo and friends refused), the request
// pinned to the validated IP with SNI/`Host` kept as the hostname.
// Redirects are never followed — a 3xx is returned as a result the model
// can retry with the new URL (same checks apply to the retry).
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { classifyIp, isIpLiteral } from '../sandbox/ip-guard';

export const WEB_FETCH_TIMEOUT_MS = 10_000;
export const WEB_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const WEB_MAX_DECODE_CHARS = 2 * 1024 * 1024;

// Only these response bodies are read. Anything else (images, PDFs,
// binaries) returns `unsupported content type <type>`. The check runs on
// the media type only (before `;`), case-insensitive.
export const WEB_ALLOWED_CONTENT_TYPES: readonly string[] = [
  'text/html',
  'text/plain',
  'application/json',
  'application/xml',
  'text/xml',
  'application/rss+xml',
  'application/atom+xml',
  'text/csv',
];

export type DnsLookup = (host: string) => Promise<string[]>;

export interface GuardedGetOptions {
  allowedHosts: readonly string[];
  headers?: Record<string, string>;
  resolver?: DnsLookup;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetcher?: PinnedFetcher;
}

export type PinnedFetcher = (
  url: URL,
  address: string,
  options: { headers: Record<string, string>; timeoutMs: number; maxResponseBytes: number },
) => Promise<{
  response: { status: number; rawContentType: string | null; location: string | null };
  raw: Uint8Array;
}>;

export interface GuardedBody {
  status: number;
  contentType: string | null;
  location: string | null;
  text: string;
}

// A failed get. `summary` is fixed wording only; `detail` carries text that
// came from the remote server (a redirect's `Location`) and must reach the
// model only as `modelText`, never in a summary.
export type GuardedGetResult =
  { ok: true; body: GuardedBody } | { ok: false; summary: string; detail?: string };

// Read-only, GET only, https only. No cookies, no auth headers, no body.
export async function guardedGet(
  rawUrl: string,
  options: GuardedGetOptions,
): Promise<GuardedGetResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, summary: 'invalid url' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, summary: 'only https urls are allowed' };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, summary: 'credentials in url are not allowed' };
  }
  if (url.port !== '' && url.port !== '443') {
    return { ok: false, summary: 'explicit port is not allowed' };
  }
  const host = url.hostname.toLowerCase();
  if (host.length === 0 || isIpLiteral(host)) {
    return { ok: false, summary: 'host not allowed' };
  }
  if (!options.allowedHosts.some((entry) => entry.toLowerCase() === host)) {
    return { ok: false, summary: 'host not allowed' };
  }
  const resolver: DnsLookup =
    options.resolver ??
    (async (name: string) => {
      const records = await dnsLookup(name, { all: true });
      return records.map((record) => record.address);
    });
  let addresses: string[];
  try {
    addresses = await resolver(host);
  } catch {
    return { ok: false, summary: 'host not allowed' };
  }
  if (addresses.length === 0) {
    return { ok: false, summary: 'host not allowed' };
  }
  for (const address of addresses) {
    if (isIP(address) === 0 || classifyIp(address) === 'blocked') {
      return { ok: false, summary: 'host not allowed' };
    }
  }
  const pinned = addresses[0] as string;
  let response: { status: number; rawContentType: string | null; location: string | null };
  let raw: Uint8Array;
  try {
    ({ response, raw } = await (options.fetcher ?? fetchPinned)(url, pinned, {
      headers: options.headers ?? {},
      timeoutMs: options.timeoutMs ?? WEB_FETCH_TIMEOUT_MS,
      maxResponseBytes: options.maxResponseBytes ?? WEB_MAX_RESPONSE_BYTES,
    }));
  } catch (error) {
    return { ok: false, summary: explainFetchError(error) };
  }
  if (response.status >= 300 && response.status < 400) {
    return response.location
      ? {
          ok: false,
          summary: 'not followed: redirect',
          detail: `The page redirects to ${response.location.slice(0, 2048)}. Call the tool again with that URL if you want to follow it.`,
        }
      : { ok: false, summary: `not followed: redirect (status ${response.status})` };
  }
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, summary: `fetch failed with status ${response.status}` };
  }
  const mediaType = mediaTypeOf(response.rawContentType);
  if (mediaType === null || !WEB_ALLOWED_CONTENT_TYPES.includes(mediaType)) {
    return { ok: false, summary: `unsupported content type ${mediaType ?? 'unknown'}` };
  }
  return {
    ok: true,
    body: {
      status: response.status,
      contentType: mediaType,
      location: response.location,
      text: decodeCapped(raw),
    },
  };
}

function explainFetchError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout/i.test(message)) {
    return 'fetch timed out';
  }
  if (/too large|too big/i.test(message)) {
    return 'response too large';
  }
  return 'fetch failed';
}

function mediaTypeOf(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  const mediaType = raw.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType === undefined || mediaType.length === 0 || !mediaType.includes('/')) {
    return null;
  }
  return mediaType;
}

// Decodes the body as UTF-8 (replacing undecodable bytes) with a hard cap
// so a hostile page cannot blow up the server's memory at decode time.
export function decodeCapped(raw: Uint8Array): string {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(raw);
  if (text.length <= WEB_MAX_DECODE_CHARS) {
    return text;
  }
  return text.slice(0, WEB_MAX_DECODE_CHARS);
}

function fetchPinned(
  url: URL,
  address: string,
  options: { headers: Record<string, string>; timeoutMs: number; maxResponseBytes: number },
): Promise<{
  response: { status: number; rawContentType: string | null; location: string | null };
  raw: Uint8Array;
}> {
  const { timeoutMs, maxResponseBytes } = options;
  const headers: Record<string, string> = {
    accept: '*/*',
    connection: 'close',
    ...options.headers,
  };
  return new Promise((resolve, reject) => {
    const path = `${url.pathname}${url.search}`;
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
          resolve({
            response: { status, rawContentType, location: rawLocation },
            raw: new Uint8Array(0),
          });
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxResponseBytes) {
            req.destroy(new Error('response too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          resolve({
            response: { status, rawContentType, location: rawLocation },
            raw: new Uint8Array(Buffer.concat(chunks)),
          });
        });
        res.on('error', (error: Error) => {
          reject(error);
        });
      },
    );
    // `setTimeout` on the request is an idle timeout, so a server that drips
    // one byte at a time could hold the connection for ever: a hard overall
    // deadline ends the request whatever the server does.
    const deadline = setTimeout(() => {
      req.destroy(new Error('fetch timeout'));
    }, timeoutMs);
    deadline.unref();
    req.on('close', () => {
      clearTimeout(deadline);
    });
    req.setTimeout(timeoutMs, () => {
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

// Truncates model-facing text, appending `…` when cut. The audit path
// never sees this text; summaries (the audited side) are built from host
// names and counts only.
export function truncateChars(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…`;
}

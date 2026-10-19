// effect-plain: pure URL and DNS checks over an injected Promise resolver; no Effect
// The shape check at save, and the DNS check that runs again on every request
// (in `pinned-fetch.ts`), so a name that later resolves private is refused.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { classifyIp, isIpLiteral } from '@zilar/desk/egress/ip-guard';

/** Resolves a hostname to every address it names, in the resolver's order. */
export type ResolveHost = (host: string) => Promise<readonly string[]>;

export const resolveAll: ResolveHost = async (host) => {
  const records = await lookup(host, { all: true });
  return records.map((record) => record.address);
};

/** Matches the `provider_connections.base_url` check in migration 0058. */
export const BASE_URL_MAX_LENGTH = 300;

// The message is fixed, so no resolver detail (which could carry an internal
// name) ever leaks.
export class BaseUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BaseUrlError';
  }
}

const INVALID = 'The base URL must be a public https address';

/** Lowercase, strip IPv6 brackets: `[::1]` and `::1` classify the same. */
export function bareHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
}

/**
 * https only, no credentials, query or fragment, port 443, no localhost or IP
 * literal; a bare host gets `/v1`.
 */
export function validateBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new BaseUrlError(INVALID);
  }
  if (url.protocol !== 'https:') {
    throw new BaseUrlError(INVALID);
  }
  if (url.username !== '' || url.password !== '') {
    throw new BaseUrlError(INVALID);
  }
  if (url.search !== '' || url.hash !== '') {
    throw new BaseUrlError(INVALID);
  }
  if (url.port !== '' && url.port !== '443') {
    throw new BaseUrlError(INVALID);
  }
  const host = bareHost(url.hostname);
  if (host.length === 0 || host === 'localhost' || isIpLiteral(host)) {
    throw new BaseUrlError(INVALID);
  }
  const path = url.pathname.replace(/\/+$/, '');
  const normalized = `https://${host}${path === '' ? '/v1' : path}`;
  if (normalized.length > BASE_URL_MAX_LENGTH) {
    throw new BaseUrlError(INVALID);
  }
  return normalized;
}

/**
 * Every address must be public (an IP literal is refused), so one private
 * answer rejects the host; pins the first.
 */
export async function resolvePublic(
  host: string,
  resolver: ResolveHost = resolveAll,
): Promise<string> {
  const normalized = bareHost(host);
  if (normalized.length === 0 || isIpLiteral(normalized)) {
    throw new BaseUrlError(INVALID);
  }
  let addresses: readonly string[];
  try {
    addresses = await resolver(normalized);
  } catch {
    throw new BaseUrlError(INVALID);
  }
  if (addresses.length === 0) {
    throw new BaseUrlError(INVALID);
  }
  for (const address of addresses) {
    if (isIP(address) === 0 || classifyIp(address) === 'blocked') {
      throw new BaseUrlError(INVALID);
    }
  }
  return addresses[0] as string;
}

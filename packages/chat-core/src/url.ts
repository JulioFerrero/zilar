// effect-plain: total parse helpers; a failed parse is a value, not an error
// Parsed here with a strict regex instead of the runtime's global `URL`: React Native ships a partial `URL`,
// and a runtime without a usable one made every media URL untrusted, downgrading every history image to a file card.
export interface ParsedUrl {
  readonly protocol: string;
  readonly hostname: string;
  readonly origin: string;
  readonly pathname: string;
  toString(): string;
}

const ABSOLUTE_URL = /^([a-zA-Z][a-zA-Z\d+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?[^#]*)?(?:#.*)?$/;

// Schemes whose URLs need a non-empty host; `mailto:` and the like have none.
const AUTHORITY_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:', 'ftp:']);

const DEFAULT_PORTS: Readonly<Record<string, string>> = {
  'http:': '80',
  'https:': '443',
  'ws:': '80',
  'wss:': '443',
  'ftp:': '21',
};

function splitHostPort(hostPort: string): { host: string; port: string } {
  if (hostPort.startsWith('[')) {
    const end = hostPort.indexOf(']');
    if (end === -1) {
      return { host: hostPort, port: '' };
    }
    const rest = hostPort.slice(end + 1);
    return { host: hostPort.slice(0, end + 1), port: rest.startsWith(':') ? rest.slice(1) : '' };
  }
  const colon = hostPort.indexOf(':');
  if (colon === -1) {
    return { host: hostPort, port: '' };
  }
  return { host: hostPort.slice(0, colon), port: hostPort.slice(colon + 1) };
}

// Returns `undefined` for a relative or malformed input instead of throwing.
export function parseUrl(text: string): ParsedUrl | undefined {
  const trimmed = text.trim();
  const match = ABSOLUTE_URL.exec(trimmed);
  const scheme = match?.[1];
  if (match === null || scheme === undefined) {
    return undefined;
  }
  const protocol = `${scheme.toLowerCase()}:`;
  const authority = match[2];
  const rawPath = match[3] ?? '';
  const hasAuthority = authority !== undefined;
  if (!hasAuthority && AUTHORITY_SCHEMES.has(protocol)) {
    return undefined;
  }
  // Fetch layers (WHATWG `URL`, OkHttp) treat `\` as `/` in a special-scheme URL, so an authority containing one resolves to a different host.
  // Fail closed instead of trusting a host the fetch will not use (e.g. `https://evil.test\@chat.zilar.app/x`).
  if (AUTHORITY_SCHEMES.has(protocol) && trimmed.includes('\\')) {
    return undefined;
  }
  let hostname = '';
  let port = '';
  if (hasAuthority) {
    // A URL may carry `user:pass@` before the host; the host is what follows the last `@`.
    const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
    const split = splitHostPort(hostPort);
    hostname = split.host.toLowerCase();
    port = split.port;
    if (hostname === '') {
      return undefined;
    }
  }
  const pathname = hasAuthority ? (rawPath === '' ? '/' : rawPath) : rawPath;
  const effectivePort = port === '' || DEFAULT_PORTS[protocol] === port ? '' : `:${port}`;
  const origin = hostname === '' ? '' : `${protocol}//${hostname}${effectivePort}`;
  return {
    protocol,
    hostname,
    origin,
    pathname,
    toString: () => trimmed,
  };
}

export function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

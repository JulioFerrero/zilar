// effect-plain: total parse helpers; a failed parse is a value, not an error
/**
 * The parts of an absolute URL the app reads. Parsed here with a strict regex
 * instead of the runtime's global `URL`: React Native ships a partial `URL`
 * (its accessors only match `http(s)://`), and a runtime without a usable
 * `URL` made every media URL untrusted, which downgraded every history image
 * to a "Not loaded: untrusted address" file card. See `parseUrl`.
 */
export interface ParsedUrl {
  /** Lowercased scheme with its colon, e.g. `https:`. */
  readonly protocol: string;
  /** Lowercased host without the port, e.g. `chat.zilar.app`. Empty without an authority. */
  readonly hostname: string;
  /** Scheme and authority, e.g. `https://chat.zilar.app`. Empty without an authority. */
  readonly origin: string;
  /** Path; `/` for an authority URL with no path. */
  readonly pathname: string;
  /** The original text, so callers can hand the URL back unchanged. */
  toString(): string;
}

// scheme ":" ["//" authority] path ["?" query] ["#" fragment]
const ABSOLUTE_URL = /^([a-zA-Z][a-zA-Z\d+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?[^#]*)?(?:#.*)?$/;

// Schemes whose URLs need a non-empty host. `mailto:` and the like have none.
const AUTHORITY_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:', 'ftp:']);

// Ports a scheme answers on by default, dropped from `origin` like a `URL`.
const DEFAULT_PORTS: Readonly<Record<string, string>> = {
  'http:': '80',
  'https:': '443',
  'ws:': '80',
  'wss:': '443',
  'ftp:': '21',
};

/** Splits `[::1]:8080`, `host:8080` or `host` into its host and port. */
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

/**
 * Parses an absolute URL into the parts the app reads, without the runtime's
 * `URL` (a partial polyfill on React Native, and absent on some runtimes).
 * Returns `undefined` for a relative or malformed input instead of throwing.
 */
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
  // Fetch layers (WHATWG `URL`, OkHttp) treat `\` as `/` in a special-scheme
  // URL, so an authority that contains one resolves to a different host than
  // the one read here. Fail closed instead of trusting a host the fetch will
  // not use (e.g. `https://evil.test\@chat.zilar.app/x`).
  if (AUTHORITY_SCHEMES.has(protocol) && trimmed.includes('\\')) {
    return undefined;
  }
  let hostname = '';
  let port = '';
  if (hasAuthority) {
    // A URL may carry `user:pass@` before the host; the host is what follows
    // the last `@`.
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

/** Decodes a URI component. Returns the input unchanged when it is not valid percent-encoding. */
export function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

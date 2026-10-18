// effect-plain: a plain `node:http`/`node:net` host daemon, no Effect runtime. CONNECT
// tunnels and plain HTTP GET/HEAD are pinned to the classified address (plan §5.1-5.3).
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { lookup as dnsLookup } from 'node:dns/promises';
import { connect as netConnect, isIP } from 'node:net';
import type { Duplex } from 'node:stream';
import { classifyIp, isIpLiteral } from './ip-guard';
import type { EgressLog } from './log';
import type { DeskRegistry, DeskRegistration } from './registry';

// effect-plain: the egress policy is pure DNS + classification over an injected
// resolver; it opens no socket itself, so it stays easy to test.
export type ResolveHost = (host: string) => Promise<readonly string[]>;

/** The ports the proxy ever connects to: 443 to tunnel, 80 for plain HTTP. */
const ALLOWED_PORTS: readonly number[] = [443, 80];

/** The fixed decision codes; they reach the host log and never a URL. */
type DenyReason =
  | 'host'
  | 'ip-literal'
  | 'port'
  | 'host-not-allowed'
  | 'resolve-failed'
  | 'no-address'
  | 'blocked-address';

interface TargetCheck {
  readonly host: string;
  readonly port: number;
  /** `null` is the open web; a list — even an empty one — is the per-desk allowlist. */
  readonly allowedHosts: readonly string[] | null;
}

type TargetDecision =
  | { readonly allow: true; readonly address: string }
  | { readonly allow: false; readonly reason: DenyReason };

interface PolicyOptions {
  readonly resolver?: ResolveHost | undefined;
  readonly allowedPorts?: readonly number[] | undefined;
}

const resolveAll: ResolveHost = async (host) => {
  const records = await dnsLookup(host, { all: true });
  return records.map((record) => record.address);
};

/** Lowercase, drop one trailing dot: `Example.COM.` and `example.com` match. */
function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}

function isHostAllowed(host: string, allowedHosts: readonly string[]): boolean {
  const normalized = normalizeHost(host);
  return allowedHosts.some((entry) => normalizeHost(entry) === normalized);
}

const deny = (reason: DenyReason): TargetDecision => ({ allow: false, reason });

/**
 * Refuses IP literals, other ports, hosts outside the allowlist and any host with
 * a blocked address; every resolved address is checked, so rebinding fails.
 */
export async function checkTarget(
  target: TargetCheck,
  options: PolicyOptions = {},
): Promise<TargetDecision> {
  const resolver = options.resolver ?? resolveAll;
  const allowedPorts = options.allowedPorts ?? ALLOWED_PORTS;
  const host = normalizeHost(target.host);
  if (host.length === 0) {
    return deny('host');
  }
  if (isIpLiteral(host)) {
    return deny('ip-literal');
  }
  if (!allowedPorts.includes(target.port)) {
    return deny('port');
  }
  if (target.allowedHosts !== null && !isHostAllowed(host, target.allowedHosts)) {
    return deny('host-not-allowed');
  }
  let addresses: readonly string[];
  try {
    addresses = await resolver(host);
  } catch {
    return deny('resolve-failed');
  }
  if (addresses.length === 0) {
    return deny('no-address');
  }
  for (const address of addresses) {
    if (isIP(address) === 0 || classifyIp(address) === 'blocked') {
      return deny('blocked-address');
    }
  }
  return { allow: true, address: addresses[0] as string };
}

const AUTHENTICATE = 'Basic realm="zilar-desk-egress"';

/** Returns extra headers for a forwarded request, host-scoped; none today. */
export type BeforeForward = (deskId: string, host: string) => Readonly<Record<string, string>>;

const noInjection: BeforeForward = () => ({});

export interface EgressProxyOptions {
  readonly registry: DeskRegistry;
  readonly log: EgressLog;
  readonly resolver?: ResolveHost;
  readonly beforeForward?: BeforeForward;
}

export interface EgressProxy {
  readonly server: Server;
  listen(port: number, host: string): Promise<void>;
  close(): Promise<void>;
}

/** Reads the desk credential from `Proxy-Authorization: Basic base64(id:secret)`. */
function authenticate(
  header: string | string[] | undefined,
  registry: DeskRegistry,
): DeskRegistration | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined) {
    return null;
  }
  const space = value.indexOf(' ');
  if (space < 0 || value.slice(0, space).toLowerCase() !== 'basic') {
    return null;
  }
  const decoded = Buffer.from(value.slice(space + 1).trim(), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) {
    return null;
  }
  return registry.authenticate(decoded.slice(0, colon), decoded.slice(colon + 1));
}

function plainHost(hostname: string): string {
  return hostname.replace(/^\[/, '').replace(/\]$/, '');
}

function sendHttp(res: ServerResponse, status: number, extraHeaders: Record<string, string>): void {
  res.writeHead(status, extraHeaders);
  res.end();
}

function sendRaw(socket: Duplex, status: number, reason: string): void {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
}

/** The proxy's copy of the request headers: no credentials, no hop-by-hop. */
function forwardHeaders(message: IncomingMessage, host: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(message.headers)) {
    if (value === undefined) {
      continue;
    }
    const lower = name.toLowerCase();
    if (lower === 'proxy-authorization' || lower === 'proxy-connection' || lower === 'connection') {
      continue;
    }
    headers[lower] = Array.isArray(value) ? value.join(', ') : value;
  }
  headers['host'] = host;
  return headers;
}

/** Plain `http://` GET/HEAD forward, allowed on port 80 only (plan §5.2). */
async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: EgressProxyOptions,
  registration: DeskRegistration,
  logDenied: (reason: string) => void,
): Promise<void> {
  let url: URL;
  try {
    url = new URL(req.url ?? '');
  } catch {
    logDenied('bad-url');
    sendHttp(res, 400, {});
    return;
  }
  const host = plainHost(url.hostname);
  if (url.username !== '' || url.password !== '') {
    logDenied('credentials');
    sendHttp(res, 403, {});
    return;
  }
  if (url.protocol !== 'http:') {
    logDenied('scheme');
    sendHttp(res, 403, {});
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    logDenied('method');
    sendHttp(res, 403, {});
    return;
  }
  const port = url.port === '' ? 80 : Number(url.port);
  const decision = await checkTarget(
    { host, port, allowedHosts: registration.allowedHosts },
    // Plain-HTTP forward is port 80 only; TLS on 443 goes through the CONNECT tunnel.
    { resolver: options.resolver, allowedPorts: [80] },
  );
  if (!decision.allow) {
    logDenied(decision.reason);
    sendHttp(res, 403, {});
    return;
  }
  const beforeForward = options.beforeForward ?? noInjection;
  const headers = {
    ...forwardHeaders(req, url.host),
    ...beforeForward(registration.deskId, host),
  };
  let bytes = 0;
  let logged = false;
  const logOnce = (reason: string): void => {
    if (logged) {
      return;
    }
    logged = true;
    options.log.record({
      deskId: registration.deskId,
      host,
      allowed: true,
      reason,
      bytes,
    });
  };
  const upstream = httpRequest(
    {
      host: decision.address,
      port,
      method: req.method,
      path: `${url.pathname}${url.search}`,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
      });
      upstreamRes.on('end', () => {
        logOnce('ok');
      });
      upstreamRes.pipe(res);
    },
  );
  upstream.on('error', () => {
    logOnce('upstream-error');
    if (!res.headersSent) {
      sendHttp(res, 502, {});
    } else {
      res.destroy();
    }
  });
  req.pipe(upstream);
}

async function handleConnect(
  req: IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
  options: EgressProxyOptions,
  registration: DeskRegistration,
  logDenied: (reason: string) => void,
): Promise<void> {
  let target: URL;
  try {
    // `https://` keeps a `:80` authority from being normalized away as the
    // scheme's default port, so the 443-only check below sees the real port.
    target = new URL(`https://${req.url ?? ''}`);
  } catch {
    logDenied('bad-url');
    sendRaw(clientSocket, 400, 'Bad Request');
    return;
  }
  const host = plainHost(target.hostname);
  if (target.username !== '' || target.password !== '') {
    logDenied('credentials');
    sendRaw(clientSocket, 403, 'Forbidden');
    return;
  }
  const port = target.port === '' ? 443 : Number(target.port);
  const decision = await checkTarget(
    { host, port, allowedHosts: registration.allowedHosts },
    // A CONNECT tunnel is TLS only: 443. Plain HTTP on 80 uses the forward above.
    { resolver: options.resolver, allowedPorts: [443] },
  );
  if (!decision.allow) {
    logDenied(decision.reason);
    sendRaw(clientSocket, 403, 'Forbidden');
    return;
  }
  const upstream = netConnect({ host: decision.address, port });
  let bytes = 0;
  let logged = false;
  const done = (allowed: boolean, reason: string): void => {
    if (logged) {
      return;
    }
    logged = true;
    options.log.record({ deskId: registration.deskId, host, allowed, reason, bytes });
  };
  upstream.on('connect', () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length > 0) {
      upstream.write(head);
    }
    upstream.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
    });
    clientSocket.pipe(upstream);
    upstream.pipe(clientSocket);
  });
  upstream.on('close', () => {
    done(true, 'ok');
    clientSocket.destroy();
  });
  upstream.on('error', () => {
    done(true, 'upstream-error');
    clientSocket.destroy();
  });
  clientSocket.on('error', () => {
    upstream.destroy();
  });
}

export function createEgressProxy(options: EgressProxyOptions): EgressProxy {
  const sockets = new Set<Duplex>();
  const server = createServer((req, res) => {
    const registration = authenticate(req.headers['proxy-authorization'], options.registry);
    if (registration === null) {
      sendHttp(res, 407, { 'proxy-authenticate': AUTHENTICATE });
      return;
    }
    const logDenied = (reason: string): void => {
      let host = '';
      try {
        host = plainHost(new URL(req.url ?? '').hostname);
      } catch {
        host = '';
      }
      options.log.record({ deskId: registration.deskId, host, allowed: false, reason, bytes: 0 });
    };
    void handleRequest(req, res, options, registration, logDenied).catch(() => {
      if (!res.headersSent) {
        sendHttp(res, 502, {});
      }
    });
  });
  server.on('connect', (req, clientSocket, head) => {
    sockets.add(clientSocket);
    clientSocket.on('close', () => sockets.delete(clientSocket));
    const registration = authenticate(req.headers['proxy-authorization'], options.registry);
    if (registration === null) {
      sendRaw(clientSocket, 407, 'Proxy Authentication Required');
      return;
    }
    const logDenied = (reason: string): void => {
      let host = '';
      try {
        host = plainHost(new URL(`http://${req.url ?? ''}`).hostname);
      } catch {
        host = '';
      }
      options.log.record({ deskId: registration.deskId, host, allowed: false, reason, bytes: 0 });
    };
    void handleConnect(req, clientSocket, head, options, registration, logDenied).catch(() => {
      sendRaw(clientSocket, 502, 'Bad Gateway');
    });
  });
  return {
    server,
    listen(port, host) {
      return new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve());
      });
    },
    close() {
      for (const socket of sockets) {
        socket.destroy();
      }
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

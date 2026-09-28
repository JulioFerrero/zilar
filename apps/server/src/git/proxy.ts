import type { Context, Handler } from 'hono';
import { isPushAllowed } from './branches';
import { HttpError } from '../errors';
import type { GitHubAppTokenClient } from './token';

// A forward proxy for the git smart HTTP protocol. The client (git) speaks
// HTTP git to us, we check a push against the branch rule before anything is
// forwarded, then we forward to GitHub with the installation token injected.
//
// The client never supplies a token, a remote URL or any credential: the
// upstream origin and the token both come from the server, and any inbound
// `Authorization` header is stripped so it cannot be smuggled through.

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export const DEFAULT_GIT_PATH_PREFIX = '/git';

export interface GitProxyDependencies {
  /** The AI this proxy instance is scoped to; pushes are limited to `agent/<ai>/*`. */
  aiName: string;
  tokenClient: GitHubAppTokenClient;
  /** Origin only, e.g. `https://github.com`; the repo path comes from the request. */
  upstreamBaseUrl: string;
  /** Request path prefix to strip before forwarding, e.g. `/git`. */
  pathPrefix?: string;
  fetch?: FetchLike;
}

type GitService = 'receive-pack' | 'upload-pack' | 'other';

const REFS_HEADS_PREFIX = 'refs/heads/';

// Hop-by-hop headers must not be forwarded verbatim. Authorization is stripped
// here so a caller cannot smuggle a credential; the token is injected below.
const HOP_BY_HOP_HEADERS = [
  'authorization',
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'upgrade',
  'proxy-authorization',
  'te',
];

const packetDecoder = new TextDecoder();

function serviceFor(url: URL): GitService {
  const pathname = url.pathname;
  if (pathname.endsWith('/git-receive-pack')) {
    return 'receive-pack';
  }
  if (pathname.endsWith('/git-upload-pack')) {
    return 'upload-pack';
  }
  const service = url.searchParams.get('service');
  if (service === 'git-receive-pack') {
    return 'receive-pack';
  }
  if (service === 'git-upload-pack') {
    return 'upload-pack';
  }
  return 'other';
}

function branchNameFor(ref: string): string | null {
  if (!ref.startsWith(REFS_HEADS_PREFIX)) {
    return null;
  }
  return ref.slice(REFS_HEADS_PREFIX.length);
}

function isAllowedRef(aiName: string, ref: string): boolean {
  const branch = branchNameFor(ref);
  if (branch === null) {
    return false;
  }
  return isPushAllowed(aiName, branch).allowed;
}

type ParseResult = { refs: string[]; malformed: boolean };

// Extracts ref names from a receive-pack request body. The body is a sequence
// of pkt-lines, each `old-oid SP new-oid SP ref-name` (the first carrying
// capabilities after a NUL), then a flush packet and the pack data. Parsing
// stops at the flush packet, before the binary pack. Any body that is not a
// clean, complete sequence of ref commands is reported as malformed, so the
// caller can fail closed rather than guess.
function parseRefUpdates(body: Uint8Array): ParseResult {
  const refs: string[] = [];
  let offset = 0;
  let sawFlush = false;

  while (offset + 4 <= body.length) {
    const length = Number.parseInt(packetDecoder.decode(body.subarray(offset, offset + 4)), 16);
    if (Number.isNaN(length)) {
      return { refs, malformed: true };
    }
    if (length === 0) {
      sawFlush = true;
      offset += 4;
      break;
    }
    if (length < 4 || offset + length > body.length) {
      return { refs, malformed: true };
    }
    const payload = packetDecoder.decode(body.subarray(offset + 4, offset + length));
    const command = payload.split('\0')[0] ?? '';
    const fields = command.split(' ');
    const ref = fields[2];
    if (fields.length !== 3 || ref === undefined || ref.length === 0) {
      return { refs, malformed: true };
    }
    refs.push(ref);
    offset += length;
  }

  return sawFlush ? { refs, malformed: false } : { refs, malformed: true };
}

function buildUpstreamUrl(baseUrl: string, inbound: URL, pathPrefix: string): URL {
  const base = baseUrl.replace(/\/+$/, '');
  let path = inbound.pathname;
  if (pathPrefix !== '' && path.startsWith(pathPrefix)) {
    path = path.slice(pathPrefix.length);
  }
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  const url = new URL(base + path);
  url.search = inbound.search;
  return url;
}

export function createGitProxyHandler(deps: GitProxyDependencies): Handler {
  const { aiName, tokenClient } = deps;
  const upstreamBaseUrl = deps.upstreamBaseUrl.replace(/\/+$/, '');
  const pathPrefix = deps.pathPrefix ?? DEFAULT_GIT_PATH_PREFIX;
  const fetchImpl = deps.fetch ?? fetch;

  return async (c: Context) => {
    const inbound = new URL(c.req.url);
    const service = serviceFor(inbound);
    const isReceivePackPost = service === 'receive-pack' && c.req.method === 'POST';

    let body: ArrayBuffer | ReadableStream<Uint8Array> | null;
    if (isReceivePackPost) {
      const buffer = await c.req.raw.arrayBuffer();
      const parsed = parseRefUpdates(new Uint8Array(buffer));
      // A push we cannot enumerate is not a push we can allow: refuse an
      // unreadable or empty body rather than forwarding a write that GitHub
      // might act on but our branch rule never saw.
      if (parsed.malformed || parsed.refs.length === 0) {
        throw new HttpError(403, 'push_rejected', 'push is unparseable');
      }
      for (const ref of parsed.refs) {
        if (!isAllowedRef(aiName, ref)) {
          throw new HttpError(403, 'push_rejected', 'push to this branch is not allowed');
        }
      }
      body = buffer;
    } else {
      body = c.req.raw.body;
    }

    const headers = new Headers(c.req.raw.headers);
    for (const name of HOP_BY_HOP_HEADERS) {
      headers.delete(name);
    }
    const token = await tokenClient.getToken();
    headers.set('authorization', `Bearer ${token}`);

    return fetchImpl(buildUpstreamUrl(upstreamBaseUrl, inbound, pathPrefix).toString(), {
      method: c.req.method,
      headers,
      body,
    });
  };
}

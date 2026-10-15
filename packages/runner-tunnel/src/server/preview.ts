// effect-plain: moved unchanged from packages/runner-tunnel/src/server.ts (size split)
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { TunnelHttpAgent } from '../http-agent.ts';
import type { ServerRuntime } from './conn.ts';
import { openEngineStream } from './engine.ts';
import { HOP_BY_HOP_HEADERS } from './options.ts';

/**
 * Mint a preview token for one runner port. The 16 random bytes are
 * 128 bits, base64url-encoded; the token is the capability (room-member
 * authorization is M3 work, see the task Report).
 */
export function createPreviewToken(rt: ServerRuntime, runnerId: string, port: number): string {
  const token = randomBytes(16).toString('base64url');
  rt.previews.set(token, { runnerId, port });
  return token;
}

export async function handlePreviewRequest(
  rt: ServerRuntime,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const rawUrl = req.url ?? '/';
  const [pathname = '/', query = ''] = rawUrl.split('?');
  const segments = pathname.split('/');
  if (segments[1] !== 'preview' || !segments[2]) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  const token = segments[2];
  const entry = rt.previews.get(token);
  if (entry === undefined || !rt.live.has(entry.runnerId)) {
    // Unknown token, or the token's runner is gone: same answer either way.
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  const rest = `/${segments.slice(3).join('/')}${query === '' ? '' : `?${query}`}`;
  const agent = new TunnelHttpAgent((port) => openEngineStream(rt, entry.runnerId, port));
  const headers = { ...req.headers };
  for (const name of HOP_BY_HOP_HEADERS) {
    delete headers[name];
  }
  const upstream = http.request(
    {
      host: 'tunnel',
      port: entry.port,
      method: req.method ?? 'GET',
      path: rest,
      headers,
      agent,
    },
    (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.headers);
      upRes.pipe(res);
    },
  );
  upstream.on('error', (err: Error) => {
    if (res.headersSent) {
      res.destroy(err);
      return;
    }
    if (!rt.live.has(entry.runnerId)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    } else {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`preview failed: ${err.message}`);
    }
  });
  req.pipe(upstream);
}

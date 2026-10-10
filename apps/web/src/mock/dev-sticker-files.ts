/**
 * Dev-only, mock-seed-only Vite plugin (T-1083). The browser fetches a sticker
 * `<img>` itself, so the request never reaches the mock `dispatch`
 * (`apps/web/src/mock/backend.ts`) and the `/api` proxy has no server in mock
 * mode. This `serve` plugin runs one `createMockBackend({ delayMs: 0 })` and
 * answers the seed's `/api/stickers/:id/file` before that proxy. Every other
 * path, method or status falls through to it, so a real backend is unchanged.
 * `apply: 'serve'` keeps it out of `vite build`: production has no such path.
 */
import type { Connect, Plugin } from 'vite';

const STICKER_FILE = /^\/api\/stickers\/[^/]+\/file$/;

// The `@zilar/mock-backend` surface this plugin needs, kept structural so it
// does not drag that package's type graph (and `xmpp-core`) into the app
// programs, which do not include `xmpp-core`'s ambient `@xmpp/client` shim.
interface DevMockBackend {
  http(path: string, init?: RequestInit): Promise<Response | undefined>;
}

interface MockBackendModule {
  createMockBackend(options?: { delayMs?: number }): DevMockBackend;
}

export function devStickerFiles(): Plugin {
  return {
    name: 'zilar:dev-sticker-files',
    apply: 'serve',
    async configureServer(server) {
      const { createMockBackend } = (await server.ssrLoadModule(
        '@zilar/mock-backend',
      )) as MockBackendModule;
      const backend = createMockBackend({ delayMs: 0 });
      const handler: Connect.NextHandleFunction = (req, res, next) => {
        void serveSeedSticker(backend, req, res, next).catch(next);
      };
      server.middlewares.use(handler);
    },
  };
}

/** Answers a seed sticker file; any other path, method or status calls `next()`. */
async function serveSeedSticker(
  backend: DevMockBackend,
  req: Connect.IncomingMessage,
  res: Parameters<Connect.NextHandleFunction>[1],
  next: Connect.NextFunction,
): Promise<void> {
  const url = req.url ?? '';
  const pathname = url.split('?')[0] ?? '';
  if (req.method !== 'GET' || !STICKER_FILE.test(pathname)) {
    next();
    return;
  }
  const response = await backend.http(url, { method: 'GET' });
  if (response === undefined || response.status !== 200) {
    next();
    return;
  }
  res.statusCode = response.status;
  const contentType = response.headers.get('Content-Type');
  if (contentType !== null) {
    res.setHeader('Content-Type', contentType);
  }
  res.end(new Uint8Array(await response.arrayBuffer()));
}

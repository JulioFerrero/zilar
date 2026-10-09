import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpError } from './errors';
import { testApp, type TestContext, TEST_BASE_URL, createTestContext } from './test-support';
import type { ZilarEdge } from './app';

type SweepApp = Pick<ZilarEdge, 'request' | 'routes'>;

type RouteSpec = { method: string; path: string };

// Every route on this list is genuinely public by design. Adding an entry
// here is a security decision: the lead must review it before the worker
// commits. The sweep also asserts the inverse — that an allowlisted
// (method, path) really exists in `app.routes` — so the list cannot rot.
const PUBLIC_ALLOWLIST = {
  // Better Auth handler: sign-in, sign-up and session lookups are public.
  'ALL|/api/auth/*': 'Better Auth handler (sign-in, sign-up, session lookups are public)',
  // Invite validity check: a would-be sign-up needs to know if a code works.
  'GET|/api/invites/:code': 'Invite validity check (public by design)',
  // Pairing endpoint: the pairing code + signature are the credential.
  'POST|/api/runner/pair':
    'Pairing endpoint; signature is the credential (expect 400 invalid_code)',
  // First-run setup (T-0161): public while no user exists; both answer the
  // same 404 as an unknown route once setup is done.
  'GET|/api/setup/status': 'Setup status check (public by design until setup is done)',
  'POST|/api/setup': 'First-run setup (public by design until setup is done)',
  // Health check, used by load balancers and uptime monitors.
  'GET|/health': 'Health check',
} as const satisfies Record<string, string>;

const ALLOWLIST_KEYS = new Set(Object.keys(PUBLIC_ALLOWLIST));

function allowlistKey(method: string, path: string): string {
  return `${method}|${path}`;
}

function actualizePath(path: string): string {
  return path.replace(/:[^/]+/g, 'probe').replace(/\*/g, 'x');
}

// The edge manifest lists only real routes (`ALL /api/auth/*` plus the
// module routes plus `GET /health`); there are no middleware entries to
// filter. The helper stays so the sweep keeps skipping them if one appears.
function isMiddlewareEntry(routePath: string): boolean {
  return routePath === '/*' || routePath === '/api/*';
}

// Drops duplicates while preserving order, so the printed route table is stable.
function uniqueRoutes(routes: ReadonlyArray<RouteSpec>): RouteSpec[] {
  const seen = new Set<string>();
  const result: RouteSpec[] = [];
  for (const spec of routes) {
    const key = allowlistKey(spec.method, spec.path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(spec);
  }
  return result;
}

interface RouteOutcome extends RouteSpec {
  status: number;
  allowed: boolean;
}

// Fires one unauthenticated request per route and reports the outcome. The
// caller decides what to assert about the result.
async function sweep(
  app: SweepApp,
  options: { baseUrl: string; allowlist?: ReadonlySet<string> },
): Promise<RouteOutcome[]> {
  const allowlist = options.allowlist ?? ALLOWLIST_KEYS;
  const baseUrl = options.baseUrl;
  const deduped = uniqueRoutes(
    app.routes.map((route) => ({ method: route.method, path: route.path })),
  );
  const outcomes: RouteOutcome[] = [];

  for (const spec of deduped) {
    if (isMiddlewareEntry(spec.path)) {
      continue;
    }
    const allowed = allowlist.has(allowlistKey(spec.method, spec.path));
    if (!spec.path.startsWith('/api')) {
      // Non-`/api` routes (e.g. `/health`) are out of the sweep's scope; the
      // allowlist-existence assertion below still checks they are registered.
      continue;
    }

    const concretePath = actualizePath(spec.path);
    const method = spec.method === 'ALL' ? 'GET' : spec.method;
    const init: RequestInit = { method };
    if (method !== 'GET' && method !== 'HEAD') {
      init.headers = { 'content-type': 'application/json' };
      init.body = '{}';
    }
    const response = await app.request(`${baseUrl}${concretePath}`, init);
    await response.text();
    outcomes.push({ ...spec, status: response.status, allowed });
  }

  return outcomes;
}

function printRouteTable(rows: ReadonlyArray<RouteSpec | RouteOutcome>): string {
  return rows
    .map((row) => {
      const status = 'status' in row ? ` -> ${row.status}` : '';
      const allowed = 'allowed' in row && row.allowed ? ' [allowlisted]' : '';
      return `  ${row.method.padEnd(7)} ${row.path.padEnd(40)}${status}${allowed}`;
    })
    .join('\n');
}

describe('authorization sweep', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('returns 401 on every /api route not on the public allowlist', async () => {
    const app = testApp(context);
    const outcomes = await sweep(app, { baseUrl: TEST_BASE_URL });

    process.stderr.write(`\n=== authz sweep: ${outcomes.length} /api routes ===\n`);
    for (const row of outcomes) {
      process.stderr.write(printRouteTable([row]) + '\n');
    }

    const unprotected = outcomes.filter((row) => !row.allowed && row.status !== 401);
    expect(
      unprotected,
      `Routes reachable without a session: ${JSON.stringify(unprotected)}`,
    ).toEqual([]);
  });

  it('sweeps every endpoint under /api (no route is silently skipped)', async () => {
    const app = testApp(context);
    const swept = await sweep(app, { baseUrl: TEST_BASE_URL });
    const sweptKeys = new Set(swept.map((row) => allowlistKey(row.method, row.path)));

    const registeredEndpoints = app.routes.filter((route) => {
      if (isMiddlewareEntry(route.path)) return false;
      return route.path.startsWith('/api');
    });
    const missed: Array<{ method: string; path: string }> = [];
    for (const route of registeredEndpoints) {
      const key = allowlistKey(route.method, route.path);
      if (!sweptKeys.has(key)) {
        missed.push({ method: route.method, path: route.path });
      }
    }
    expect(
      missed,
      `Registered /api endpoints the sweep skipped: ${JSON.stringify(missed)}`,
    ).toEqual([]);
  });

  it('does not have stale entries on the public allowlist', () => {
    const app = testApp(context);
    const registered = new Set(app.routes.map((route) => allowlistKey(route.method, route.path)));
    const stale: string[] = [];
    for (const key of Object.keys(PUBLIC_ALLOWLIST)) {
      if (!registered.has(key)) {
        stale.push(key);
      }
    }
    expect(
      stale,
      `Allowlist entries that no longer match a registered route: ${JSON.stringify(stale)}`,
    ).toEqual([]);
  });

  it('verifies each allowlisted route is actually reachable without a session', async () => {
    for (const [key, reason] of Object.entries(PUBLIC_ALLOWLIST)) {
      const [methodRaw, pathRaw] = key.split('|') as [string, string];
      const method = methodRaw === 'ALL' ? 'GET' : methodRaw;
      const concretePath = actualizePath(pathRaw);
      const init: RequestInit = { method };
      if (method !== 'GET' && method !== 'HEAD') {
        init.headers = { 'content-type': 'application/json' };
        init.body = '{}';
      }
      const app = testApp(context);
      const response = await app.request(`${TEST_BASE_URL}${concretePath}`, init);
      await response.text();
      expect(
        response.status,
        `${method} ${concretePath} is allowlisted (${reason}) but answers ${response.status}`,
      ).not.toBe(401);
    }
  });

  it('flags a throwaway route without auth on a local instance', async () => {
    const { createEdge } = await import('./effect/edge');
    const local: SweepApp = createEdge({
      mounts: [
        {
          routes: [
            { method: 'GET', path: '/api/open-route' },
            { method: 'GET', path: '/api/guarded-route' },
          ],
          handler: (request: Request) => {
            const url = new URL(request.url);
            if (url.pathname === '/api/guarded-route') {
              throw new HttpError(401, 'unauthorized', 'Authentication required');
            }
            return Promise.resolve(
              new Response(JSON.stringify({ ok: true }), {
                headers: { 'content-type': 'application/json' },
              }),
            );
          },
        },
      ],
      auth: { handler: () => Promise.resolve(new Response('not found', { status: 404 })) },
      config: context.config,
      logger: context.logger,
      health: () => Promise.resolve({ status: 200, body: { ok: true } }),
    });

    const outcomes = await sweep(local, { baseUrl: TEST_BASE_URL, allowlist: new Set() });
    const openRoute = outcomes.find((row) => row.path === '/api/open-route');
    const guardedRoute = outcomes.find((row) => row.path === '/api/guarded-route');

    expect(openRoute, '/api/open-route should be in the sweep output').toBeDefined();
    expect(openRoute?.status, 'open route should not answer 401').not.toBe(401);

    expect(guardedRoute, '/api/guarded-route should be in the sweep output').toBeDefined();
    expect(guardedRoute?.status, 'guarded route should answer 401').toBe(401);
  });
});

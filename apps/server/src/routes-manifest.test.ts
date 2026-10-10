// The route list of an Effect module is derived from its `HttpApi` with
// `HttpApi.reflect` (`reflectRoutes` in `effect/http-core.ts`). This test builds
// the whole app and checks that, for EVERY module, the APIs it registers
// reflect to exactly the routes the module's hand-kept `*_API_ROUTES` manifest
// lists, so a manifest can be deleted once its module passes here.
//
// Modules already converted have no manifest left; their expected routes are
// the literals in `CONVERTED` below (copied from the deleted arrays).

import { afterAll, describe, expect, it, vi } from 'vitest';
import type { HttpApi } from 'effect/http-api';
import { reflectRoutes, type EffectApiRoute } from './effect/http-core';
import { createTestContext, testApp, type TestContext } from './test-support';

const { registered } = vi.hoisted(() => ({ registered: [] as Array<unknown> }));

// Records every API handed to `HttpApiBuilder.layer`, i.e. the final API of
// each module, as `app.ts` builds it.
vi.mock('effect/http-api', async (importActual) => {
  const actual = await importActual<typeof import('effect/http-api')>();
  return {
    ...actual,
    HttpApiBuilder: {
      ...actual.HttpApiBuilder,
      layer: (api: unknown, ...rest: Array<unknown>) => {
        registered.push(api);
        return (actual.HttpApiBuilder.layer as (...a: Array<unknown>) => unknown)(api, ...rest);
      },
    },
  };
});

function keys(routes: ReadonlyArray<EffectApiRoute>): Array<string> {
  return routes.map((route) => `${route.method} ${route.path}`).sort();
}

declare global {
  interface ImportMeta {
    glob: <T>(pattern: string, options: { eager: true }) => Record<string, T>;
  }
}

const modules = {
  ...import.meta.glob<Record<string, unknown>>('./*/api.ts', { eager: true }),
  ...import.meta.glob<Record<string, unknown>>('./*/*/api.ts', { eager: true }),
};

// A converted module keeps its old manifest in `<module>/routes.expected.ts`.
const expectedFiles = import.meta.glob<{ EXPECTED_ROUTES: ReadonlyArray<EffectApiRoute> }>(
  './**/routes.expected.ts',
  { eager: true },
);

function folderOf(file: string): string {
  return file.slice(0, file.lastIndexOf('/'));
}

describe('route manifests', () => {
  let context: TestContext | undefined;

  afterAll(async () => {
    await context?.close();
  });

  it('every manifest equals the routes reflected from its module API', async () => {
    context = await createTestContext();
    testApp(context);

    const reflected = registered.map((api) =>
      keys(reflectRoutes(api as HttpApi.HttpApi<string, never>)),
    );
    const manifests = new Map<string, Array<string>>();
    for (const [file, exported] of Object.entries(modules)) {
      for (const [name, value] of Object.entries(exported)) {
        if (name.endsWith('_API_ROUTES')) {
          manifests.set(`${file}#${name}`, keys(value as ReadonlyArray<EffectApiRoute>));
        }
      }
    }
    for (const [file, exported] of Object.entries(expectedFiles)) {
      const folder = folderOf(file);
      const stillExported = [...manifests.keys()].some((key) => folderOf(key) === folder);
      if (!stillExported) {
        manifests.set(file, keys(exported.EXPECTED_ROUTES));
      }
    }

    expect(manifests.size).toBe(36);
    expect(registered.length).toBe(manifests.size);

    const unmatched = reflected.map((list) => list.join('|'));
    for (const [name, list] of manifests) {
      const index = unmatched.indexOf(list.join('|'));
      expect(index, `${name} has no API reflecting to it`).toBeGreaterThanOrEqual(0);
      unmatched.splice(index, 1);
    }
    expect(unmatched).toEqual([]);
  });
});

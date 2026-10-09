import { describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { runSearchEffect, type SearchRoutesDependencies } from './routes';
import type { ArchivePool, ArchiveRow, SearchOwner } from './service';

// The owner scope comes from the database in production. These tests replace
// it with a fixture, so the archive failure paths run without a database.
const mockState = vi.hoisted(() => ({ owners: undefined as unknown as SearchOwner }));

vi.mock('./service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./service')>();
  return { ...actual, allowedArchives: async () => mockState.owners };
});

function ownersFixture(): SearchOwner {
  return {
    ownLocalpart: 'alice',
    dmPeers: [],
    rooms: ['general@rooms.zilar.localhost'],
    peerNames: new Map(),
  };
}

function depsWith(archive: ArchivePool): SearchRoutesDependencies {
  return {
    auth: {} as Auth,
    db: {} as ServerDatabase,
    config: {
      xmpp: { domain: 'zilar.localhost', mucDomain: 'rooms.zilar.localhost' },
    } as unknown as ServerConfig,
    logger: {} as Logger,
    archive,
  };
}

// Runs the search and returns its typed failure. A success would reject here.
function failureOf(deps: SearchRoutesDependencies): Promise<HttpError> {
  return Effect.runPromise(Effect.flip(runSearchEffect(deps, 'user-alice', { q: 'mango' })));
}

function expectSearchFailed(error: HttpError): void {
  expect(error).toBeInstanceOf(HttpError);
  expect(error.status).toBe(502);
  expect(error.code).toBe('search_failed');
  expect(error.message).toBe('Message search failed, try again later');
}

describe('runSearchEffect archive failures', () => {
  it('answers 502 search_failed when the archive query rejects, without the raw text', async () => {
    mockState.owners = ownersFixture();
    const query = vi.fn(async (): Promise<ArchiveRow[]> => {
      throw new Error('connect ECONNREFUSED archive.internal:5432');
    });

    const error = await failureOf(depsWith({ query, close: async () => {} }));

    expectSearchFailed(error);
    expect(error.message).not.toContain('ECONNREFUSED');
  });

  it('answers the same 502 when only the fuzzy candidate query rejects', async () => {
    mockState.owners = ownersFixture();
    // The fuzzy query is the only one that selects `txt AS "body"`.
    const query = vi.fn(async (text: string): Promise<ArchiveRow[]> => {
      if (text.includes('AS "body"')) {
        throw new Error('canceling statement due to statement timeout');
      }
      return [];
    });

    const error = await failureOf(depsWith({ query, close: async () => {} }));

    expectSearchFailed(error);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('answers the same 502 when a query builder throws before any query runs', async () => {
    // buildArchiveQuery reads `owners.rooms` on the all-chats path, so a
    // getter that throws makes the builder throw.
    const owners = ownersFixture();
    Object.defineProperty(owners, 'rooms', {
      get(): never {
        throw new Error('builder failed');
      },
    });
    mockState.owners = owners;
    const query = vi.fn(async (): Promise<ArchiveRow[]> => []);

    const error = await failureOf(depsWith({ query, close: async () => {} }));

    expectSearchFailed(error);
    expect(query).not.toHaveBeenCalled();
  });
});

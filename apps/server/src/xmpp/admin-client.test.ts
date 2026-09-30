import { describe, expect, it } from 'vitest';
import {
  createEjabberdAdminClient,
  EjabberdApiError,
  type FetchLike,
  type RoomAffiliation,
} from './admin-client';
import type { XmppConfig } from './config';

const config: XmppConfig = {
  apiUrl: 'http://ejabberd.test/api',
  adminJid: 'admin@galena.localhost',
  adminPassword: 'admin-secret-value',
  domain: 'galena.localhost',
  mucDomain: 'rooms.galena.localhost',
  wsPublicUrl: 'ws://ejabberd.test:5280/ws',
  jwtSecret: 's'.repeat(40),
};

type Call = { url: string; init: RequestInit };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createFetch(handler: (call: Call) => Response): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    const call = { url, init };
    calls.push(call);
    return Promise.resolve(handler(call));
  };
  return { fetchImpl, calls };
}

function bodyOf(call: Call): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

function headerOf(call: Call, name: string): string | null {
  return new Headers(call.init.headers).get(name);
}

describe('createEjabberdAdminClient', () => {
  it('registers a user with the admin auth header, host and a long random password', async () => {
    const { fetchImpl, calls } = createFetch(() =>
      jsonResponse('User alice@galena.localhost successfully registered'),
    );
    const client = createEjabberdAdminClient(config, fetchImpl);

    await expect(client.registerUser('alice')).resolves.toEqual({ created: true });

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('http://ejabberd.test/api/register');
    expect(call.init.method).toBe('POST');
    expect(headerOf(call, 'content-type')).toBe('application/json');
    expect(headerOf(call, 'authorization')).toBe(
      `Basic ${Buffer.from('admin@galena.localhost:admin-secret-value').toString('base64')}`,
    );
    const body = bodyOf(call);
    expect(body['user']).toBe('alice');
    expect(body['host']).toBe('galena.localhost');
    expect(typeof body['password']).toBe('string');
    expect((body['password'] as string).length).toBeGreaterThanOrEqual(32);
  });

  it('treats an already-registered user as created: false', async () => {
    const { fetchImpl } = createFetch(() =>
      jsonResponse(
        {
          status: 'error',
          code: 10090,
          message: 'User alice@galena.localhost already registered',
        },
        409,
      ),
    );
    const client = createEjabberdAdminClient(config, fetchImpl);
    await expect(client.registerUser('alice')).resolves.toEqual({ created: false });
  });

  it('unregisters a user through unregister', async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse(0));
    const client = createEjabberdAdminClient(config, fetchImpl);

    await client.unregisterUser('alice');

    const call = calls[0]!;
    expect(call.url).toBe('http://ejabberd.test/api/unregister');
    expect(call.init.method).toBe('POST');
    expect(bodyOf(call)).toEqual({ user: 'alice', host: 'galena.localhost' });
  });

  it('maps userExists from check_account (0 means the account exists)', async () => {
    const exists = createFetch(() => jsonResponse(0));
    await expect(
      createEjabberdAdminClient(config, exists.fetchImpl).userExists('alice'),
    ).resolves.toBe(true);

    const missing = createFetch(() => jsonResponse(1));
    await expect(
      createEjabberdAdminClient(config, missing.fetchImpl).userExists('alice'),
    ).resolves.toBe(false);
  });

  it('changes a password through change_password', async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse(0));
    const client = createEjabberdAdminClient(config, fetchImpl);

    await client.changePassword('alice', 'known-password');

    const call = calls[0]!;
    expect(call.url).toBe('http://ejabberd.test/api/change_password');
    expect(bodyOf(call)).toEqual({
      user: 'alice',
      host: 'galena.localhost',
      newpass: 'known-password',
    });
  });

  it('rejects an empty password before any request', async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse(0));
    const client = createEjabberdAdminClient(config, fetchImpl);

    await expect(client.changePassword('alice', '')).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('creates a members-only persistent room with MAM and a title', async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse(0));
    const client = createEjabberdAdminClient(config, fetchImpl);

    await expect(client.createRoom('project-a', { title: 'Project A' })).resolves.toEqual({
      created: true,
    });

    const call = calls[0]!;
    expect(call.url).toBe('http://ejabberd.test/api/create_room_with_opts');
    expect(bodyOf(call)).toEqual({
      room: 'project-a',
      service: 'rooms.galena.localhost',
      host: 'galena.localhost',
      options: [
        { name: 'members_only', value: 'true' },
        { name: 'persistent', value: 'true' },
        { name: 'mam', value: 'true' },
        // T-0119: rooms allow MUC/Sub subscriptions for push by default.
        { name: 'allow_subscription', value: 'true' },
        { name: 'title', value: 'Project A' },
      ],
    });
  });

  it('treats an existing room as created: false', async () => {
    const { fetchImpl } = createFetch(() => jsonResponse('Room already exists', 400));
    const client = createEjabberdAdminClient(config, fetchImpl);
    await expect(client.createRoom('project-a')).resolves.toEqual({ created: false });
  });

  it('sends moderated + members_by_default for a channel room, neither by default', async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse(0));
    const client = createEjabberdAdminClient(config, fetchImpl);

    await client.createRoom('releases', {
      title: 'Releases',
      moderated: true,
      membersByDefault: false,
    });

    expect(bodyOf(calls[0]!).options).toEqual([
      { name: 'members_only', value: 'true' },
      { name: 'persistent', value: 'true' },
      { name: 'mam', value: 'true' },
      { name: 'moderated', value: 'true' },
      { name: 'members_by_default', value: 'false' },
      { name: 'title', value: 'Releases' },
    ]);
  });

  it('sets an affiliation from a bare JID', async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse(0));
    const client = createEjabberdAdminClient(config, fetchImpl);

    await client.setAffiliation('project-a', 'alice@galena.localhost', 'owner');

    expect(bodyOf(calls[0]!)).toEqual({
      room: 'project-a',
      service: 'rooms.galena.localhost',
      user: 'alice',
      host: 'galena.localhost',
      affiliation: 'owner',
    });
  });

  it('returns the validated affiliation list', async () => {
    const { fetchImpl } = createFetch(() =>
      jsonResponse([
        { jid: 'alice@galena.localhost', affiliation: 'owner', reason: '' },
        { jid: 'bob@galena.localhost', affiliation: 'member', reason: 'invited' },
      ]),
    );
    const client = createEjabberdAdminClient(config, fetchImpl);
    await expect(client.getAffiliations('project-a')).resolves.toEqual([
      { jid: 'alice@galena.localhost', affiliation: 'owner', reason: '' },
      { jid: 'bob@galena.localhost', affiliation: 'member', reason: 'invited' },
    ]);
  });

  it('sends a direct invitation with the MUC service, targets and defaults', async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse(0));
    const client = createEjabberdAdminClient(config, fetchImpl);

    await client.sendDirectInvitation('project-a', [
      'alice@galena.localhost',
      'bob@galena.localhost',
    ]);

    const call = calls[0]!;
    expect(call.url).toBe('http://ejabberd.test/api/send_direct_invitation');
    expect(bodyOf(call)).toEqual({
      room: 'project-a',
      service: 'rooms.galena.localhost',
      password: 'none',
      reason: 'none',
      users: ['alice@galena.localhost', 'bob@galena.localhost'],
    });
  });

  it('passes an invitation reason and password when given', async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse(''));
    const client = createEjabberdAdminClient(config, fetchImpl);

    await client.sendDirectInvitation('project-a', ['alice@galena.localhost'], {
      reason: 'Join us',
      password: 'secret',
    });

    expect(bodyOf(calls[0]!)).toMatchObject({ reason: 'Join us', password: 'secret' });
  });

  it('rejects invalid invitation targets before any request', async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse(0));
    const client = createEjabberdAdminClient(config, fetchImpl);

    await expect(client.sendDirectInvitation('project-a', [])).rejects.toThrow();
    await expect(
      client.sendDirectInvitation('Bad/../Room', ['alice@galena.localhost']),
    ).rejects.toThrow('roomId');
    await expect(client.sendDirectInvitation('project-a', ['not-a-jid'])).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('adds a roster item with both subscriptions and the Galena group', async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse(0));
    const client = createEjabberdAdminClient(config, fetchImpl);

    await client.addRosterItem('alice', 'bob@galena.localhost', {
      nick: 'Bob',
      groups: ['Galena'],
    });

    const call = calls[0]!;
    expect(call.url).toBe('http://ejabberd.test/api/add_rosteritem');
    expect(bodyOf(call)).toEqual({
      localuser: 'alice',
      localhost: 'galena.localhost',
      user: 'bob',
      host: 'galena.localhost',
      nick: 'Bob',
      groups: ['Galena'],
      subs: 'both',
    });
  });

  it('deletes a roster item', async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse(0));
    const client = createEjabberdAdminClient(config, fetchImpl);

    await client.deleteRosterItem('alice', 'bob@galena.localhost');

    expect(calls[0]!.url).toBe('http://ejabberd.test/api/delete_rosteritem');
    expect(bodyOf(calls[0]!)).toEqual({
      localuser: 'alice',
      localhost: 'galena.localhost',
      user: 'bob',
      host: 'galena.localhost',
    });
  });

  it('returns the validated roster', async () => {
    const { fetchImpl } = createFetch(() =>
      jsonResponse([
        {
          jid: 'bob@galena.localhost',
          nick: 'Bob',
          subscription: 'both',
          pending: 'none',
          groups: ['Galena'],
        },
      ]),
    );
    const client = createEjabberdAdminClient(config, fetchImpl);
    await expect(client.getRoster('alice')).resolves.toEqual([
      {
        jid: 'bob@galena.localhost',
        nick: 'Bob',
        subscription: 'both',
        pending: 'none',
        groups: ['Galena'],
      },
    ]);
  });

  it('creates a non-anonymous room when asked', async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse(0));
    const client = createEjabberdAdminClient(config, fetchImpl);

    await client.createRoom('trip', { title: 'Trip', anonymous: false });

    expect(bodyOf(calls[0]!).options).toEqual([
      { name: 'members_only', value: 'true' },
      { name: 'persistent', value: 'true' },
      { name: 'mam', value: 'true' },
      // T-0119: rooms allow MUC/Sub subscriptions for push by default.
      { name: 'allow_subscription', value: 'true' },
      { name: 'anonymous', value: 'false' },
      { name: 'title', value: 'Trip' },
    ]);
  });

  it('rejects invalid roster inputs before any request', async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse(0));
    const client = createEjabberdAdminClient(config, fetchImpl);

    await expect(
      client.addRosterItem('Alice', 'bob@galena.localhost', { nick: 'Bob', groups: ['Galena'] }),
    ).rejects.toThrow('localpart');
    await expect(
      client.addRosterItem('alice', 'not-a-jid', { nick: 'Bob', groups: ['Galena'] }),
    ).rejects.toThrow('jid');
    await expect(
      client.addRosterItem('alice', 'bob@galena.localhost', { nick: 'Bob', groups: [] }),
    ).rejects.toThrow();
    await expect(client.getRoster('Bad/Jid')).rejects.toThrow('localpart');
    expect(calls).toHaveLength(0);
  });

  it('maps a non-2xx error to a typed error without the admin password', async () => {
    const { fetchImpl } = createFetch(() =>
      jsonResponse({ status: 'error', code: 1, message: 'boom' }, 500),
    );
    const client = createEjabberdAdminClient(config, fetchImpl);

    const error = await client.getAffiliations('project-a').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(EjabberdApiError);
    const apiError = error as EjabberdApiError;
    expect(apiError.command).toBe('get_room_affiliations');
    expect(apiError.status).toBe(500);
    expect(apiError.message).toContain('boom');
    expect(apiError.message).not.toContain('admin-secret-value');
  });

  it('maps a 200 response that carries an error body to a typed error', async () => {
    const { fetchImpl } = createFetch(() => jsonResponse({ status: 'error', message: 'nope' }));
    const client = createEjabberdAdminClient(config, fetchImpl);
    await expect(client.destroyRoom('project-a')).rejects.toBeInstanceOf(EjabberdApiError);
  });

  it('rejects invalid localparts and room ids before any request', async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse(0));
    const client = createEjabberdAdminClient(config, fetchImpl);

    await expect(client.registerUser('../x')).rejects.toThrow('localpart');
    await expect(client.registerUser('Alice')).rejects.toThrow('localpart');
    await expect(client.registerUser('')).rejects.toThrow('localpart');
    await expect(client.unregisterUser('Alice')).rejects.toThrow('localpart');
    await expect(client.createRoom('Bad/../Room')).rejects.toThrow('roomId');
    await expect(client.getAffiliations('')).rejects.toThrow('roomId');
    await expect(client.setAffiliation('project-a', 'not-a-jid', 'member')).rejects.toThrow('jid');
    await expect(
      client.setAffiliation(
        'project-a',
        'alice@galena.localhost',
        'superuser' as unknown as RoomAffiliation,
      ),
    ).rejects.toThrow();

    expect(calls).toHaveLength(0);
  });
});

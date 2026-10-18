import { describe, expect, it } from 'vitest';
import type { XmppConfig } from '../config';
import { createEjabberdAdminClient } from './client';
import { EjabberdApiError } from './errors';
import type { FetchLike } from './types';

const config: XmppConfig = {
  apiUrl: 'http://ejabberd.test/api',
  adminJid: 'admin@zilar.localhost',
  adminPassword: 'CHANGE_ME',
  domain: 'zilar.localhost',
  mucDomain: 'rooms.zilar.localhost',
  wsPublicUrl: 'ws://127.0.0.1:5280/ws',
  jwtSecret: 'CHANGE_ME_0000000000000000000000000',
};

function recorder(result: string, status = 200) {
  const requests: Array<{ url: string; body: unknown }> = [];
  const fetchImpl: FetchLike = async (input, init) => {
    requests.push({ url: input, body: JSON.parse(String(init.body)) });
    return new Response(result, { status });
  };
  return { requests, fetchImpl };
}

function kickUserOf(fetchImpl: FetchLike) {
  const client = createEjabberdAdminClient(config, fetchImpl);
  const kickUser = client.kickUser;
  if (kickUser === undefined) {
    throw new Error('the admin client must expose kickUser');
  }
  return kickUser;
}

describe('createRoom', () => {
  it('always sends public=false and public_list=false', async () => {
    const { requests, fetchImpl } = recorder('0');
    const client = createEjabberdAdminClient(config, fetchImpl);

    await client.createRoom('room1', { title: 'Team' });

    const body = requests[0]?.body as { options: Array<{ name: string; value: string }> };
    const options = new Map(body.options.map((entry) => [entry.name, entry.value]));
    expect(options.get('public')).toBe('false');
    expect(options.get('public_list')).toBe('false');
    expect(options.get('members_only')).toBe('true');
  });
});

describe('kickUser', () => {
  it('posts the localpart and the host to kick_user', async () => {
    const { requests, fetchImpl } = recorder('0');

    await kickUserOf(fetchImpl)('alice', 'Session revoked');

    expect(requests).toEqual([
      {
        url: 'http://ejabberd.test/api/kick_user',
        body: { user: 'alice', host: 'zilar.localhost' },
      },
    ]);
  });

  it('accepts an integer session count, including zero', async () => {
    const { fetchImpl } = recorder('3');
    await expect(kickUserOf(fetchImpl)('alice', 'Session revoked')).resolves.toBeUndefined();

    const offline = recorder('0');
    await expect(
      kickUserOf(offline.fetchImpl)('alice', 'Session revoked'),
    ).resolves.toBeUndefined();
  });

  it('accepts the raw result string ejabberd 26.07 answers', async () => {
    const kicked = recorder('"Kicked sessions: 2"');
    await expect(kickUserOf(kicked.fetchImpl)('alice', 'Session revoked')).resolves.toBeUndefined();

    // An offline user answers zero kicked sessions, which is success too.
    const offline = recorder('"Kicked sessions: 0"');
    await expect(
      kickUserOf(offline.fetchImpl)('alice', 'Session revoked'),
    ).resolves.toBeUndefined();
  });

  it('fails on a result that is neither a count nor a mutation status', async () => {
    const { fetchImpl } = recorder('{"ok":true}');

    await expect(kickUserOf(fetchImpl)('alice', 'Session revoked')).rejects.toBeInstanceOf(
      EjabberdApiError,
    );
  });
});

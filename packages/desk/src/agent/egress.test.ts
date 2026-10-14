import { describe, expect, it } from 'vitest';
import type { DeskRegistration, RegistryClient } from '../egress/registry';
import { createEgressRegistrar } from './egress';

class FakeRegistry implements RegistryClient {
  readonly registrations: DeskRegistration[] = [];
  readonly unregistered: string[] = [];

  register(registration: DeskRegistration): Promise<void> {
    this.registrations.push(registration);
    return Promise.resolve();
  }

  unregister(deskId: string): Promise<void> {
    this.unregistered.push(deskId);
    return Promise.resolve();
  }
}

const settings = { proxyUrl: 'http://desk-egress:3128', registrySocket: '/tmp/egress.sock' };

describe('createEgressRegistrar', () => {
  it('registers the desk and returns a per-desk proxy URL', async () => {
    const client = new FakeRegistry();
    const registrar = createEgressRegistrar(settings, client);
    const url = new URL(await registrar.register('desk-ai1-p1', ['example.com']));

    expect(url.protocol).toBe('http:');
    expect(url.hostname).toBe('desk-egress');
    expect(url.port).toBe('3128');
    expect(url.username).toBe('desk-ai1-p1');
    expect(client.registrations).toEqual([
      { deskId: 'desk-ai1-p1', secret: url.password, allowedHosts: ['example.com'] },
    ]);
  });

  it('reuses the same secret when a live desk is re-registered', async () => {
    const client = new FakeRegistry();
    const registrar = createEgressRegistrar(settings, client);
    const first = await registrar.register('desk-ai1-p1', null);
    const second = await registrar.register('desk-ai1-p1', null);
    expect(second).toBe(first);
    expect(client.registrations).toHaveLength(2);
  });

  it('unregisters the desk and forgets its secret', async () => {
    const client = new FakeRegistry();
    const registrar = createEgressRegistrar(settings, client);
    const first = new URL(await registrar.register('desk-ai1-p1', null));
    await registrar.unregister('desk-ai1-p1');
    expect(client.unregistered).toEqual(['desk-ai1-p1']);

    const next = new URL(await registrar.register('desk-ai1-p1', null));
    expect(next.password).not.toBe(first.password);
  });
});

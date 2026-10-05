import { describe, expect, it } from 'vitest';

import { loadPushConfig, pushConfigError } from './config';

describe('loadPushConfig', () => {
  it('treats empty PUSH_* values as unset (Docker Compose renders `${VAR:-}` as "")', () => {
    const config = loadPushConfig({
      PUSH_ENABLED: '',
      PUSH_VAPID_PUBLIC_KEY: '',
      PUSH_VAPID_PRIVATE_KEY: '',
      PUSH_VAPID_SUBJECT: '',
      PUSH_COMPONENT_JID: '',
      PUSH_COMPONENT_SECRET: '',
      PUSH_COMPONENT_PORT: '',
      PUSH_STORAGE_KEY: '',
    });
    expect(config.PUSH_ENABLED).toBe(false);
    expect(config.PUSH_COMPONENT_PORT).toBe(5347);
    expect(config.PUSH_VAPID_PUBLIC_KEY).toBeUndefined();
    expect(pushConfigError(config)).toBeNull();
  });

  it('still rejects a too-short storage key and a bad port', () => {
    expect(() => loadPushConfig({ PUSH_STORAGE_KEY: 'short' })).toThrow();
    expect(() => loadPushConfig({ PUSH_COMPONENT_PORT: 'abc' })).toThrow();
  });

  it('defaults the component host to loopback for dev', () => {
    expect(loadPushConfig({}).PUSH_COMPONENT_HOST).toBe('127.0.0.1');
    expect(loadPushConfig({ PUSH_COMPONENT_HOST: '' }).PUSH_COMPONENT_HOST).toBe('127.0.0.1');
  });

  it('accepts a plain hostname as the component host', () => {
    for (const host of ['ejabberd', 'xmpp.internal', 'ejabberd-2.relay-1']) {
      expect(loadPushConfig({ PUSH_COMPONENT_HOST: host }).PUSH_COMPONENT_HOST).toBe(host);
    }
  });

  it('rejects a component host with a scheme, port, slash or emptiness', () => {
    for (const host of ['a:1', 'http://x', 'x/y', 'host name', 'host:5347']) {
      expect(() => loadPushConfig({ PUSH_COMPONENT_HOST: host })).toThrow();
    }
  });

  it('reports a missing value by name when push is enabled', () => {
    const config = loadPushConfig({ PUSH_ENABLED: 'true' });
    expect(pushConfigError(config)).toMatch(/PUSH_/);
  });
});

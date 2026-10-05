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

  it('reports a missing value by name when push is enabled', () => {
    const config = loadPushConfig({ PUSH_ENABLED: 'true' });
    expect(pushConfigError(config)).toMatch(/PUSH_/);
  });
});

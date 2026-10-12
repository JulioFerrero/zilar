import { describe, expect, it } from 'vitest';
import { loadPushConfig, pushConfigError } from './config';

// Push must clear `requirePush`: the flag, the VAPID keys, the component
// credentials and a 32+ character storage key. None of these are real.
const PUSH_ENV = {
  PUSH_ENABLED: 'true',
  PUSH_VAPID_PUBLIC_KEY: 'test-vapid-public',
  PUSH_VAPID_PRIVATE_KEY: 'test-vapid-private',
  PUSH_VAPID_SUBJECT: 'mailto:test@example.com',
  PUSH_COMPONENT_JID: 'push@zilar.localhost',
  PUSH_COMPONENT_SECRET: 'test-component-secret',
  PUSH_STORAGE_KEY: 'test-push-storage-key-0000000000000000',
};

describe('push config: component-secret placeholder', () => {
  it('treats the public placeholder as missing so push stays off', () => {
    const config = loadPushConfig({
      ...PUSH_ENV,
      PUSH_COMPONENT_SECRET: 'CHANGE_ME_PUSH_COMPONENT_SECRET',
    });

    const error = pushConfigError(config);
    expect(error).toContain('PUSH_COMPONENT_SECRET');
  });

  it('accepts a real component secret', () => {
    const config = loadPushConfig(PUSH_ENV);

    expect(pushConfigError(config)).toBeNull();
  });
});

import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadPushConfig } from './config';
import { createNativeSender } from './native-sender';

function capturingLogger(): { messages: string[]; info: (message: string) => void } {
  const messages: string[] = [];
  return {
    messages,
    info: (message) => {
      messages.push(message);
    },
  };
}

// A throwaway key generated in-process, never a real service account.
function serviceAccountJson(): string {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return JSON.stringify({
    client_email: 'test@example.iam.gserviceaccount.com',
    private_key: privateKey,
    project_id: 'zilar-test',
  });
}

describe('createNativeSender', () => {
  it('returns undefined and logs off without FCM_SERVICE_ACCOUNT_JSON', () => {
    const logger = capturingLogger();

    const sender = createNativeSender(loadPushConfig({}), logger);

    expect(sender).toBeUndefined();
    expect(logger.messages).toEqual(['push: native (FCM) sender off']);
  });

  it('returns an FCM sender and logs on with a valid service account', () => {
    const logger = capturingLogger();
    const push = loadPushConfig({ FCM_SERVICE_ACCOUNT_JSON: serviceAccountJson() });

    const sender = createNativeSender(push, logger);

    expect(sender).toBeDefined();
    expect(typeof sender?.send).toBe('function');
    expect(logger.messages).toEqual(['push: native (FCM) sender on']);
  });
});

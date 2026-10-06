import { beforeEach, describe, expect, it } from 'vitest';

import { IntegrationsApiError } from '@/lib/integrations-api';
import {
  createMockIntegrationsApi,
  integrationsMockScenario,
  resetIntegrationsMock,
} from './integrations-mock';

beforeEach(() => {
  resetIntegrationsMock();
});

describe('integrationsMockScenario', () => {
  it('returns null outside mock mode', () => {
    expect(integrationsMockScenario({}, {}, false)).toBeNull();
    expect(integrationsMockScenario({ EXPO_PUBLIC_ZILAR_MOCK: '0' }, {}, false)).toBeNull();
    expect(integrationsMockScenario({ EXPO_PUBLIC_ZILAR_MOCK: '' }, {}, false)).toBeNull();
  });

  it('maps "1" to the default scenario', () => {
    expect(integrationsMockScenario({ EXPO_PUBLIC_ZILAR_MOCK: '1' }, {}, false)).toBe('default');
  });

  it('parses the not-owner scenario from the param', () => {
    expect(integrationsMockScenario({}, { mock: 'not-owner' }, true)).toBe('not-owner');
  });

  it('returns null for an unknown scenario', () => {
    expect(integrationsMockScenario({}, { mock: 'owner' }, true)).toBeNull();
  });

  it('ignores the param when it is not allowed', () => {
    expect(integrationsMockScenario({}, { mock: 'not-owner' }, false)).toBeNull();
  });
});

describe('createMockIntegrationsApi', () => {
  it('rejects not-owner with status 404', async () => {
    const api = createMockIntegrationsApi('not-owner');
    const error = await api.getIntegrationsStatus().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(IntegrationsApiError);
    expect((error as IntegrationsApiError).status).toBe(404);
  });

  it('never stores the bot token', async () => {
    const api = createMockIntegrationsApi('unconfigured');
    const token = 'mock-bot-token-abcdef-123456';
    await api.saveTelegramBotToken(token);
    const status = await api.getIntegrationsStatus();
    expect(status.telegram.configured).toBe(true);
    expect(status.telegram.source).toBe('stored');
    expect(JSON.stringify(status)).not.toContain(token);
  });

  it('keeps the sender address when saving email', async () => {
    const api = createMockIntegrationsApi('unconfigured');
    await api.saveEmailSettings({ from: 'Zilar <hello@example.com>', resendApiKey: 're-secret' });
    const status = await api.getIntegrationsStatus();
    expect(status.email.configured).toBe(true);
    expect(status.email.from).toBe('Zilar <hello@example.com>');
  });
});

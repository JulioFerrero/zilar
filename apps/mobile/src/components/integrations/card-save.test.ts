import { afterEach, describe, expect, it, vi } from 'vitest';

import { IntegrationsApiError, type IntegrationsStatus } from '../../lib/integrations-api';
import { removeIntegrationCard, saveEmailCard, saveTelegramCard, saveVoiceCard } from './card-save';

const STATUS: IntegrationsStatus = {
  telegram: { configured: true, source: 'stored' },
  email: { configured: true, source: 'stored', from: 'Zilar <a@b.example>' },
  voiceTranscription: { configured: true, baseUrl: 'https://x.example', model: 'whisper-1' },
  canManage: true,
};

const SECRET = 'zilar-test-bot-token-123456-abcdef';

// The code under test must never log a secret: every helper call below runs
// with `console` spied, and the secret-absence assertions read the real
// console calls — not a fake whose labels could never contain it.
const CONSOLE_METHODS = ['log', 'info', 'debug', 'warn', 'error'] as const;

let consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

function spyOnConsole(): void {
  consoleSpies = CONSOLE_METHODS.map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );
}

afterEach(() => {
  for (const spy of consoleSpies) {
    spy.mockRestore();
  }
  consoleSpies = [];
});

function loggedText(): string {
  return consoleSpies
    .flatMap((spy) => spy.mock.calls)
    .map((args) => args.map(String).join(' '))
    .join('\n');
}

function expectNoSecretLogged(secret: string): void {
  expect(loggedText()).not.toContain(secret);
  for (const spy of consoleSpies) {
    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining(secret));
  }
}

// Every method the helpers may call: the save chains execute for real
// (unlike the `renderToStaticMarkup` screen test, which never runs
// handlers), and the call order is asserted per test.
function fakeApi(overrides: Record<string, () => Promise<unknown>> = {}): {
  api: Parameters<typeof saveEmailCard>[0];
  calls: { name: string; args: unknown[] }[];
} {
  const calls: { name: string; args: unknown[] }[] = [];
  const api = {
    getIntegrationsStatus: async (): Promise<IntegrationsStatus> => {
      calls.push({ name: 'getIntegrationsStatus', args: [] });
      return STATUS;
    },
    saveTelegramBotToken: async (token: string): Promise<void> => {
      calls.push({ name: 'saveTelegramBotToken', args: [token] });
    },
    removeTelegramBotToken: async (): Promise<void> => {
      calls.push({ name: 'removeTelegramBotToken', args: [] });
    },
    saveEmailSettings: async (input: unknown): Promise<void> => {
      calls.push({ name: 'saveEmailSettings', args: [input] });
    },
    getVoiceTranscriptionStatus: async (): Promise<{ enabled: boolean }> => ({ enabled: true }),
    saveVoiceTranscriptionSettings: async (input: unknown): Promise<void> => {
      calls.push({ name: 'saveVoiceTranscriptionSettings', args: [input] });
    },
    removeVoiceTranscriptionSettings: async (): Promise<void> => {
      calls.push({ name: 'removeVoiceTranscriptionSettings', args: [] });
    },
    ...overrides,
  };
  return { api, calls };
}

describe('saveTelegramCard', () => {
  it('saves, clears the token, and reports saved only after the reload', async () => {
    spyOnConsole();
    const { api, calls } = fakeApi();
    const outcome = await saveTelegramCard(api, { token: SECRET });

    expect(outcome).toEqual({ status: STATUS, saved: true, error: '', secretAfterSave: '' });
    expect(calls.map((call) => call.name)).toEqual([
      'saveTelegramBotToken',
      'getIntegrationsStatus',
    ]);
    // The saved secret is absent from every logged call.
    expectNoSecretLogged(SECRET);
  });

  it('keeps the typed token and reports the fixed sentence when the save fails', async () => {
    const { api } = fakeApi({
      saveTelegramBotToken: async () => {
        throw new IntegrationsApiError(422, 'invalid_token', 'rejected');
      },
    });
    const outcome = await saveTelegramCard(api, { token: SECRET });

    expect(outcome.status).toBeNull();
    expect(outcome.saved).toBe(false);
    expect(outcome.secretAfterSave).toBe(SECRET);
    expect(outcome.error).toBe('Telegram rejected the bot token. Check it and try again.');
  });

  it('reports no saved line when the reload fails after a successful save', async () => {
    const { api } = fakeApi({
      getIntegrationsStatus: async () => {
        throw new IntegrationsApiError(0, 'network_error', 'down');
      },
    });
    const outcome = await saveTelegramCard(api, { token: SECRET });

    expect(outcome.status).toBeNull();
    expect(outcome.saved).toBe(false);
    expect(outcome.error).toBe('Could not reach the server.');
  });

  it('still clears the token when the save succeeds but the reload fails', async () => {
    // The server already stores the new token, so the field must clear even
    // though no saved line shows: the screen applies `secretAfterSave`
    // unconditionally.
    spyOnConsole();
    const { api } = fakeApi({
      getIntegrationsStatus: async () => {
        throw new IntegrationsApiError(0, 'network_error', 'down');
      },
    });
    const outcome = await saveTelegramCard(api, { token: SECRET });

    expect(outcome.secretAfterSave).toBe('');
    expect(outcome.saved).toBe(false);
    expectNoSecretLogged(SECRET);
  });
});

describe('saveEmailCard', () => {
  it('saves the sender with the key, then clears the key after the reload', async () => {
    spyOnConsole();
    const { api, calls } = fakeApi();
    const outcome = await saveEmailCard(api, {
      from: 'Zilar <a@b.example>',
      key: 're_secret',
    });

    expect(outcome.saved).toBe(true);
    expect(outcome.secretAfterSave).toBe('');
    expect(calls[0]).toMatchObject({
      name: 'saveEmailSettings',
      args: [{ from: 'Zilar <a@b.example>', resendApiKey: 're_secret' }],
    });
    expectNoSecretLogged('re_secret');
  });

  it('omits the key on a sender-only change', async () => {
    const { api, calls } = fakeApi();
    await saveEmailCard(api, { from: 'Zilar <a@b.example>', key: '   ' });

    expect(calls[0]).toMatchObject({
      name: 'saveEmailSettings',
      args: [{ from: 'Zilar <a@b.example>' }],
    });
  });
});

describe('saveVoiceCard', () => {
  it('defaults an empty model to whisper-1 and clears the key after the reload', async () => {
    spyOnConsole();
    const { api, calls } = fakeApi();
    const outcome = await saveVoiceCard(api, {
      baseUrl: 'https://x.example',
      model: '',
      key: 'sk_secret',
    });

    expect(outcome.saved).toBe(true);
    expect(outcome.secretAfterSave).toBe('');
    expect(calls[0]).toMatchObject({
      name: 'saveVoiceTranscriptionSettings',
      args: [{ baseUrl: 'https://x.example', apiKey: 'sk_secret', model: 'whisper-1' }],
    });
    expectNoSecretLogged('sk_secret');
  });
});

describe('removeIntegrationCard', () => {
  it('removes the telegram token and reports removed only after the reload', async () => {
    const { api, calls } = fakeApi();
    const outcome = await removeIntegrationCard(api, 'telegram');

    expect(outcome).toEqual({ status: STATUS, removed: true, error: '' });
    expect(calls.map((call) => call.name)).toEqual([
      'removeTelegramBotToken',
      'getIntegrationsStatus',
    ]);
  });

  it('removes the voice endpoint', async () => {
    const { api, calls } = fakeApi();
    const outcome = await removeIntegrationCard(api, 'voice');

    expect(outcome.removed).toBe(true);
    expect(calls.map((call) => call.name)).toEqual([
      'removeVoiceTranscriptionSettings',
      'getIntegrationsStatus',
    ]);
  });

  it('keeps the dialog case open with the fixed sentence when the remove fails', async () => {
    const { api } = fakeApi({
      removeVoiceTranscriptionSettings: async () => {
        throw new IntegrationsApiError(500, 'request_failed', 'boom');
      },
    });
    const outcome = await removeIntegrationCard(api, 'voice');

    expect(outcome.status).toBeNull();
    expect(outcome.removed).toBe(false);
    expect(outcome.error).toBe('Could not remove it. Try again.');
  });
});

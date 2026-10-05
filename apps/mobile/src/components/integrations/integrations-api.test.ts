import { describe, expect, it, vi } from 'vitest';

import {
  buildSaveEmailBody,
  buildSaveVoiceBody,
  createIntegrationsApi,
  IntegrationsApiError,
} from '../../lib/integrations-api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function bodyOf(call: unknown[]): unknown {
  const init = call[1] as RequestInit | undefined;
  return init?.body === undefined ? undefined : JSON.parse(init.body as string);
}

const telegramStatus = { configured: true, source: 'stored' };
const emailStatus = { configured: true, source: 'stored', from: 'Zilar <a@b.example>' };
const voiceStatus = { configured: true, baseUrl: 'https://api.openai.com/v1', model: 'whisper-1' };

function fullStatus(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    telegram: telegramStatus,
    email: emailStatus,
    voiceTranscription: voiceStatus,
    canManage: true,
    ...overrides,
  };
}

function apiWith(fetchImpl: ReturnType<typeof vi.fn>): ReturnType<typeof createIntegrationsApi> {
  return createIntegrationsApi(async () => 'session-token', fetchImpl as unknown as typeof fetch);
}

describe('buildSaveEmailBody', () => {
  it('omits the key when none is supplied (sender-only change)', () => {
    expect(buildSaveEmailBody({ from: 'Zilar <a@b.example>' })).toEqual({
      from: 'Zilar <a@b.example>',
    });
  });

  it('includes the key when one is supplied', () => {
    expect(buildSaveEmailBody({ from: 'Zilar <a@b.example>', resendApiKey: 're_x' })).toEqual({
      from: 'Zilar <a@b.example>',
      resendApiKey: 're_x',
    });
  });
});

describe('buildSaveVoiceBody', () => {
  it('carries only the base URL when key and model are omitted', () => {
    expect(buildSaveVoiceBody({ baseUrl: 'https://x.example' })).toEqual({
      baseUrl: 'https://x.example',
    });
  });

  it('includes the key and model when supplied', () => {
    expect(
      buildSaveVoiceBody({ baseUrl: 'https://x.example', apiKey: 'sk_x', model: 'whisper-1' }),
    ).toEqual({ baseUrl: 'https://x.example', apiKey: 'sk_x', model: 'whisper-1' });
  });
});

describe('createIntegrationsApi', () => {
  it('loads the status with the bearer header', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(fullStatus()));
    const api = apiWith(fetchImpl);

    await expect(api.getIntegrationsStatus()).resolves.toEqual(fullStatus());
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/settings/integrations');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer session-token');
  });

  it('accepts a missing voiceTranscription slice (older servers)', async () => {
    const { voiceTranscription: _dropped, ...rest } = fullStatus();
    const fetchImpl = vi.fn(async () => jsonResponse(rest));
    const api = apiWith(fetchImpl);

    const status = await api.getIntegrationsStatus();
    expect(status.voiceTranscription).toBeUndefined();
  });

  it('rejects an invalid status shape without touching the message', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ telegram: { configured: true } }));
    const api = apiWith(fetchImpl);

    const error = await api.getIntegrationsStatus().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(IntegrationsApiError);
    expect((error as IntegrationsApiError).code).toBe('invalid_response');
    expect((error as IntegrationsApiError).status).toBe(200);
  });

  it('reads the voice transcription status', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ enabled: true }));
    const api = apiWith(fetchImpl);

    await expect(api.getVoiceTranscriptionStatus()).resolves.toEqual({ enabled: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/voice/transcription');
    expect(init.method).toBe('GET');
  });

  it('saves the bot token with exactly the contract body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const api = apiWith(fetchImpl);

    await api.saveTelegramBotToken('123:ABC');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/settings/integrations/telegram');
    expect(init.method).toBe('PUT');
    expect(bodyOf(fetchImpl.mock.calls[0] as unknown[])).toEqual({ botToken: '123:ABC' });
  });

  it('removes the bot token with DELETE', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const api = apiWith(fetchImpl);

    await api.removeTelegramBotToken();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/settings/integrations/telegram');
    expect(init.method).toBe('DELETE');
  });

  it('saves email without the key when none is supplied', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const api = apiWith(fetchImpl);

    await api.saveEmailSettings({ from: 'Zilar <a@b.example>' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/settings/integrations/email');
    expect(init.method).toBe('PUT');
    expect(bodyOf(fetchImpl.mock.calls[0] as unknown[])).toEqual({
      from: 'Zilar <a@b.example>',
    });
  });

  it('saves the voice endpoint with key and model', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const api = apiWith(fetchImpl);

    await api.saveVoiceTranscriptionSettings({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk_x',
      model: 'whisper-1',
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/settings/integrations/voice-transcription');
    expect(init.method).toBe('PUT');
    expect(bodyOf(fetchImpl.mock.calls[0] as unknown[])).toEqual({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk_x',
      model: 'whisper-1',
    });
  });

  it('removes the voice endpoint with DELETE', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const api = apiWith(fetchImpl);

    await api.removeVoiceTranscriptionSettings();
    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/settings/integrations/voice-transcription');
  });

  it('carries status and code on a failed save', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'invalid_token', message: 'rejected' } }, 422),
    );
    const api = apiWith(fetchImpl);

    const error = await api.saveTelegramBotToken('bad').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(IntegrationsApiError);
    expect((error as IntegrationsApiError).status).toBe(422);
    expect((error as IntegrationsApiError).code).toBe('invalid_token');
  });

  it('answers 404 with the not_found code so the screen can gate non-owners', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404),
    );
    const api = apiWith(fetchImpl);

    const error = await api.getIntegrationsStatus().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(IntegrationsApiError);
    expect((error as IntegrationsApiError).status).toBe(404);
    expect((error as IntegrationsApiError).code).toBe('not_found');
  });

  it('answers a dropped connection as network_error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const api = apiWith(fetchImpl);

    const error = await api.getIntegrationsStatus().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(IntegrationsApiError);
    expect((error as IntegrationsApiError).status).toBe(0);
    expect((error as IntegrationsApiError).code).toBe('network_error');
  });

  it('answers a missing session as unauthorized', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(fullStatus()));
    const api = createIntegrationsApi(async () => undefined, fetchImpl as unknown as typeof fetch);

    const error = await api.getIntegrationsStatus().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(IntegrationsApiError);
    expect((error as IntegrationsApiError).status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

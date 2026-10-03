import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderApp } from '@/test/renderApp';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const baseStatus = {
  telegram: { configured: false, source: null },
  email: { configured: true, source: 'stored', from: 'Zilar <no-reply@mail.example.com>' },
  voiceTranscription: { configured: false, baseUrl: null, model: null },
  canManage: true,
};

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(async (url: unknown, init?: unknown) =>
    handler(url as string, init as RequestInit | undefined),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('IntegrationsPage', () => {
  it('renders inside the shared settings shell with Email above Telegram above Voice', async () => {
    stubFetch(async () => jsonResponse(200, baseStatus));
    const { container } = renderApp('/settings/integrations');

    expect(await screen.findByRole('heading', { name: 'Integrations' })).toBeTruthy();
    expect(container.querySelector('.mx-auto.max-w-2xl')).not.toBeNull();
    const cards = screen.getAllByRole('region');
    expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual([
      'Email',
      'Telegram',
      'Voice transcription',
    ]);
  });

  it('shows the stored sender and saves only the sender', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    stubFetch(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/settings/integrations/email') && init?.method === 'PUT') {
        return jsonResponse(200, { ok: true });
      }
      return jsonResponse(200, baseStatus);
    });
    renderApp('/settings/integrations');

    expect(await screen.findByText(/currently Zilar <no-reply@mail\.example\.com>/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!);
    await screen.findByText(/a test email is on its way/);
    const emailPut = calls.find(
      (call) => call.url.endsWith('/settings/integrations/email') && call.init?.method === 'PUT',
    );
    expect(emailPut).toBeDefined();
    expect(JSON.parse(String(emailPut?.init?.body))).toEqual({
      from: 'Zilar <no-reply@mail.example.com>',
    });
  });

  it('saves with a new key when one is typed', async () => {
    let body: unknown = null;
    stubFetch(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/settings/integrations/email') && init?.method === 'PUT') {
        body = JSON.parse(String(init?.body));
        return jsonResponse(200, { ok: true });
      }
      return jsonResponse(200, baseStatus);
    });
    renderApp('/settings/integrations');

    expect(await screen.findByLabelText('New Resend API key')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('New Resend API key'), {
      target: { value: 're_new_key' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!);
    await screen.findByText(/a test email is on its way/);
    expect(body).toEqual({ from: 'Zilar <no-reply@mail.example.com>', resendApiKey: 're_new_key' });
  });

  it('shows the 422 message when the test send fails', async () => {
    stubFetch(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/settings/integrations/email') && init?.method === 'PUT') {
        return jsonResponse(422, {
          error: { code: 'mail_send_failed', message: 'The test email could not be sent.' },
        });
      }
      return jsonResponse(200, baseStatus);
    });
    renderApp('/settings/integrations');

    expect(await screen.findByLabelText('From address')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/test email could not be sent/);
  });

  it('shows the env-managed state for email', async () => {
    stubFetch(async () =>
      jsonResponse(200, {
        ...baseStatus,
        email: { configured: true, source: 'env', from: 'Zilar <env@example.com>' },
      }),
    );
    renderApp('/settings/integrations');

    expect(await screen.findByText('Managed by environment')).toBeTruthy();
    expect(screen.getByText(/managed by environment variables/)).toBeTruthy();
    expect(screen.queryByLabelText('From address')).toBeNull();
  });

  it('saves and removes a Telegram token with clear errors', async () => {
    const calls: string[] = [];
    stubFetch(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/settings/integrations/telegram') && init?.method === 'PUT') {
        return jsonResponse(200, { ok: true });
      }
      return jsonResponse(200, baseStatus);
    });
    renderApp('/settings/integrations');

    expect(await screen.findByText(/Open @BotFather/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Bot token'), { target: { value: 'tok' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[1]!);
    await screen.findByText(/imports are on/);
    expect(calls).toContain('PUT /api/settings/integrations/telegram');

    stubFetch(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/settings/integrations/telegram') && init?.method === 'PUT') {
        return jsonResponse(422, {
          error: { code: 'invalid_token', message: 'Telegram rejected the bot token.' },
        });
      }
      return jsonResponse(200, baseStatus);
    });
    fireEvent.change(screen.getByLabelText('Bot token'), { target: { value: 'bad' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[1]!);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/rejected the bot token/);
  });

  it('non-owners (404) see a note instead of the cards', async () => {
    stubFetch(async () =>
      jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } }),
    );
    renderApp('/settings/integrations');

    expect(await screen.findByText(/Only the person who runs this server/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Email' })).toBeNull();
  });

  it('a non-404 load failure shows the note with a retry', async () => {
    stubFetch(async () => jsonResponse(500, { error: { code: 'boom', message: 'boom' } }));
    renderApp('/settings/integrations');

    expect(await screen.findByText(/Only the person who runs this server/)).toBeTruthy();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('saves the voice endpoint with the key and model, and shows 422 errors', async () => {
    const calls: string[] = [];
    let savedBody: unknown = null;
    stubFetch(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/settings/integrations/voice-transcription') && init?.method === 'PUT') {
        savedBody = JSON.parse(String(init?.body));
        return jsonResponse(200, { ok: true });
      }
      return jsonResponse(200, baseStatus);
    });
    renderApp('/settings/integrations');

    expect(await screen.findByText(/Any OpenAI-compatible/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.openai.com/v1' },
    });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk_live' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[2]!);
    await screen.findByText(/transcripts are on/);
    expect(calls).toContain('PUT /api/settings/integrations/voice-transcription');
    expect(savedBody).toEqual({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk_live',
      model: 'whisper-1',
    });

    stubFetch(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/settings/integrations/voice-transcription') && init?.method === 'PUT') {
        return jsonResponse(422, {
          error: { code: 'endpoint_rejected', message: 'The endpoint rejected the test.' },
        });
      }
      return jsonResponse(200, baseStatus);
    });
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://bad.example/v1' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[2]!);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/rejected the test request/);
  });

  it('removes the voice endpoint', async () => {
    const calls: string[] = [];
    stubFetch(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/settings/integrations/voice-transcription') && init?.method === 'DELETE') {
        return jsonResponse(200, { ok: true });
      }
      return jsonResponse(200, {
        ...baseStatus,
        voiceTranscription: {
          configured: true,
          baseUrl: 'https://api.openai.com/v1',
          model: 'whisper-1',
        },
      });
    });
    renderApp('/settings/integrations');

    expect(await screen.findByText(/currently whisper-1/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await screen.findByText('Not set up');
    expect(calls).toContain('DELETE /api/settings/integrations/voice-transcription');
  });
});

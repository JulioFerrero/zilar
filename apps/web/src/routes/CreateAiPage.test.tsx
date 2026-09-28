import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { renderApp } from '@/test/renderApp';
import { CreateAiPage, buildBody } from './CreateAiPage';
import { AisPage, buildPatch } from './AisPage';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const activeConnection = {
  id: 'c-1',
  provider: 'openai',
  label: 'Work',
  status: 'active',
  createdAt: '2026-09-28T00:00:00.000Z',
};

const createdAi = {
  id: 'a-1',
  name: 'Dev-1',
  template: 'dev',
  persona: 'You are a concise senior engineer.',
  model: 'gpt-4o',
  jid: 'ai-a-1@galena.test',
  status: 'active',
  providerConnectionId: 'c-1',
  limits: { perDayUsd: 2, perMonthUsd: 20 },
  createdAt: '2026-09-28T00:00:00.000Z',
};

function renderWizard() {
  return render(
    <MemoryRouter initialEntries={['/settings/ais/new']}>
      <Routes>
        <Route path="/settings/ais/new" element={<CreateAiPage />} />
        <Route path="/settings/ais" element={<AisPage />} />
        <Route path="/settings/connections" element={<div>Connections page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderAisPage() {
  return render(
    <MemoryRouter initialEntries={['/settings/ais']}>
      <Routes>
        <Route path="/settings/ais" element={<AisPage />} />
        <Route path="/" element={<div>Chat list</div>} />
        <Route path="/c/:chatJid" element={<div>Chat screen</div>} />
        <Route path="/settings/ais/new" element={<div>Wizard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function bodyOf(call: unknown[]): unknown {
  const init = call[1] as RequestInit | undefined;
  return init?.body === undefined ? undefined : JSON.parse(init.body as string);
}

function methodOf(call: unknown[]): string | undefined {
  return (call[1] as RequestInit | undefined)?.method;
}

// The initial list load; wait past it before asserting request counts so a
// late provider lookup never makes a count flaky.
async function waitForList(fetchMock: ReturnType<typeof vi.fn>): Promise<void> {
  await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildBody', () => {
  const limits = { limits: { perDayUsd: 2, perMonthUsd: 20 }, dayError: '', monthError: '' };

  it('omits persona for an untouched stock template', () => {
    const body = buildBody(
      {
        name: 'Dev-1',
        template: 'dev',
        persona: 'server default text',
        personaTouched: false,
        providerConnectionId: 'c-1',
        model: 'gpt-4o',
        day: '2',
        month: '20',
      },
      limits,
    );
    expect(Object.keys(body ?? {})).toEqual([
      'name',
      'template',
      'providerConnectionId',
      'model',
      'limits',
    ]);
    expect(body).not.toHaveProperty('persona');
  });

  it('sends persona for a custom template and for an edited one', () => {
    const base = {
      name: 'Bot',
      providerConnectionId: 'c-1',
      model: 'gpt-4o',
      day: '2',
      month: '20',
    };
    expect(
      buildBody(
        { ...base, template: 'custom', persona: 'Be a pirate.', personaTouched: true },
        limits,
      ),
    ).toMatchObject({ template: 'custom', persona: 'Be a pirate.' });
    expect(
      buildBody(
        { ...base, template: 'dev', persona: 'Custom text.', personaTouched: true },
        limits,
      ),
    ).toMatchObject({ template: 'dev', persona: 'Custom text.' });
  });
});

describe('buildPatch', () => {
  const originalLimits = { perDayUsd: 2, perMonthUsd: 20 };

  it('returns null when nothing changed', () => {
    expect(
      buildPatch({
        name: 'Dev-1',
        originalName: 'Dev-1',
        persona: 'p',
        originalPersona: 'p',
        limits: originalLimits,
        originalLimits,
      }),
    ).toBeNull();
  });

  it('sends only the fields that changed', () => {
    expect(
      buildPatch({
        name: 'Dev-2',
        originalName: 'Dev-1',
        persona: 'p',
        originalPersona: 'p',
        limits: originalLimits,
        originalLimits,
      }),
    ).toEqual({ name: 'Dev-2' });
    expect(
      buildPatch({
        name: 'Dev-1',
        originalName: 'Dev-1',
        persona: 'p',
        originalPersona: 'p',
        limits: { perDayUsd: 3, perMonthUsd: 20 },
        originalLimits,
      }),
    ).toEqual({ limits: { perDayUsd: 3, perMonthUsd: 20 } });
  });
});

describe('CreateAiPage wizard', () => {
  it('walks every step and POSTs exactly the contract body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, [activeConnection])) // listConnections
      .mockResolvedValueOnce(jsonResponse(201, createdAi)); // createAi
    vi.stubGlobal('fetch', fetchMock);

    renderWizard();
    await screen.findByRole('radio', { name: /Dev/ });
    await waitForList(fetchMock);

    // Step 1: name + template (Dev is the default).
    fireEvent.change(screen.getByPlaceholderText('Dev-1'), { target: { value: 'Dev-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    // Step 2: persona is prefilled; leave it untouched.
    await screen.findByRole('textbox', { name: 'Persona' });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    // Step 3: the active connection.
    fireEvent.click(await screen.findByRole('radio', { name: /OpenAI/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    // Step 4: model.
    const modelInput = await screen.findByLabelText('Model');
    fireEvent.change(modelInput, { target: { value: 'gpt-4o' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    // Step 5: limits keep their defaults.
    await screen.findByLabelText('Per day amount');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    // Step 6: review and create.
    await screen.findByRole('button', { name: 'Create AI' });
    fireEvent.click(screen.getByRole('button', { name: 'Create AI' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.filter((call) => methodOf(call) === 'POST')).toHaveLength(1),
    );
    const post = fetchMock.mock.calls.find((call) => methodOf(call) === 'POST')!;
    expect(String(post[0])).toContain('/api/ais');
    expect(bodyOf(post)).toEqual({
      name: 'Dev-1',
      template: 'dev',
      providerConnectionId: 'c-1',
      model: 'gpt-4o',
      limits: { perDayUsd: 2, perMonthUsd: 20 },
    });
  });

  it('keeps Next disabled on Custom until a persona is entered', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [activeConnection])));

    renderWizard();
    await screen.findByRole('radio', { name: /Custom/ });

    fireEvent.change(screen.getByPlaceholderText('Dev-1'), { target: { value: 'Bot' } });
    fireEvent.click(screen.getByRole('radio', { name: /Custom/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    const persona = await screen.findByRole('textbox', { name: 'Persona' });
    expect(persona.textContent ?? '').toBe('');
    expect((persona as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(persona, { target: { value: 'Be a pirate.' } });
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('shows the no-connections empty state with a link to Connections', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [])));

    renderWizard();
    await screen.findByPlaceholderText('Dev-1');
    fireEvent.change(screen.getByPlaceholderText('Dev-1'), { target: { value: 'Bot' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('You have no active provider connections yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Connections' })).toBeTruthy();
  });

  it('navigates to Connections from the empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [])));

    renderWizard();
    await screen.findByPlaceholderText('Dev-1');

    // Reach step 3 and use the empty-state link.
    fireEvent.change(screen.getByPlaceholderText('Dev-1'), { target: { value: 'Bot' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Connections' }));

    expect(await screen.findByText('Connections page')).toBeTruthy();
  });

  it('blocks Next when day > month and when month > 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [activeConnection])));

    renderWizard();
    await screen.findByRole('radio', { name: /Dev/ });
    fireEvent.change(screen.getByPlaceholderText('Dev-1'), { target: { value: 'Bot' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('radio', { name: /OpenAI/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(await screen.findByLabelText('Model'), { target: { value: 'gpt-4o' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    const day = await screen.findByLabelText('Per day amount');
    const month = screen.getByLabelText('Per month amount');
    const next = screen.getByRole('button', { name: 'Next' });

    fireEvent.change(day, { target: { value: '30' } });
    fireEvent.change(month, { target: { value: '20' } });
    expect(
      await screen.findByText('The daily limit must not exceed the monthly limit'),
    ).toBeTruthy();
    expect((next as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(day, { target: { value: '2' } });
    fireEvent.change(month, { target: { value: '500' } });
    expect(await screen.findByText('The monthly limit must be at most $200')).toBeTruthy();
    expect((next as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(month, { target: { value: '20' } });
    expect((next as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows provider suggestions and a label placeholder on the model step', async () => {
    // Regression for the round-1 bug: the model step received the connection's
    // UUID instead of its provider, so suggestions vanished and the placeholder
    // showed the UUID.
    const uuidConnection = {
      id: 'c31a71e2-cada-40e3-8705-2fc42929bce7',
      provider: 'openai',
      label: 'Work',
      status: 'active',
      createdAt: '2026-09-28T00:00:00.000Z',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [uuidConnection])));

    renderWizard();
    await screen.findByRole('radio', { name: /Dev/ });
    fireEvent.change(screen.getByPlaceholderText('Dev-1'), { target: { value: 'Dev-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('radio', { name: /OpenAI/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    const input = (await screen.findByLabelText('Model')) as HTMLInputElement;
    expect(input.placeholder).toBe('OpenAI model name');
    expect(input.placeholder).not.toContain(uuidConnection.id);

    // The datalist carries the provider's suggestions. jsdom does not resolve
    // `list`, so read the options directly.
    const options = Array.from(document.querySelectorAll('#ai-model-suggestions option')).map(
      (option) => option.getAttribute('value'),
    );
    expect(options).toContain('gpt-4o-mini');

    // The clickable suggestion rows are the visible half of the same data.
    expect(screen.getByRole('radio', { name: 'gpt-4o-mini' })).toBeTruthy();
  });

  it('sends only one request when Create is double-clicked', async () => {
    let resolvePost: ((response: Response) => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, [activeConnection]))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolvePost = resolve;
          }),
      );
    vi.stubGlobal('fetch', fetchMock);

    renderWizard();
    await screen.findByRole('radio', { name: /Dev/ });
    fireEvent.change(screen.getByPlaceholderText('Dev-1'), { target: { value: 'Dev-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('radio', { name: /OpenAI/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(await screen.findByLabelText('Model'), { target: { value: 'gpt-4o' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));

    const create = await screen.findByRole('button', { name: 'Create AI' });
    fireEvent.click(create);
    fireEvent.click(create);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    resolvePost?.(jsonResponse(201, createdAi));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('shows the mapped provisioning message and keeps the inputs after a 502', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, [activeConnection]))
        .mockResolvedValueOnce(
          jsonResponse(502, { error: { code: 'ai_provisioning_failed', message: 'boom' } }),
        ),
    );

    renderWizard();
    await screen.findByRole('radio', { name: /Dev/ });
    fireEvent.change(screen.getByPlaceholderText('Dev-1'), { target: { value: 'Dev-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('radio', { name: /OpenAI/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(await screen.findByLabelText('Model'), { target: { value: 'gpt-4o' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Create AI' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain("The server couldn't finish");
    // Still on Review, with the values kept.
    expect(screen.getByText('Dev-1')).toBeTruthy();
    expect(screen.getByText('gpt-4o')).toBeTruthy();
  });

  it('shows the unavailable state on 503', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(503, { error: { code: 'ais_unavailable', message: 'nope' } }),
        ),
    );

    renderWizard();

    expect(await screen.findByText("AI management isn't configured on this server.")).toBeTruthy();
  });

  it('maps invalid_connection to a clear message and stays on Review', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, [activeConnection]))
        .mockResolvedValueOnce(
          jsonResponse(400, { error: { code: 'invalid_connection', message: 'not yours' } }),
        ),
    );

    renderWizard();
    await screen.findByRole('radio', { name: /Dev/ });
    fireEvent.change(screen.getByPlaceholderText('Dev-1'), { target: { value: 'Dev-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('radio', { name: /OpenAI/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(await screen.findByLabelText('Model'), { target: { value: 'gpt-4o' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create AI' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain("That connection can't be used");
  });
});

describe('AisPage', () => {
  it('shows the loading state first', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [createdAi])));

    renderAisPage();

    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(await screen.findByText('Dev-1')).toBeTruthy();
  });

  it('shows the empty state with a Create call to action', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [])));

    renderAisPage();

    expect(await screen.findByText(/You have no AIs yet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create an AI' })).toBeTruthy();
  });

  it('lists an AI with its template, model and limits', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [createdAi])));

    renderAisPage();

    expect(await screen.findByText('Dev-1')).toBeTruthy();
    expect(screen.getByText(/Dev · gpt-4o/)).toBeTruthy();
    expect(screen.getByText('$2/day · $20/month')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open chat with Dev-1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit Dev-1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete Dev-1' })).toBeTruthy();
  });

  it('shows the error state with the server message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(500, { error: { code: 'boom', message: 'nope' } })),
    );

    renderAisPage();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('nope');
  });

  it('shows the ais_unavailable state', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(503, { error: { code: 'ais_unavailable', message: 'nope' } }),
        ),
    );

    renderAisPage();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      "AI management isn't configured on this server.",
    );
  });

  it('PATCHes only the changed fields on edit', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, [createdAi]))
      .mockResolvedValueOnce(jsonResponse(200, createdAi))
      .mockResolvedValueOnce(jsonResponse(200, [activeConnection]));
    vi.stubGlobal('fetch', fetchMock);

    renderAisPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Dev-1' }));

    fireEvent.change(await screen.findByDisplayValue('Dev-1'), { target: { value: 'Dev-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((call) => (call[1] as RequestInit)?.method === 'PATCH'),
      ).toBe(true),
    );
    const patch = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit)?.method === 'PATCH',
    )!;
    expect(bodyOf(patch)).toEqual({ name: 'Dev-2' });
  });

  it('needs a confirm before deleting, then removes the row', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, [createdAi]))
      .mockResolvedValueOnce(jsonResponse(204, null));
    vi.stubGlobal('fetch', fetchMock);

    renderAisPage();
    await waitForList(fetchMock);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Dev-1' }));

    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
    expect(fetchMock.mock.calls.filter((call) => methodOf(call) === 'DELETE')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.filter((call) => methodOf(call) === 'DELETE')).toHaveLength(1),
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete Dev-1' })).toBeNull());
  });

  it('navigates to My AIs from the main menu', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, []));
    vi.stubGlobal('fetch', fetchMock);

    renderApp('/');

    fireEvent.click(screen.getByLabelText('Open menu'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'My AIs' }));

    expect(await screen.findByRole('heading', { name: 'My AIs' })).toBeTruthy();
    expect(await screen.findByText(/You have no AIs yet/)).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});

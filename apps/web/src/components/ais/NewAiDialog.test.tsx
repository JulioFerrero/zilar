import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { AuthProvider, type AuthState } from '@/auth/AuthProvider';
import { createChatStore } from '@/store/store';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { NewAiDialog } from './NewAiDialog';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const auth: AuthState = {
  status: 'authenticated',
  user: { id: 'u-you', name: 'You', email: 'you@galena.test' },
  refetch: async () => {},
};

const openai = {
  id: 'c-1',
  provider: 'openai',
  label: 'Work',
  status: 'active',
  createdAt: '2026-09-28T00:00:00.000Z',
};

const anthropic = {
  id: 'c-2',
  provider: 'anthropic',
  label: 'Personal',
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
  limits: { perDayUsd: 1, perMonthUsd: 10 },
  createdAt: '2026-09-28T00:00:00.000Z',
};

function ChatProbe() {
  const { chatJid } = useParams();
  return <div>Chat screen {chatJid}</div>;
}

function renderDialog() {
  const store = createChatStore({ chats: [] });
  const onClose = vi.fn();
  render(
    <AuthProvider value={auth}>
      <ChatStoreProvider store={store}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<NewAiDialog onClose={onClose} />} />
            <Route path="/c/:chatJid" element={<ChatProbe />} />
            <Route path="/settings/connections" element={<div>Connections page</div>} />
          </Routes>
        </MemoryRouter>
      </ChatStoreProvider>
    </AuthProvider>,
  );
  return { store, onClose };
}

type FetchMock = ReturnType<typeof vi.fn>;

function methodOf(call: unknown[]): string {
  return (call[1] as RequestInit | undefined)?.method ?? 'GET';
}

function bodyOf(call: unknown[]): unknown {
  const init = call[1] as RequestInit | undefined;
  return init?.body === undefined ? undefined : JSON.parse(init.body as string);
}

function postsTo(fetchMock: FetchMock): unknown[][] {
  return fetchMock.mock.calls.filter((call) => methodOf(call) === 'POST');
}

async function createButtonReady(): Promise<HTMLButtonElement> {
  const button = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  return button;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NewAiDialog', () => {
  it('creates in one screen with safe defaults and lands in the new chat', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, [openai]))
      .mockResolvedValueOnce(jsonResponse(201, createdAi));
    vi.stubGlobal('fetch', fetchMock);

    const { store } = renderDialog();
    const name = await screen.findByLabelText('Name');

    // One active connection: the provider is hidden and used.
    expect(screen.queryByRole('radiogroup', { name: 'Provider connection' })).toBeNull();
    expect(screen.getByText('Using OpenAI.')).toBeTruthy();

    fireEvent.change(name, { target: { value: 'Dev-1' } });
    const create = await createButtonReady();
    fireEvent.click(create);

    await waitFor(() => expect(postsTo(fetchMock)).toHaveLength(1));
    expect(bodyOf(postsTo(fetchMock)[0]!)).toEqual({
      name: 'Dev-1',
      template: 'dev',
      providerConnectionId: 'c-1',
      model: 'gpt-4o',
      limits: { perDayUsd: 1, perMonthUsd: 10 },
    });

    // Lands in the chat and the list knows the new AI immediately.
    expect(await screen.findByText('Chat screen ai-a-1@galena.test')).toBeTruthy();
    expect(store.getState().chats.some((chat) => chat.id === 'ai-a-1@galena.test')).toBe(true);
  });

  it('shows the provider picker with several connections and prefills its default model', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [openai, anthropic])));

    renderDialog();
    await screen.findByLabelText('Name');

    const picker = screen.getByRole('radiogroup', { name: 'Provider connection' });
    expect(picker).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Claude-1' } });
    fireEvent.click(screen.getByRole('radio', { name: /Anthropic/ }));
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));

    const model = (await screen.findByLabelText('Model')) as HTMLInputElement;
    await waitFor(() => expect(model.value).toBe('claude-opus-5-5'));
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('shows the add-a-key state with a button to Connections when there are none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [])));

    renderDialog();
    expect(await screen.findByText(/Add a provider key first/)).toBeTruthy();
    expect(screen.queryByLabelText('Name')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Connections' }));
    expect(await screen.findByText('Connections page')).toBeTruthy();
  });

  it('leaves persona out when unchanged and sends it when edited', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, [openai]))
      .mockResolvedValueOnce(jsonResponse(201, createdAi));
    vi.stubGlobal('fetch', fetchMock);

    renderDialog();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Dev-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));

    const persona = screen.getByLabelText('Persona');
    fireEvent.change(persona, { target: { value: 'Be a pirate.' } });

    fireEvent.click(await createButtonReady());
    await waitFor(() => expect(postsTo(fetchMock)).toHaveLength(1));
    expect(bodyOf(postsTo(fetchMock)[0]!)).toMatchObject({ persona: 'Be a pirate.' });
  });

  it('keeps Create disabled on Custom until a persona is entered', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [openai])));

    renderDialog();
    await screen.findByLabelText('Name');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bot' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));

    const create = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.change(screen.getByLabelText('Persona'), { target: { value: 'Be a pirate.' } });
    expect(create.disabled).toBe(false);
  });

  it('sets the model input when a suggestion is clicked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [openai])));

    renderDialog();
    await screen.findByLabelText('Name');
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));

    const input = (await screen.findByLabelText('Model')) as HTMLInputElement;
    expect(input.value).toBe('gpt-4o');
    fireEvent.click(screen.getByRole('radio', { name: 'gpt-4o-mini' }));
    expect(input.value).toBe('gpt-4o-mini');
  });

  it('sends only one POST on a double click', async () => {
    let resolvePost: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') {
        return new Promise<Response>((resolve) => {
          resolvePost = resolve;
        });
      }
      return Promise.resolve(jsonResponse(200, [openai]));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderDialog();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Dev-1' } });
    const create = await createButtonReady();
    fireEvent.click(create);
    fireEvent.click(create);

    await waitFor(() => expect(postsTo(fetchMock)).toHaveLength(1));
    resolvePost?.(jsonResponse(201, createdAi));
    await screen.findByText('Chat screen ai-a-1@galena.test');
    expect(postsTo(fetchMock)).toHaveLength(1);
  });

  it('keeps the dialog open with the values after a server error', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, [openai]))
        .mockResolvedValueOnce(
          jsonResponse(502, { error: { code: 'ai_provisioning_failed', message: 'boom' } }),
        ),
    );

    renderDialog();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Dev-1' } });
    fireEvent.click(await createButtonReady());

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain("The server couldn't finish");
    expect(screen.getByRole('dialog', { name: 'New AI' })).toBeTruthy();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Dev-1');
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

    renderDialog();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      "AI management isn't configured on this server.",
    );
  });

  it('closes on Escape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [openai])));

    const { onClose } = renderDialog();
    await screen.findByLabelText('Name');

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

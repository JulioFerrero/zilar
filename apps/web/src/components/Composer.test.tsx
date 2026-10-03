import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { AuthProvider } from '@/auth/AuthProvider';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore } from '@/store/store';
import { renderApp } from '@/test/renderApp';
import { MAX_ATTACHMENT_BYTES } from '@/lib/attachments';
import { Composer } from './Composer';

afterEach(() => {
  vi.useRealTimers();
});

describe('Composer', () => {
  it('shows the mic when empty and the send button with text', () => {
    renderApp('/c/c-ana');

    expect(screen.getByLabelText('Record voice message')).toBeTruthy();
    expect(screen.queryByLabelText('Send message')).toBeNull();

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hello' } });

    expect(screen.getByLabelText('Send message')).toBeTruthy();
    expect(screen.queryByLabelText('Record voice message')).toBeNull();

    const textarea = screen.getByLabelText('Message') as HTMLTextAreaElement;
    expect(textarea.id).toBe('message-composer');
    expect(textarea.getAttribute('name')).toBe('message');
  });

  it('gives the chat search input an id and name', () => {
    renderApp('/');

    const search = screen.getByLabelText('Search chats') as HTMLInputElement;
    expect(search.id).toBe('chat-search');
    expect(search.getAttribute('name')).toBe('chat-search');
  });

  it('sends on Enter and moves the message from sending to sent to read', () => {
    vi.useFakeTimers();
    const { store } = renderApp('/c/c-ana');
    const before = store.getState().messages('c-ana').length;

    const textarea = screen.getByLabelText('Message');
    fireEvent.change(textarea, { target: { value: 'ping' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    const afterSend = store.getState().messages('c-ana');
    expect(afterSend).toHaveLength(before + 1);
    expect(afterSend.at(-1)?.status).toBe('sending');
    expect(within(screen.getByTestId('message-list')).getByText('ping')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(store.getState().messages('c-ana').at(-1)?.status).toBe('sent');

    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(store.getState().messages('c-ana').at(-1)?.status).toBe('read');
  });

  it('does not send on Shift+Enter', () => {
    const { store } = renderApp('/c/c-ana');
    const before = store.getState().messages('c-ana').length;

    const textarea = screen.getByLabelText('Message');
    fireEvent.change(textarea, { target: { value: 'line' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    expect(store.getState().messages('c-ana')).toHaveLength(before);
  });
});

describe('Composer mentions (T-0053)', () => {
  function openPicker(value: string, caret = value.length) {
    const textarea = screen.getByLabelText('Message') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value, selectionStart: caret } });
    return textarea;
  }

  it('opens the member picker when @ is typed in a group', () => {
    renderApp('/c/c-viernes');

    expect(screen.queryByRole('listbox')).toBeNull();
    openPicker('@');

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByText('Luis')).toBeTruthy();
    // The current user is never offered.
    expect(within(listbox).queryByText('You')).toBeNull();
  });

  it('filters members by the query, ignoring case and accents', () => {
    renderApp('/c/c-viernes');

    openPicker('@ma');
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByText('Marta')).toBeTruthy();
    expect(within(listbox).getByText('Marco')).toBeTruthy();
    expect(within(listbox).queryByText('Ana')).toBeNull();
    expect(within(listbox).queryByText('Luis')).toBeNull();
  });

  it('offers a member by handle even when the display name does not match', () => {
    renderApp('/c/c-viernes');

    openPicker('@lui');
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByText('Luis')).toBeTruthy();
    expect(
      within(screen.getByRole('option', { name: 'Luis @luis' })).getByText('@luis'),
    ).toBeTruthy();
  });

  it('inserts @handle and keeps the mention JID', () => {
    const { store } = renderApp('/c/c-viernes');
    const textarea = openPicker('@marc');

    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(textarea.value).toBe('@marco ');
    fireEvent.keyDown(textarea, { key: 'Enter' });

    const sent = store.getState().messages('c-viernes').at(-1);
    expect(sent?.text).toBe('@marco');
    expect(sent?.mentions).toEqual([
      { jid: 'u-marco@zilar.test', name: 'Marco', begin: 0, end: 6 },
    ]);
  });

  it('distinguishes two members with the same display name by handle', () => {
    renderApp('/c/c-viernes', {
      currentUserId: 'u-you',
      groupInfos: {
        'c-viernes': {
          id: 'g-viernes',
          title: 'Viernes 🍻',
          createdBy: 'u-luis',
          members: [
            { userId: 'u-you', name: 'You', role: 'member', handle: 'you' },
            { userId: 'u-alex-1', name: 'Alex', role: 'member', handle: 'alex' },
            { userId: 'u-alex-2', name: 'Alex', role: 'member', handle: 'alex_r' },
          ],
          ais: [],
        },
      },
    });

    openPicker('@alex');
    const options = screen.getAllByRole('option', { name: /Alex @alex/ });
    expect(options).toHaveLength(2);
    expect(within(options[0]!).getByText('@alex')).toBeTruthy();
    expect(within(options[1]!).getByText('@alex_r')).toBeTruthy();
  });

  it('inserts @Name for a member without a handle', () => {
    renderApp('/c/c-viernes', {
      currentUserId: 'u-you',
      groupInfos: {
        'c-viernes': {
          id: 'g-viernes',
          title: 'Viernes 🍻',
          createdBy: 'u-luis',
          members: [
            { userId: 'u-you', name: 'You', role: 'member' },
            { userId: 'u-nora', name: 'Nora', role: 'member' },
          ],
          ais: [],
        },
      },
    });

    const textarea = openPicker('@no');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(textarea.value).toBe('@Nora ');
  });

  it('moves the selection with the arrow keys and picks with Enter', () => {
    renderApp('/c/c-viernes');
    const textarea = openPicker('@');

    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(textarea.value).toBe('@marta ');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('picks with Tab and sends the mention with the message', () => {
    const { store } = renderApp('/c/c-viernes');
    const textarea = openPicker('@lu');

    fireEvent.keyDown(textarea, { key: 'Tab' });
    expect(textarea.value).toBe('@luis ');
    fireEvent.keyDown(textarea, { key: 'Enter' });

    const sent = store.getState().messages('c-viernes').at(-1);
    expect(sent?.text).toBe('@luis');
    expect(sent?.mentions).toEqual([{ jid: 'u-luis@zilar.test', name: 'Luis', begin: 0, end: 5 }]);
  });

  it('closes the picker with Escape without changing the text', () => {
    renderApp('/c/c-viernes');
    const textarea = openPicker('@an');

    fireEvent.keyDown(textarea, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(textarea.value).toBe('@an');
  });

  it('removes the whole mention when Backspace lands in it', () => {
    renderApp('/c/c-viernes');
    const textarea = openPicker('@');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(textarea.value).toBe('@luis ');

    textarea.setSelectionRange(5, 5);
    fireEvent.keyDown(textarea, { key: 'Backspace' });

    expect(textarea.value).toBe(' ');
  });

  it('drops a mention when it is edited', () => {
    const { store } = renderApp('/c/c-viernes');
    const textarea = openPicker('@');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(textarea.value).toBe('@luis ');

    fireEvent.change(textarea, { target: { value: '@luiX ' } });
    fireEvent.change(textarea, { target: { value: '@luiX hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    const sent = store.getState().messages('c-viernes').at(-1);
    expect(sent?.text).toBe('@luiX hello');
    expect(sent?.mentions).toBeUndefined();
  });

  it('sends plain @word text with no mention when nothing was picked', () => {
    const { store } = renderApp('/c/c-viernes');
    const textarea = openPicker('@something');

    fireEvent.keyDown(textarea, { key: 'Escape' });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    const sent = store.getState().messages('c-viernes').at(-1);
    expect(sent?.text).toBe('@something');
    expect(sent?.mentions).toBeUndefined();
  });

  it('does not open the picker in a DM', () => {
    renderApp('/c/c-ana');

    openPicker('@');

    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('Composer edit mode (T-0061)', () => {
  function messageList() {
    return within(screen.getByTestId('message-list'));
  }

  function startEdit(text = 'On my way') {
    fireEvent.contextMenu(messageList().getByText(text));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
  }

  it('prefills the edit bar and saves with Enter', () => {
    const { store } = renderApp('/c/c-viernes');

    startEdit();
    expect(screen.getByText('Edit message')).toBeTruthy();
    const textarea = screen.getByLabelText('Message') as HTMLTextAreaElement;
    expect(textarea.value).toBe('On my way');

    fireEvent.change(textarea, { target: { value: 'On my way now' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    const edited = store
      .getState()
      .messages('c-viernes')
      .find((m) => m.id === 'vie-22');
    expect(edited?.text).toBe('On my way now');
    expect(edited?.edited).toBe(true);
    expect(screen.queryByText('Edit message')).toBeNull();
  });

  it('cancels an edit with Escape without saving', () => {
    const { store } = renderApp('/c/c-viernes');

    startEdit();
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'discarded' } });
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Escape' });

    expect(screen.queryByText('Edit message')).toBeNull();
    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('');
    expect(
      store
        .getState()
        .messages('c-viernes')
        .find((m) => m.id === 'vie-22')?.text,
    ).toBe('On my way');
  });

  it('sends nothing when the text did not change', () => {
    const { store } = renderApp('/c/c-viernes');

    startEdit();
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' });

    expect(screen.queryByText('Edit message')).toBeNull();
    const message = store
      .getState()
      .messages('c-viernes')
      .find((m) => m.id === 'vie-22');
    expect(message?.text).toBe('On my way');
    expect(message?.edited).toBeUndefined();
  });

  it('disables the save key for an empty edit', () => {
    renderApp('/c/c-viernes');

    startEdit();
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: '   ' } });

    expect((screen.getByLabelText('Save edit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('edits my last editable message with ArrowUp in an empty composer', () => {
    renderApp('/c/c-viernes');

    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'ArrowUp' });

    expect(screen.getByText('Edit message')).toBeTruthy();
    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('On my way');
  });

  it('keeps edit and reply exclusive', () => {
    renderApp('/c/c-viernes');

    fireEvent.contextMenu(screen.getByText('Friday plans?'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reply' }));
    expect(screen.getByText('Reply to Luis')).toBeTruthy();

    startEdit();
    expect(screen.queryByText('Reply to Luis')).toBeNull();
    expect(screen.getByText('Edit message')).toBeTruthy();

    fireEvent.contextMenu(screen.getByText('Friday plans?'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reply' }));
    expect(screen.queryByText('Edit message')).toBeNull();
    expect(screen.getByText('Reply to Luis')).toBeTruthy();
  });
});

describe('Composer chat switching (T-0053 review)', () => {
  function renderComposer(initialChatId: string) {
    const store = createChatStore();
    const auth = {
      status: 'authenticated' as const,
      user: { id: 'u-you', name: 'You', email: 'you@zilar.test' },
      refetch: async () => {},
    };
    const tree = (chatId: string) => (
      <AuthProvider value={auth}>
        <ChatStoreProvider store={store}>
          <Composer chatId={chatId} replyTo={undefined} onCancelReply={() => {}} />
        </ChatStoreProvider>
      </AuthProvider>
    );
    return { ...render(tree(initialChatId)), store, tree };
  }

  it('clears a picked mention and closes the picker when the chat changes', () => {
    const { rerender, store, tree } = renderComposer('c-viernes');
    const textarea = screen.getByLabelText('Message') as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: '@' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(textarea.value).toBe('@luis ');
    expect(screen.queryByRole('listbox')).toBeNull();

    rerender(tree('c-devteam'));
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' });

    const sent = store.getState().messages('c-devteam').at(-1);
    expect(sent?.text).toBe('@luis');
    expect(sent?.mentions).toBeUndefined();
  });
});

describe('Composer attachments (T-0065)', () => {
  function picker(container: HTMLElement): HTMLInputElement {
    const input = container.querySelector('input[type="file"]');
    if (input === null) {
      throw new Error('the composer has no file input');
    }
    return input as HTMLInputElement;
  }

  it('opens the preview from the file picker and sends it with a caption', () => {
    const { container, store } = renderApp('/c/c-ana');
    const file = new File(['abcd'], 'stage.png', { type: 'image/png' });

    fireEvent.change(picker(container), { target: { files: [file] } });
    expect(screen.getByText('stage.png')).toBeTruthy();
    expect(screen.getByLabelText('Remove attachment')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'the stage' } });
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' });

    const sent = store.getState().messages('c-ana').at(-1);
    expect(sent?.attachment?.name).toBe('stage.png');
    expect(sent?.attachment?.kind).toBe('image');
    expect(sent?.text).toBe('the stage');
    expect(screen.queryByText('stage.png')).toBeNull();
  });

  it('opens the preview from a pasted image', () => {
    renderApp('/c/c-ana');
    const file = new File(['abcd'], 'paste.png', { type: 'image/png' });

    fireEvent.paste(screen.getByLabelText('Message'), { clipboardData: { files: [file] } });

    expect(screen.getByText('paste.png')).toBeTruthy();
  });

  it('opens the preview from a dropped file', () => {
    renderApp('/c/c-ana');
    const file = new File(['abcd'], 'dropped.pdf', { type: 'application/pdf' });

    fireEvent.drop(document.body, { dataTransfer: { files: [file] } });

    expect(screen.getByText('dropped.pdf')).toBeTruthy();
  });

  it('cancels the preview with the ✕ and with Escape when the caption is empty', () => {
    const { container } = renderApp('/c/c-ana');
    const file = new File(['abcd'], 'stage.png', { type: 'image/png' });

    fireEvent.change(picker(container), { target: { files: [file] } });
    fireEvent.click(screen.getByLabelText('Remove attachment'));
    expect(screen.queryByText('stage.png')).toBeNull();

    fireEvent.change(picker(container), { target: { files: [file] } });
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Escape' });
    expect(screen.queryByText('stage.png')).toBeNull();
  });

  it('refuses an oversize or empty file with the inline error and no preview', () => {
    const { container } = renderApp('/c/c-ana');
    const oversize = new File(['x'], 'big.bin', { type: 'application/octet-stream' });
    Object.defineProperty(oversize, 'size', { value: MAX_ATTACHMENT_BYTES + 1 });

    fireEvent.change(picker(container), { target: { files: [oversize] } });
    expect(screen.getByText('That file is larger than 50 MB.')).toBeTruthy();
    expect(screen.queryByText('big.bin')).toBeNull();

    const empty = new File([], 'empty.png', { type: 'image/png' });
    fireEvent.change(picker(container), { target: { files: [empty] } });
    expect(screen.getByText('That file is empty.')).toBeTruthy();
  });
});

describe('Composer GIFs (T-0122)', () => {
  it('replaces "Coming soon" with the GIFs tab content', async () => {
    const api = await import('@/lib/api');
    vi.spyOn(api, 'listStickerPacks').mockResolvedValue([]);
    vi.spyOn(api, 'discoverStickerPacks').mockResolvedValue({ packs: [], next: null });
    renderApp('/c/c-ana');
    fireEvent.click(screen.getByLabelText('Open sticker panel'));
    fireEvent.click(screen.getByRole('tab', { name: 'GIFs' }));
    expect(screen.queryByText('Coming soon')).toBeNull();
    expect(screen.getByLabelText('Search GIFs')).toBeTruthy();
  });

  it('sends a picked GIF through the attachment path with the proxy bytes', async () => {
    const api = await import('@/lib/api');
    vi.spyOn(api, 'listStickerPacks').mockResolvedValue([]);
    vi.spyOn(api, 'discoverStickerPacks').mockResolvedValue({ packs: [], next: null });
    // `renderApp` runs in mock mode, so the panel shows the generated
    // placeholders. Their `url` is app-generated data art; the send path
    // fetches it like proxy bytes and uploads through the existing path.
    const { store } = renderApp('/c/c-ana');
    fireEvent.click(screen.getByLabelText('Open sticker panel'));
    fireEvent.click(screen.getByRole('tab', { name: 'GIFs' }));
    const grid = await screen.findByRole('grid', { name: 'GIFs' });
    const before = store.getState().messages('c-ana').length;
    fireEvent.click(within(grid).getByLabelText('Send 🐱 dancing'));
    await vi.waitFor(() => {
      expect(store.getState().messages('c-ana')).toHaveLength(before + 1);
    });
    const sent = store.getState().messages('c-ana').at(-1);
    expect(sent?.attachment?.kind).toBe('image');
    expect(sent?.attachment?.mime).toBe('image/gif');
  });

  it('names and types a webm GIF from the blob content type, not the result kind', async () => {
    const api = await import('@/lib/api');
    vi.spyOn(api, 'listStickerPacks').mockResolvedValue([]);
    vi.spyOn(api, 'discoverStickerPacks').mockResolvedValue({ packs: [], next: null });
    // The search result claims video/mp4 while the proxy serves webm: the
    // stored attachment must carry the real bytes' type. (A bare object is
    // stubbed instead of `new Response`, whose `blob()` drops the type.)
    const webm = new Blob(['webm-bytes'], { type: 'video/webm' });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input: string | URL | Request) =>
        String(input).startsWith('data:')
          ? Promise.resolve({ ok: true, blob: () => Promise.resolve(webm) } as Response)
          : Promise.reject(new Error(`unexpected fetch ${String(input)}`)),
      );
    try {
      const { store } = renderApp('/c/c-ana');
      fireEvent.click(screen.getByLabelText('Open sticker panel'));
      fireEvent.click(screen.getByRole('tab', { name: 'GIFs' }));
      const grid = await screen.findByRole('grid', { name: 'GIFs' });
      const before = store.getState().messages('c-ana').length;
      fireEvent.click(within(grid).getByLabelText('Send 🐱 dancing'));
      await vi.waitFor(() => {
        expect(store.getState().messages('c-ana')).toHaveLength(before + 1);
      });
      const sent = store.getState().messages('c-ana').at(-1);
      expect(sent?.attachment?.kind).toBe('file');
      expect(sent?.attachment?.mime).toBe('video/webm');
      expect(sent?.attachment?.name).toMatch(/^gif-.+\.webm$/);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('shows an inline error when the proxy fetch fails', async () => {
    const api = await import('@/lib/api');
    vi.spyOn(api, 'listStickerPacks').mockResolvedValue([]);
    vi.spyOn(api, 'discoverStickerPacks').mockResolvedValue({ packs: [], next: null });
    // Break the fetch so the placeholder bytes cannot load.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'));
    try {
      const { store } = renderApp('/c/c-ana');
      fireEvent.click(screen.getByLabelText('Open sticker panel'));
      fireEvent.click(screen.getByRole('tab', { name: 'GIFs' }));
      const grid = await screen.findByRole('grid', { name: 'GIFs' });
      const before = store.getState().messages('c-ana').length;
      fireEvent.click(within(grid).getByLabelText('Send 🐱 dancing'));
      await vi.waitFor(() => {
        expect(screen.getByText('Could not load that GIF. Try another.')).toBeTruthy();
      });
      expect(store.getState().messages('c-ana')).toHaveLength(before);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

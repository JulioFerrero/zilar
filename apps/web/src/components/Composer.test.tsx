import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { AuthProvider } from '@/auth/AuthProvider';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore } from '@/store/store';
import { renderApp } from '@/test/renderApp';
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

  it('moves the selection with the arrow keys and picks with Enter', () => {
    renderApp('/c/c-viernes');
    const textarea = openPicker('@');

    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(textarea.value).toBe('@Marta ');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('picks with Tab and sends the mention with the message', () => {
    const { store } = renderApp('/c/c-viernes');
    const textarea = openPicker('@lu');

    fireEvent.keyDown(textarea, { key: 'Tab' });
    expect(textarea.value).toBe('@Luis ');
    fireEvent.keyDown(textarea, { key: 'Enter' });

    const sent = store.getState().messages('c-viernes').at(-1);
    expect(sent?.text).toBe('@Luis');
    expect(sent?.mentions).toEqual([{ jid: 'u-luis@galena.test', name: 'Luis', begin: 0, end: 5 }]);
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
    expect(textarea.value).toBe('@Luis ');

    textarea.setSelectionRange(5, 5);
    fireEvent.keyDown(textarea, { key: 'Backspace' });

    expect(textarea.value).toBe(' ');
  });

  it('drops a mention when it is edited', () => {
    const { store } = renderApp('/c/c-viernes');
    const textarea = openPicker('@');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(textarea.value).toBe('@Luis ');

    fireEvent.change(textarea, { target: { value: '@LuiX ' } });
    fireEvent.change(textarea, { target: { value: '@LuiX hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    const sent = store.getState().messages('c-viernes').at(-1);
    expect(sent?.text).toBe('@LuiX hello');
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

describe('Composer chat switching (T-0053 review)', () => {
  function renderComposer(initialChatId: string) {
    const store = createChatStore();
    const auth = {
      status: 'authenticated' as const,
      user: { id: 'u-you', name: 'You', email: 'you@galena.test' },
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
    expect(textarea.value).toBe('@Luis ');
    expect(screen.queryByRole('listbox')).toBeNull();

    rerender(tree('c-devteam'));
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' });

    const sent = store.getState().messages('c-devteam').at(-1);
    expect(sent?.text).toBe('@Luis');
    expect(sent?.mentions).toBeUndefined();
  });
});

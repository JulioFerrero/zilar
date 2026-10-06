import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { renderApp } from '@/test/renderApp';

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('message actions', () => {
  it('opens on right-click and closes with Escape', () => {
    renderApp('/c/c-viernes');

    fireEvent.contextMenu(screen.getByText('Friday plans?'));

    const menu = screen.getByRole('menu', { name: 'Message actions' });
    expect(screen.getByRole('menuitem', { name: 'Reply' })).toBeTruthy();
    // Friday plans? is Luis's message: no Edit and no Delete for everyone.
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull();
    expect(
      (screen.getByRole('menuitem', { name: 'Delete for everyone' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Message actions' })).toBeNull();
  });

  it('closes with Escape pressed outside the menu', () => {
    renderApp('/c/c-viernes');

    fireEvent.contextMenu(screen.getByText('Friday plans?'));
    expect(screen.getByRole('menu', { name: 'Message actions' })).toBeTruthy();

    (document.body as HTMLElement).focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Message actions' })).toBeNull();
  });

  it('shows the reply bar and cancels it with the × button', () => {
    renderApp('/c/c-viernes');

    fireEvent.contextMenu(screen.getByText('Friday plans?'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reply' }));

    expect(screen.getByText('Reply to Luis')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Cancel reply'));
    expect(screen.queryByText('Reply to Luis')).toBeNull();
  });

  it('cancels a reply with Escape while the composer is focused', () => {
    renderApp('/c/c-viernes');

    fireEvent.contextMenu(screen.getByText('Friday plans?'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reply' }));
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Escape' });

    expect(screen.queryByText('Reply to Luis')).toBeNull();
  });

  it('sends a reply and renders the quote in the new bubble', () => {
    const { store } = renderApp('/c/c-viernes');

    fireEvent.contextMenu(screen.getByText('Friday plans?'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reply' }));
    const textarea = screen.getByLabelText('Message');
    fireEvent.change(textarea, { target: { value: 'See you there' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    const list = screen.getByTestId('message-list');
    const row = within(list).getByText('See you there').closest('[data-message-id]');
    expect(row?.textContent).toContain('Luis');
    expect(row?.textContent).toContain('Friday plans?');
    expect(store.getState().messages('c-viernes').at(-1)?.replyTo?.senderName).toBe('Luis');
    expect(screen.queryByText('Reply to Luis')).toBeNull();
  });

  it('copies the message text to the clipboard', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    renderApp('/c/c-viernes');
    fireEvent.contextMenu(screen.getByText('Friday plans?'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy text' }));

    expect(writeText).toHaveBeenCalledWith('Friday plans?');
  });
});

describe('edit and delete for everyone (T-0061)', () => {
  function seededChat(messages: UiMessage[]) {
    const chat: ChatSummary = {
      id: 'c-x',
      title: 'Test',
      kind: 'dm',
      isAI: false,
      space: 'personal',
      unread: 0,
      muted: false,
    };
    return { chats: [chat], messagesByChat: { 'c-x': messages } };
  }

  const now = Date.now();
  function baseMessage(overrides: Partial<UiMessage> & { id: string }): UiMessage {
    return {
      chatId: 'c-x',
      senderId: 'u-you',
      senderName: 'You',
      text: 'message text',
      createdAt: new Date(now - 60_000),
      status: 'sent',
      ...overrides,
    };
  }

  it('shows Edit only for my own recent text message', () => {
    const seed = seededChat([
      baseMessage({ id: 'm-mine', text: 'mine text' }),
      baseMessage({
        id: 'm-old',
        text: 'old text',
        createdAt: new Date(now - 49 * 60 * 60 * 1000),
      }),
      {
        id: 'm-voice',
        chatId: 'c-x',
        senderId: 'u-you',
        senderName: 'You',
        createdAt: new Date(now - 60_000),
        status: 'sent',
        voice: { duration_ms: 1000, mime: 'audio/mp4', waveform: [1] },
      },
      baseMessage({ id: 'm-theirs', senderId: 'u-ana', senderName: 'Ana', text: 'theirs text' }),
    ]);
    renderApp('/c/c-x', seed);
    const list = within(screen.getByTestId('message-list'));

    fireEvent.contextMenu(list.getByText('mine text'));
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeTruthy();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.contextMenu(list.getByText('old text'));
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.contextMenu(list.getByText('theirs text'));
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    const voiceRow = document.querySelector('[data-message-id="m-voice"]');
    expect(voiceRow).not.toBeNull();
    fireEvent.contextMenu(voiceRow as Element);
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull();
  });

  it('confirms a delete for everyone and replaces the bubble with a tombstone', () => {
    renderApp('/c/c-viernes');
    const list = within(screen.getByTestId('message-list'));

    fireEvent.contextMenu(list.getByText('On my way'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete for everyone' }));

    const dialog = screen.getByRole('dialog', { name: 'Delete message?' });
    expect(screen.getByText('This deletes it for everyone in the chat.')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(screen.queryByRole('dialog', { name: 'Delete message?' })).toBeNull();
    const row = document.querySelector('[data-message-id="vie-22"]');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).queryByText('On my way')).toBeNull();
    expect(within(row as HTMLElement).getByText('You deleted this message')).toBeTruthy();
  });

  it('cancels the delete dialog with Escape', () => {
    renderApp('/c/c-viernes');
    const list = within(screen.getByTestId('message-list'));

    fireEvent.contextMenu(list.getByText('On my way'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete for everyone' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete message?' });
    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Delete message?' })).toBeNull();
    expect(list.getByText('On my way')).toBeTruthy();
  });

  it('shows the edited label and both tombstones', () => {
    renderApp('/c/c-viernes');
    const list = within(screen.getByTestId('message-list'));

    const editedRow = document.querySelector('[data-message-id="vie-23"]');
    expect(editedRow).not.toBeNull();
    expect(within(editedRow as HTMLElement).getByText('edited')).toBeTruthy();

    expect(list.getByText('This message was deleted')).toBeTruthy();
    expect(list.getByText('You deleted this message')).toBeTruthy();
  });

  it('does not open the menu on a tombstone', () => {
    renderApp('/c/c-viernes');
    const list = within(screen.getByTestId('message-list'));

    const tombstone = list.getByText('You deleted this message').closest('[data-message-id]');
    expect(tombstone).not.toBeNull();
    expect(within(tombstone as HTMLElement).queryByLabelText('Message actions')).toBeNull();

    fireEvent.contextMenu(tombstone as Element);
    expect(screen.queryByRole('menu', { name: 'Message actions' })).toBeNull();
  });
});

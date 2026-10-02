import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { renderApp } from '@/test/renderApp';

const chat: ChatSummary = {
  id: 'c-at',
  title: 'Ana',
  kind: 'dm',
  isAI: false,
  space: 'personal',
  unread: 0,
  muted: false,
};

function message(overrides: Partial<UiMessage>): UiMessage {
  return {
    id: 'm1',
    chatId: 'c-at',
    senderId: 'u-ana',
    senderName: 'Ana',
    createdAt: new Date(2026, 8, 27, 12, 0),
    status: 'read',
    ...overrides,
  };
}

function render(message: UiMessage) {
  return renderApp('/c/c-at', { chats: [chat], messagesByChat: { 'c-at': [message] } });
}

describe('attachment bubbles (T-0065)', () => {
  it('renders an image attachment as a lazy image with a reserved ratio', () => {
    render(
      message({
        attachment: {
          kind: 'image',
          url: 'https://files.zilar.test/stage.png',
          name: 'stage.png',
          size: 200,
          mime: 'image/png',
          width: 800,
          height: 400,
        },
      }),
    );

    const list = screen.getByTestId('message-list');
    const image = within(list).getByRole('img') as HTMLImageElement;
    expect(image.getAttribute('alt')).toBe('stage.png');
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.style.aspectRatio).toBe('800 / 400');

    const link = within(list).getByRole('link');
    expect(link.getAttribute('href')).toBe('https://files.zilar.test/stage.png');
  });

  it('renders a file attachment as a card with a download link', () => {
    render(
      message({
        attachment: {
          kind: 'file',
          url: 'https://files.zilar.test/tickets.pdf',
          name: 'tickets.pdf',
          size: 2_411_724,
          mime: 'application/pdf',
        },
      }),
    );

    const list = screen.getByTestId('message-list');
    expect(within(list).getByText('tickets.pdf')).toBeTruthy();
    expect(within(list).getByText('2.3 MB · application/pdf')).toBeTruthy();
    expect(within(list).getByLabelText('Download tickets.pdf')).toBeTruthy();
  });

  it('shows Upload failed and a Retry on a failed image attachment', () => {
    render(
      message({
        failed: true,
        attachment: {
          kind: 'image',
          url: 'https://files.zilar.test/stage.png',
          name: 'stage.png',
          size: 200,
          mime: 'image/png',
        },
      }),
    );

    const list = screen.getByTestId('message-list');
    expect(within(list).getByText('Upload failed')).toBeTruthy();
    expect(within(list).getByLabelText('Retry upload')).toBeTruthy();
  });

  it('never turns a javascript: attachment URL into a link', () => {
    render(
      message({
        attachment: {
          kind: 'file',
          url: 'javascript:alert(1)',
          name: 'evil.pdf',
          size: 10,
          mime: 'application/pdf',
        },
      }),
    );

    const list = screen.getByTestId('message-list');
    expect(within(list).queryByRole('link')).toBeNull();
    expect(within(list).getByText('evil.pdf')).toBeTruthy();
  });

  it('renders a gif- video attachment on an attacker host as a file card, never auto-loading it', () => {
    // The mock store carries no media hosts, so every absolute URL is
    // untrusted here — exactly the attacker's case after the real store's
    // sanitizer strips the prefix. Either layer alone must stop the fetch.
    render(
      message({
        attachment: {
          kind: 'file',
          url: 'https://attacker.test/x.mp4',
          name: 'gif-x',
          size: 1024,
          mime: 'video/mp4',
        },
      }),
    );

    const list = screen.getByTestId('message-list');
    expect(document.querySelector('video')).toBeNull();
    expect(document.querySelector('[src="https://attacker.test/x.mp4"]')).toBeNull();
    expect(within(list).getByText('gif-x')).toBeTruthy();
  });

  it('becomes a tombstone when a deleted attachment message is retracted', async () => {
    const { store } = renderApp('/c/c-at', {
      currentUserId: 'u-you',
      chats: [chat],
      messagesByChat: {
        'c-at': [
          message({
            senderId: 'u-you',
            senderName: 'You',
            attachment: {
              kind: 'file',
              url: 'https://files.zilar.test/tickets.pdf',
              name: 'tickets.pdf',
              size: 100,
              mime: 'application/pdf',
            },
          }),
        ],
      },
    });

    store.getState().deleteForEveryone('c-at', 'm1');

    expect(store.getState().messages('c-at')[0]?.deleted).toBe(true);
    await waitFor(() => expect(screen.getByText('You deleted this message')).toBeTruthy());
    expect(screen.queryByText('tickets.pdf')).toBeNull();
  });
});

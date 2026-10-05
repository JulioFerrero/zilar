import { describe, expect, it } from 'vitest';
import type { UiMessage } from './types';
import {
  groupMessages,
  previewBody,
  previewPrefix,
  previewText,
  unreadDividerIndex,
} from './messages';

type MessageOverrides = Partial<UiMessage> & Pick<UiMessage, 'id' | 'senderId' | 'createdAt'>;

function message(overrides: MessageOverrides): UiMessage {
  return {
    chatId: 'c-1',
    senderName: overrides.senderId,
    status: 'read',
    ...overrides,
  };
}

function at(day: number, minutes: number): Date {
  return new Date(2026, 8, 27 + day, 10, minutes);
}

describe('groupMessages', () => {
  it('groups the same sender within five minutes and marks the edges', () => {
    const items = groupMessages([
      message({ id: '1', senderId: 'ana', createdAt: at(0, 0) }),
      message({ id: '2', senderId: 'ana', createdAt: at(0, 3) }),
    ]);

    expect(items.map((item) => item.kind)).toEqual(['separator', 'message', 'message']);
    const [, first, second] = items;
    expect(first).toMatchObject({ firstInGroup: true, lastInGroup: false });
    expect(second).toMatchObject({ firstInGroup: false, lastInGroup: true });
  });

  it('starts a new group after five minutes and on a different sender', () => {
    const items = groupMessages([
      message({ id: '1', senderId: 'ana', createdAt: at(0, 0) }),
      message({ id: '2', senderId: 'ana', createdAt: at(0, 7) }),
      message({ id: '3', senderId: 'luis', createdAt: at(0, 8) }),
    ]);

    const messages = items.filter((item) => item.kind === 'message');
    expect(messages.map((item) => item.firstInGroup)).toEqual([true, true, true]);
    expect(messages.map((item) => item.lastInGroup)).toEqual([true, true, true]);
  });

  it('inserts a separator whenever the calendar day changes', () => {
    const items = groupMessages([
      message({ id: '1', senderId: 'ana', createdAt: at(0, 0) }),
      message({ id: '2', senderId: 'ana', createdAt: at(1, 5) }),
    ]);

    expect(items.filter((item) => item.kind === 'separator')).toHaveLength(2);
    const messages = items.filter((item) => item.kind === 'message');
    expect(messages).toHaveLength(2);
  });

  it('returns nothing for an empty list', () => {
    expect(groupMessages([])).toEqual([]);
  });
});

describe('previewText', () => {
  const options = { isGroup: true, currentUserId: 'me' };

  it('has no prefix in a direct message', () => {
    const last = message({ id: '1', senderId: 'ana', createdAt: at(0, 0), text: 'hey' });
    expect(previewText(last, { isGroup: false, currentUserId: 'me' })).toBe('hey');
  });

  it('prefixes the sender first name in groups', () => {
    const last = message({
      id: '1',
      senderId: 'ana',
      senderName: 'Ana',
      createdAt: at(0, 0),
      text: 'ok!',
    });
    expect(previewText(last, options)).toBe('Ana: ok!');
    expect(previewPrefix(last, options)).toBe('Ana: ');
    expect(previewBody(last)).toBe('ok!');
  });

  it('prefixes your own messages with You', () => {
    const last = message({ id: '1', senderId: 'me', createdAt: at(0, 0), text: 'done' });
    expect(previewText(last, options)).toBe('You: done');
  });

  it('uses the voice preview', () => {
    const last = message({
      id: '1',
      senderId: 'ana',
      senderName: 'Ana',
      createdAt: at(0, 0),
      voice: { duration_ms: 12_000, mime: 'audio/m4a', waveform: [10, 20] },
    });
    expect(previewText(last, options)).toBe('Ana: 🎤 Voice message (0:12)');
  });

  it('uses the photo preview', () => {
    const last = message({
      id: '1',
      senderId: 'ana',
      senderName: 'Ana',
      createdAt: at(0, 0),
      image: { url: 'data:image/svg+xml,<svg/>', width: 10, height: 10 },
    });
    expect(previewText(last, options)).toBe('Ana: 🖼 Photo');
  });

  it('uses the image attachment preview, with the caption after it', () => {
    const image = message({
      id: '1',
      senderId: 'ana',
      senderName: 'Ana',
      createdAt: at(0, 0),
      attachment: {
        kind: 'image',
        url: 'https://upload.zilar.test/1/stage.png',
        name: 'stage.png',
        size: 200,
        mime: 'image/png',
      },
    });
    expect(previewBody(image)).toBe('🖼 Photo');

    const withCaption = message({ ...image, text: 'the stage!' });
    expect(previewText(withCaption, options)).toBe('Ana: 🖼 Photo, the stage!');
  });

  it('uses the file attachment preview with its name and caption', () => {
    const file = message({
      id: '1',
      senderId: 'ana',
      senderName: 'Ana',
      createdAt: at(0, 0),
      attachment: {
        kind: 'file',
        url: 'https://upload.zilar.test/1/tickets.pdf',
        name: 'tickets.pdf',
        size: 200,
        mime: 'application/pdf',
      },
    });
    expect(previewText(file, options)).toBe('Ana: 📎 tickets.pdf');

    const withCaption = message({ ...file, text: 'print these' });
    expect(previewBody(withCaption)).toBe('📎 tickets.pdf, print these');
  });

  it('returns an empty string without a message', () => {
    expect(previewText(undefined, options)).toBe('');
    expect(previewBody(undefined)).toBe('');
  });
});

describe('unreadDividerIndex', () => {
  const items = groupMessages([
    message({ id: '1', senderId: 'ana', createdAt: at(0, 0) }),
    message({ id: '2', senderId: 'ana', createdAt: at(0, 3) }),
    message({ id: '3', senderId: 'ana', createdAt: at(0, 6) }),
    message({ id: '4', senderId: 'ana', createdAt: at(0, 9) }),
  ]);
  // items: [separator, message 1, message 2, message 3, message 4]

  it('places the divider above the first unread message from a count', () => {
    expect(unreadDividerIndex(items, 2)).toBe(3);
  });

  it('places the divider after the last read message id', () => {
    expect(unreadDividerIndex(items, '2')).toBe(3);
  });

  it('returns null when nothing is unread', () => {
    expect(unreadDividerIndex(items, 0)).toBeNull();
    expect(unreadDividerIndex(items, -1)).toBeNull();
  });

  it('returns null when the anchor message is missing', () => {
    expect(unreadDividerIndex(items, 'nope')).toBeNull();
  });

  it('puts the divider at the top when all messages are unread', () => {
    expect(unreadDividerIndex(items, 99)).toBe(1);
  });

  it('returns null without message items', () => {
    expect(unreadDividerIndex(groupMessages([]), 2)).toBeNull();
  });
});

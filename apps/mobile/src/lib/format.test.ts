import { describe, expect, it } from 'vitest';

import { formatLastSeen, previewParts, replyRef, typingLabel } from './format';
import type { ChatSummary, UiMessage } from './types';

const NOW = new Date(2026, 8, 27, 15, 0);

function chat(overrides: Partial<ChatSummary>): ChatSummary {
  return {
    id: 'ana',
    title: 'Ana',
    kind: 'dm',
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
    ...overrides,
  };
}

describe('previewParts', () => {
  const last: UiMessage = {
    id: 'm1',
    chatId: 'dev-team',
    senderId: 'dani',
    senderName: 'Dani',
    text: 'PR #42 is ready for review',
    createdAt: NOW,
    status: 'read',
  };

  it('keeps the single space after the sender prefix', () => {
    const { prefix, body } = previewParts(last, { isGroup: true, currentUserId: 'me' });
    expect(prefix).toBe('Dani: ');
    expect(`${prefix}${body}`).toBe('Dani: PR #42 is ready for review');
  });

  it('prefixes your own messages with You:', () => {
    const { prefix, body } = previewParts(
      { ...last, senderId: 'me', senderName: 'You' },
      { isGroup: true, currentUserId: 'me' },
    );
    expect(`${prefix}${body}`).toBe('You: PR #42 is ready for review');
  });

  it('has no prefix in a direct message', () => {
    const { prefix, body } = previewParts(last, { isGroup: false, currentUserId: 'me' });
    expect(prefix).toBe('');
    expect(`${prefix}${body}`).toBe('PR #42 is ready for review');
  });

  it('falls back to the voice preview body', () => {
    const { prefix, body } = previewParts(
      {
        ...last,
        text: undefined,
        voice: { duration_ms: 12_400, mime: 'audio/ogg', waveform: [1] },
      },
      { isGroup: true, currentUserId: 'me' },
    );
    expect(`${prefix}${body}`).toBe('Dani: 🎤 Voice message (0:12)');
  });
});

describe('formatLastSeen', () => {
  it('formats just now, minutes, hours and days', () => {
    expect(formatLastSeen(new Date(2026, 8, 27, 14, 59, 30), NOW)).toBe('just now');
    expect(formatLastSeen(new Date(2026, 8, 27, 14, 55), NOW)).toBe('5 minutes ago');
    expect(formatLastSeen(new Date(2026, 8, 27, 13, 30), NOW)).toBe('1 hour ago');
    expect(formatLastSeen(new Date(2026, 8, 26, 22, 0), NOW)).toBe('17 hours ago');
    expect(formatLastSeen(new Date(2026, 8, 26, 10, 0), NOW)).toBe('1 day ago');
    expect(formatLastSeen(new Date(2026, 8, 24, 10, 0), NOW)).toBe('3 days ago');
  });

  it('falls back to the month and day after a week', () => {
    expect(formatLastSeen(new Date(2026, 8, 10, 10, 0), NOW)).toBe('September 10');
  });
});

describe('typingLabel', () => {
  it('reads typing in a DM and names the first person in a group', () => {
    expect(typingLabel(chat({ kind: 'dm' }), ['Ana'])).toBe('typing');
    expect(typingLabel(chat({ kind: 'group' }), ['Luis'])).toBe('Luis is typing');
    expect(typingLabel(chat({ kind: 'group' }), ['Ana', 'Luis'])).toBe('Ana and others are typing');
  });

  it('returns nothing without names', () => {
    expect(typingLabel(chat({}), [])).toBeUndefined();
  });
});

describe('replyRef', () => {
  const message: UiMessage = {
    id: 'm1',
    chatId: 'ana',
    senderId: 'ana',
    senderName: 'Ana Ruiz',
    text: 'ok!',
    createdAt: NOW,
    status: 'read',
  };

  it('keeps the sender name and the text excerpt', () => {
    expect(replyRef(message, 'me')).toEqual({ id: 'm1', senderName: 'Ana Ruiz', text: 'ok!' });
  });

  it('labels your own messages as You', () => {
    expect(replyRef({ ...message, senderId: 'me' }, 'me').senderName).toBe('You');
  });

  it('falls back to the voice preview for a voice message', () => {
    expect(
      replyRef(
        {
          ...message,
          text: undefined,
          voice: { duration_ms: 12_400, mime: 'audio/ogg', waveform: [1] },
        },
        'me',
      ),
    ).toMatchObject({ text: '🎤 Voice message (0:12)' });
  });
});

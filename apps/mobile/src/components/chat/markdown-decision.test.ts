import { describe, expect, it } from 'vitest';

import type { ChatSummary, UiMessage } from '@galena/chat-core';

import { plainPreviewBody, rendersMarkdown } from './markdown-decision';

function chat(overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id: 'c-1',
    title: 'Chat',
    kind: 'dm',
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
    ...overrides,
  };
}

function message(overrides: Partial<UiMessage> = {}): UiMessage {
  return {
    id: 'm-1',
    chatId: 'c-1',
    senderId: 'ana',
    senderName: 'Ana',
    text: 'hello',
    createdAt: new Date(2026, 9, 1, 12, 0),
    status: 'read',
    ...overrides,
  };
}

describe('rendersMarkdown (which bubble renderer)', () => {
  it('renders an incoming message in an AI chat as Markdown', () => {
    expect(rendersMarkdown([chat({ isAI: true })], message(), 'me')).toBe(true);
  });

  it('keeps a human DM, a human group and your own AI-chat message on LinkText', () => {
    expect(rendersMarkdown([chat()], message(), 'me')).toBe(false);
    expect(rendersMarkdown([chat({ kind: 'group' })], message(), 'me')).toBe(false);
    expect(
      rendersMarkdown([chat({ isAI: true })], message({ senderId: 'me', senderName: 'You' }), 'me'),
    ).toBe(false);
  });

  it('renders an incoming group AI reply (an ai- JID) as Markdown', () => {
    const group = chat({ id: 'dev-team', kind: 'group' });
    expect(
      rendersMarkdown(
        [group],
        message({ chatId: 'dev-team', senderId: 'ai-dev@galena.test' }),
        'me',
      ),
    ).toBe(true);
    expect(
      rendersMarkdown([group], message({ chatId: 'dev-team', senderId: 'dani@galena.test' }), 'me'),
    ).toBe(false);
  });

  it('stays plain when the message chat is not in the store', () => {
    expect(rendersMarkdown([], message(), 'me')).toBe(false);
    expect(rendersMarkdown([chat({ id: 'other' })], message(), 'me')).toBe(false);
  });
});

describe('plainPreviewBody (which list preview)', () => {
  it('strips Markdown in an AI chat preview', () => {
    const raw = '**bold** and `code`\n# Heading\n- item';
    const body = plainPreviewBody(chat({ isAI: true }), message({ text: raw }), raw, 'me');
    expect(body).toBe('bold and code Heading item');
    expect(body).not.toContain('**');
    expect(body).not.toContain('`');
    expect(body).not.toContain('#');
  });

  it('strips Markdown for an incoming group AI reply', () => {
    const raw = 'a **bold** reply';
    const group = chat({ id: 'dev-team', kind: 'group' });
    expect(
      plainPreviewBody(group, message({ senderId: 'ai-dev@galena.test', text: raw }), raw, 'me'),
    ).toBe('a bold reply');
  });

  it('leaves a human preview untouched', () => {
    expect(plainPreviewBody(chat(), message({ text: '**keep** me' }), '**keep** me', 'me')).toBe(
      '**keep** me',
    );
    expect(
      plainPreviewBody(
        chat({ kind: 'group' }),
        message({ text: '**keep** me' }),
        '**keep** me',
        'me',
      ),
    ).toBe('**keep** me');
  });

  it('leaves your own AI-chat message untouched', () => {
    const raw = '**mine**';
    expect(
      plainPreviewBody(chat({ isAI: true }), message({ senderId: 'me', text: raw }), raw, 'me'),
    ).toBe('**mine**');
  });

  it('returns the raw body when there is no last message', () => {
    expect(plainPreviewBody(chat({ isAI: true }), undefined, 'raw', 'me')).toBe('raw');
  });
});

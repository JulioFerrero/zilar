import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@galena/xmpp-core';
import {
  bareJid,
  buildDmMessages,
  buildSystemMessage,
  capHistoryByChars,
  DM_HISTORY_MESSAGE_LIMIT,
} from './context';

const AI_JID = 'ai-abc@galena.localhost';
const OWNER_JID = 'julio@galena.localhost';
const STRANGER_JID = 'stranger@galena.localhost';
const OTHER_AI_JID = 'ai-xyz@galena.localhost';

function dm(id: string, fromJid: string, body: string | undefined, outgoing = false): ChatMessage {
  return {
    id,
    chatJid: AI_JID,
    kind: 'chat',
    fromJid,
    fromResolved: true,
    ...(body === undefined ? {} : { body }),
    timestamp: new Date('2026-09-28T10:00:00Z'),
    outgoing,
  };
}

function baseInput(history: ChatMessage[] = []) {
  return {
    aiName: 'Dev-1',
    persona: 'Senior TypeScript developer. Small PRs. Always writes tests.',
    ownerName: 'Julio',
    today: '2026-09-28',
    aiJid: AI_JID,
    ownerJid: OWNER_JID,
    history,
    trigger: { id: 't-1', body: 'hello' },
  };
}

describe('bareJid', () => {
  it('strips the resource and lowercases', () => {
    expect(bareJid('Julio@galena.localhost/phone')).toBe('julio@galena.localhost');
    expect(bareJid('julio@galena.localhost')).toBe('julio@galena.localhost');
  });
});

describe('buildSystemMessage', () => {
  it('carries the persona, the platform line and today', () => {
    const system = buildSystemMessage({
      aiName: 'Dev-1',
      persona: 'Senior TypeScript developer.',
      ownerName: 'Julio',
      today: '2026-09-28',
    });
    expect(system).toContain('Senior TypeScript developer.');
    expect(system).toContain(
      'You are Dev-1, an AI in the Galena chat app, talking in a private chat with Julio. Reply in plain text; keep it concise unless asked.',
    );
    expect(system).toContain('Today is 2026-09-28.');
  });
});

describe('buildDmMessages', () => {
  it('maps the owner to user turns and the AI to assistant turns, oldest first', () => {
    const messages = buildDmMessages(
      baseInput([dm('m-1', OWNER_JID, 'first'), dm('m-2', AI_JID, 'second', true)]),
    );
    expect(messages[0]?.role).toBe('system');
    expect(messages.slice(1)).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'hello' },
    ]);
  });

  it('recognises the AI by JID even when the message is not marked outgoing', () => {
    const messages = buildDmMessages(baseInput([dm('m-1', `${AI_JID}/desk`, 'from my desk')]));
    expect(messages.slice(1)).toEqual([
      { role: 'assistant', content: 'from my desk' },
      { role: 'user', content: 'hello' },
    ]);
  });

  it('does not duplicate the trigger when it is already the last history item', () => {
    const messages = buildDmMessages(
      baseInput([dm('m-1', OWNER_JID, 'first'), dm('t-1', OWNER_JID, 'hello')]),
    );
    expect(messages.slice(1)).toEqual([
      { role: 'user', content: 'first' },
      { role: 'user', content: 'hello' },
    ]);
  });

  it('appends the trigger when the history ends on another message', () => {
    const messages = buildDmMessages(baseInput([dm('m-1', OWNER_JID, 'first')]));
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'hello' });
  });

  it('drops non-text messages: empty bodies, missing bodies and strangers', () => {
    const history = [
      dm('m-1', OWNER_JID, 'keep me'),
      dm('m-2', OWNER_JID, '   '),
      dm('m-3', OWNER_JID, undefined),
      dm('m-4', STRANGER_JID, 'not my dm'),
      dm('m-5', OTHER_AI_JID, 'bot chatter'),
      dm('m-6', AI_JID, 'my answer', true),
    ];
    const messages = buildDmMessages(baseInput(history));
    expect(messages.slice(1)).toEqual([
      { role: 'user', content: 'keep me' },
      { role: 'assistant', content: 'my answer' },
      { role: 'user', content: 'hello' },
    ]);
  });

  it('looks back at most 30 messages', () => {
    const history: ChatMessage[] = [];
    for (let index = 0; index < DM_HISTORY_MESSAGE_LIMIT + 5; index += 1) {
      history.push(dm(`m-${index}`, OWNER_JID, `message ${index}`));
    }
    const messages = buildDmMessages({
      ...baseInput(history),
      trigger: { id: 't-9', body: 'new' },
    });
    // 30 history turns plus the trigger on top.
    expect(messages.filter((message) => message.role !== 'system')).toHaveLength(
      DM_HISTORY_MESSAGE_LIMIT + 1,
    );
    expect(messages[1]).toEqual({ role: 'user', content: 'message 5' });
  });

  it('drops the oldest messages first when the history exceeds the character budget', () => {
    const history = [
      dm('m-old', OWNER_JID, `old ${'x'.repeat(15_000)}`),
      dm('m-mid', OWNER_JID, `mid ${'y'.repeat(9_000)}`),
      dm('m-new', OWNER_JID, 'new and short'),
    ];
    const messages = buildDmMessages({ ...baseInput(history), trigger: { id: 't-9', body: 'go' } });
    const contents = messages.map((message) => message.content);
    expect(contents.some((content) => content.startsWith('old '))).toBe(false);
    expect(contents.some((content) => content.startsWith('mid '))).toBe(true);
    expect(contents).toContain('new and short');
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'go' });
  });
});

describe('capHistoryByChars', () => {
  it('keeps everything under budget and drops the oldest first', () => {
    const turns = [{ content: 'aaa' }, { content: 'bb' }, { content: 'c' }];
    expect(capHistoryByChars(turns, 100)).toEqual(turns);
    expect(capHistoryByChars(turns, 3)).toEqual([{ content: 'bb' }, { content: 'c' }]);
    expect(capHistoryByChars(turns, 0)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@galena/xmpp-core';
import {
  bareJid,
  buildDmMessages,
  buildGroupMessages,
  buildGroupSystemMessage,
  buildSystemMessage,
  capHistoryByChars,
  displayNameOf,
  DM_HISTORY_CHAR_BUDGET,
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
    expect(system).toContain(
      'You can change your own persona with update_persona when your owner asks you to change how you behave from now on.',
    );
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

const ROOM_JID = 'gtestroom@rooms.galena.localhost';
const MEMBER_JID = 'ana@galena.localhost';

function room(
  id: string,
  fromJid: string,
  body: string | undefined,
  options: { nick?: string; outgoing?: boolean; resolved?: boolean } = {},
): ChatMessage {
  return {
    id,
    chatJid: ROOM_JID,
    kind: 'groupchat',
    fromJid,
    fromResolved: options.resolved ?? true,
    ...(options.nick === undefined ? {} : { fromNick: options.nick }),
    ...(body === undefined ? {} : { body }),
    timestamp: new Date('2026-09-28T12:00:00Z'),
    outgoing: options.outgoing ?? false,
  };
}

function groupInput(history: ChatMessage[] = []) {
  return {
    aiName: 'Dev-1',
    persona: 'Senior TypeScript developer.',
    senderName: 'Ana',
    today: '2026-09-28',
    aiJid: AI_JID,
    history,
    trigger: { id: 't-1', body: 'hey Dev, look at this' },
  };
}

describe('buildGroupSystemMessage', () => {
  it('carries the persona, the group line with the mentioner, and today', () => {
    const system = buildGroupSystemMessage({
      aiName: 'Dev-1',
      persona: 'Senior TypeScript developer.',
      senderName: 'Ana',
      today: '2026-09-28',
    });
    expect(system).toContain('Senior TypeScript developer.');
    expect(system).toContain('talking in a group chat');
    expect(system).toContain('Ana mentioned you');
    expect(system).toContain('Today is 2026-09-28.');
  });

  it('names the topic and group when both are known', () => {
    const system = buildGroupSystemMessage({
      aiName: 'Dev-1',
      persona: 'Senior TypeScript developer.',
      senderName: 'Ana',
      today: '2026-09-28',
      groupName: 'Team',
      topicName: 'Backend',
    });
    expect(system).toContain('You are in the topic Backend of the group Team.');
  });

  it('names only the topic when the group is unknown', () => {
    const system = buildGroupSystemMessage({
      aiName: 'Dev-1',
      persona: 'Senior TypeScript developer.',
      senderName: 'Ana',
      today: '2026-09-28',
      topicName: 'Backend',
    });
    expect(system).toContain('You are in the topic Backend.');
    expect(system).not.toContain('of the group');
  });

  it('offers no persona tools in groups', () => {
    const system = buildGroupSystemMessage({
      aiName: 'Dev-1',
      persona: 'Senior TypeScript developer.',
      senderName: 'Ana',
      today: '2026-09-28',
    });
    expect(system).not.toContain('update_persona');
  });
});

describe('displayNameOf', () => {
  it('prefers the nick and falls back to the bare JID', () => {
    expect(displayNameOf({ fromJid: MEMBER_JID, fromNick: 'Ana' })).toBe('Ana');
    expect(displayNameOf({ fromJid: MEMBER_JID })).toBe(MEMBER_JID);
    expect(displayNameOf({ fromJid: MEMBER_JID, fromNick: '   ' })).toBe(MEMBER_JID);
  });
});

describe('buildGroupMessages', () => {
  it('prefixes user turns with the sender name and keeps AI turns as assistant', () => {
    const messages = buildGroupMessages(
      groupInput([
        room('m-1', MEMBER_JID, 'first question', { nick: 'Ana' }),
        room('m-2', AI_JID, 'my answer', { outgoing: true }),
      ]),
    );
    expect(messages[0]?.role).toBe('system');
    expect(messages.slice(1)).toEqual([
      { role: 'user', content: 'Ana: first question' },
      { role: 'assistant', content: 'my answer' },
      { role: 'user', content: 'Ana: hey Dev, look at this' },
    ]);
  });

  it('falls back to the bare JID when the nick is missing', () => {
    const messages = buildGroupMessages(groupInput([room('m-1', MEMBER_JID, 'hello')]));
    expect(messages.slice(1)).toEqual([
      { role: 'user', content: `${MEMBER_JID}: hello` },
      { role: 'user', content: 'Ana: hey Dev, look at this' },
    ]);
  });

  it('does not duplicate the trigger when it is already the last history item', () => {
    const messages = buildGroupMessages(
      groupInput([
        room('m-1', MEMBER_JID, 'first', { nick: 'Ana' }),
        room('t-1', MEMBER_JID, 'hey Dev, look at this', { nick: 'Ana' }),
      ]),
    );
    expect(messages.slice(1)).toEqual([
      { role: 'user', content: 'Ana: first' },
      { role: 'user', content: 'Ana: hey Dev, look at this' },
    ]);
  });

  it('drops empty bodies and keeps other AIs as plain text', () => {
    const messages = buildGroupMessages(
      groupInput([
        room('m-1', MEMBER_JID, 'keep me', { nick: 'Ana' }),
        room('m-2', MEMBER_JID, '   ', { nick: 'Ana' }),
        room('m-3', MEMBER_JID, undefined, { nick: 'Ana' }),
        room('m-4', OTHER_AI_JID, 'bot chatter', { nick: 'Helper' }),
      ]),
    );
    expect(messages.slice(1)).toEqual([
      { role: 'user', content: 'Ana: keep me' },
      { role: 'user', content: 'Helper: bot chatter' },
      { role: 'user', content: 'Ana: hey Dev, look at this' },
    ]);
  });

  it('looks back at most 30 messages but always includes the trigger', () => {
    const history: ChatMessage[] = [];
    for (let index = 0; index < DM_HISTORY_MESSAGE_LIMIT + 5; index += 1) {
      history.push(room(`m-${index}`, MEMBER_JID, `message ${index}`, { nick: 'Ana' }));
    }
    const messages = buildGroupMessages({
      ...groupInput(history),
      trigger: { id: 't-9', body: 'new' },
    });
    expect(messages.filter((message) => message.role !== 'system')).toHaveLength(
      DM_HISTORY_MESSAGE_LIMIT + 1,
    );
    expect(messages[1]).toEqual({ role: 'user', content: 'Ana: message 5' });
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'Ana: new' });
  });

  it('drops the oldest messages first under the character budget', () => {
    const history = [
      room('m-old', MEMBER_JID, `old ${'x'.repeat(DM_HISTORY_CHAR_BUDGET)}`, { nick: 'Ana' }),
      room('m-new', MEMBER_JID, 'new and short', { nick: 'Ana' }),
    ];
    const messages = buildGroupMessages({
      ...groupInput(history),
      trigger: { id: 't-9', body: 'go' },
    });
    const contents = messages.map((message) => message.content);
    expect(contents.some((content) => content.startsWith('Ana: old '))).toBe(false);
    expect(contents).toContain('Ana: new and short');
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'Ana: go' });
  });
});

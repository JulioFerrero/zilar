import type { ChatEntry } from '@zilar/api-contract';
import type { MockMessage } from '../../data';
import type { MockData } from '../../state';
import type { MeState } from './state';

// `GET /me/export` (T-1262): a small JSON document with the same §6a shape the
// server streams. Only the seed's own rows are mapped, in memory.
interface MockExportMessage {
  id: string;
  at: string;
  from: string;
  body: string;
  kind: 'text' | 'image' | 'file' | 'voice';
}

interface MockExportChat {
  jid: string;
  kind: 'dm' | 'room';
  messages: MockExportMessage[];
}

interface MockExportDocument {
  exportedAt: string;
  profile: { id: string; name: string; handle: string | null; bio: string };
  contacts: Array<{ userId: string; name: string; jid: string }>;
  chats: MockExportChat[];
}

function messageKind(message: MockMessage): MockExportMessage['kind'] {
  const payload = message.payload;
  if (payload?.type === 'voice') {
    return 'voice';
  }
  if (payload?.type === 'attachment') {
    return payload.data.kind === 'image' ? 'image' : 'file';
  }
  return 'text';
}

function messageFrom(message: MockMessage, meJid: string, chatKind: ChatEntry['kind']): string {
  return chatKind === 'group' ? message.fromJid : message.fromJid === meJid ? 'me' : 'them';
}

function chatMessages(data: MockData, chat: ChatEntry): MockExportMessage[] {
  const meJid = data.me.jid;
  return (data.messages[chat.chatJid] ?? []).map((message) => ({
    id: message.id,
    at: message.timestamp.toISOString(),
    from: messageFrom(message, meJid, chat.kind),
    body: message.body ?? '',
    kind: messageKind(message),
  }));
}

/** The viewer's export: profile, human contacts and the seed's chat history. */
export function mockExport(data: MockData): MockExportDocument {
  const me = data as MockData & MeState;
  return {
    exportedAt: new Date().toISOString(),
    profile: {
      id: data.me.id,
      name: data.me.name,
      handle: data.me.handle,
      bio: me.me.bio,
    },
    contacts: data.people
      .filter((person) => person.kind === 'human')
      .map((person) => ({ userId: person.id, name: person.name, jid: person.jid })),
    chats: data.chats.map((chat) => ({
      jid: chat.chatJid,
      kind: chat.kind === 'group' ? 'room' : 'dm',
      messages: chatMessages(data, chat),
    })),
  };
}

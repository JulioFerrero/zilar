// Streams the caller's archive as the export JSON without holding it in memory; stops at the byte cap with `"truncated": true`.
// A DM message's `from` is `"me"`/`"them"` by the stanza `from` against the caller's bare JID; a room message keeps the sender's JID.

import { Stream } from 'effect';
import { bareJid } from '../jid';
import { extractMessageContent } from '../media/extract';
import { correctionTarget, retractTarget, stanzaFrom, timestampToIso } from '../search/snippet';
import { loadEditsForTargets, type EditOverlayEntry, type EditScope } from '../search/edit-overlay';
import type { ArchivePool, ArchiveRow } from '../search/service';

export interface ExportProfile {
  id: string;
  name: string;
  handle: string | null;
  bio: string;
}

export interface ExportContact {
  userId: string;
  name: string;
  jid: string;
}

export interface ExportChat {
  jid: string;
  kind: 'dm' | 'room';
  pages: AsyncIterable<ArchiveRow[]>;
}

export interface ExportStreamInput {
  exportedAt: string;
  profile: ExportProfile;
  contacts: ExportContact[];
  chats: AsyncIterable<ExportChat>;
  // The caller's own bare JID, so a DM `from` maps to me/them.
  ownBareJid: string;
  archive: ArchivePool;
  byteCap: number;
}

export interface ExportSummary {
  messageCount: number;
  byteSize: number;
  truncated: boolean;
}

export interface ExportMessage {
  id: string;
  at: string;
  from: string;
  body: string;
  kind: string;
}

export function exportMessage(
  row: ArchiveRow,
  ownBareJid: string,
  chatKind: 'dm' | 'room',
  edit?: EditOverlayEntry,
): ExportMessage {
  const content = extractMessageContent(row);
  const sender = stanzaFrom(row.xml) ?? '';
  const retracted = edit?.retracted === true;
  return {
    id: row.originId,
    at: timestampToIso(row.timestamp),
    from: chatKind === 'room' ? sender : bareJid(sender) === ownBareJid ? 'me' : 'them',
    body: retracted ? '' : (edit?.latestText ?? content.body),
    kind: retracted ? 'deleted' : content.kind,
  };
}

function exportScope(chat: ExportChat, ownBareJid: string): EditScope {
  if (chat.kind === 'room') {
    return { kind: 'room', room: chat.jid };
  }
  const owner = bareJid(ownBareJid);
  const at = owner.indexOf('@');
  return { kind: 'dm', owner: at === -1 ? owner : owner.slice(0, at), peer: chat.jid };
}

// Effect's `Stream` bridges the async page generator to a web `ReadableStream`, so backpressure reaches the reads and a disconnect unwinds the generator's `finally`.
// `onComplete` runs once with the counts the caller logs and audits.
export function createExportStream(
  input: ExportStreamInput,
  onComplete: (summary: ExportSummary) => void,
): ReadableStream<Uint8Array> {
  return Stream.toReadableStream(
    Stream.fromAsyncIterable(exportChunks(input, onComplete), (cause) => cause),
  );
}

async function* exportChunks(
  input: ExportStreamInput,
  onComplete: (summary: ExportSummary) => void,
): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  let byteSize = 0;
  let messageCount = 0;
  let truncated = false;
  const write = (text: string): Uint8Array => {
    const chunk = encoder.encode(text);
    byteSize += chunk.byteLength;
    return chunk;
  };

  try {
    yield write(
      `{"exportedAt":${JSON.stringify(input.exportedAt)},"profile":${JSON.stringify(input.profile)},"contacts":${JSON.stringify(input.contacts)},"chats":[`,
    );
    let firstChat = true;
    let openChat = false;
    // The cap can only be decided mid-message, so a truncation leaves the current chat's array open for cleanup.
    outer: for await (const chat of input.chats) {
      openChat = true;
      yield write(
        `${firstChat ? '' : ','}{"jid":${JSON.stringify(chat.jid)},"kind":${JSON.stringify(chat.kind)},"messages":[`,
      );
      firstChat = false;
      let firstMessage = true;
      const scope = exportScope(chat, input.ownBareJid);
      for await (const page of chat.pages) {
        const overlay = await loadEditsForTargets(
          input.archive,
          scope,
          page.map((row) => row.originId),
        );
        for (const row of page) {
          // A correction or retraction is an edit row; the original carries the export entry with the overlay applied.
          if (retractTarget(row.xml) !== null || correctionTarget(row.xml) !== null) {
            continue;
          }
          const piece = `${firstMessage ? '' : ','}${JSON.stringify(
            exportMessage(row, input.ownBareJid, chat.kind, overlay.get(row.originId)),
          )}`;
          const chunk = encoder.encode(piece);
          if (byteSize + chunk.byteLength > input.byteCap) {
            truncated = true;
            break outer;
          }
          byteSize += chunk.byteLength;
          messageCount += 1;
          firstMessage = false;
          yield chunk;
        }
      }
      openChat = false;
      yield write(']}');
    }
    if (openChat) {
      yield write(']}');
    }
    yield write(`]${truncated ? ',"truncated":true' : ''}}`);
  } finally {
    onComplete({ messageCount, byteSize, truncated });
  }
}

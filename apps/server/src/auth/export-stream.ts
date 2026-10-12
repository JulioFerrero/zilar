// The streamed account export (T-1262, task T-C of
// `docs/audit/account-deletion-plan.md` §9). This file turns the caller's
// archive pages into the plan's §6a JSON without ever holding the whole
// document in memory: it writes the header, then one chat at a time, one page
// at a time, and stops at the byte cap with `"truncated": true`.
//
// A DM message's `from` is `"me"`/`"them"`, decided by the stanza's `from`
// against the caller's own bare JID; a room message keeps the sender's JID.
// The body and kind come from the shared media extractor (`extract.ts`).

import { Stream } from 'effect';
import { bareJid } from '../jid';
import { extractMessageContent } from '../media/extract';
import { stanzaFrom, timestampToIso } from '../search/snippet';
import type { ArchiveRow } from '../search/service';

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

/** One chat of the export: ascending archive pages, keyset by timestamp. */
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
  /** The caller's own bare JID, so a DM `from` maps to me/them. */
  ownBareJid: string;
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

/** One archive row as an export message (the plan's §6a message shape). */
export function exportMessage(
  row: ArchiveRow,
  ownBareJid: string,
  chatKind: 'dm' | 'room',
): ExportMessage {
  const content = extractMessageContent(row);
  const sender = stanzaFrom(row.xml) ?? '';
  return {
    id: row.originId,
    at: timestampToIso(row.timestamp),
    from: chatKind === 'room' ? sender : bareJid(sender) === ownBareJid ? 'me' : 'them',
    body: content.body,
    kind: content.kind,
  };
}

/**
 * The download's body: Effect's `Stream` bridges the async page generator to a
 * web `ReadableStream`, so the socket's backpressure reaches the archive reads
 * and a client disconnect unwinds the generator's `finally`. `onComplete` runs
 * once with the counts the caller logs and audits, whether the stream finishes
 * or the client disconnects.
 */
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
    // The byte cap can only be decided while a message is written, so a
    // truncation leaves the current chat's `messages` array open for the
    // cleanup below.
    outer: for await (const chat of input.chats) {
      openChat = true;
      yield write(
        `${firstChat ? '' : ','}{"jid":${JSON.stringify(chat.jid)},"kind":${JSON.stringify(chat.kind)},"messages":[`,
      );
      firstChat = false;
      let firstMessage = true;
      for await (const page of chat.pages) {
        for (const row of page) {
          const piece = `${firstMessage ? '' : ','}${JSON.stringify(
            exportMessage(row, input.ownBareJid, chat.kind),
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

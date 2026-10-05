/**
 * The last voice note the store sent, for the Whistle dev screen's
 * "Transcribe last voice note" button (T-0177): scans every chat's messages
 * newest-first and returns the first message with a `voice` payload and a
 * playable URI (local file while it uploads, else the served URL).
 */
import type { UiMessage } from '@zilar/chat-core';

import { mobileUploadOf } from './types';

export interface LastVoiceNote {
  messageId: string;
  chatId: string;
  uri: string;
  durationMs: number;
}

/** Sorts newest-first by id tail when timestamps tie (local ids grow). */
function compareNewestFirst(left: UiMessage, right: UiMessage): number {
  const time = right.createdAt.getTime() - left.createdAt.getTime();
  return time !== 0 ? time : right.id.localeCompare(left.id);
}

export function lastVoiceNoteOf(
  messagesByChat: Record<string, UiMessage[]>,
): LastVoiceNote | undefined {
  const all: UiMessage[] = Object.values(messagesByChat).flat();
  all.sort(compareNewestFirst);
  for (const message of all) {
    if (message.voice === undefined || message.deleted === true) {
      continue;
    }
    const { localUri } = mobileUploadOf(message);
    const url = message.voice.url;
    const uri = localUri ?? url ?? '';
    if (uri === '') {
      continue;
    }
    return {
      messageId: message.id,
      chatId: message.chatId,
      uri,
      durationMs: Math.max(0, message.voice.duration_ms),
    };
  }
  return undefined;
}

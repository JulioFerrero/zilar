import { Data } from 'effect';
import { type FolderChatType } from '@zilar/chat-core';
import { type ApiFailure } from '@/lib/effect/errors';

export const TYPE_SWITCHES: { type: FolderChatType; label: string }[] = [
  { type: 'dm', label: 'Personal chats' },
  { type: 'group', label: 'Groups' },
  { type: 'channel', label: 'Channels' },
  { type: 'ai', label: 'AIs' },
];

export const SECTION_LABEL =
  'text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase';

export class FolderDeleteFailed extends Data.TaggedError('FolderDeleteFailed') {}

/** The two writes of this dialog; one action runs them, so they never overlap. */
export type FolderWrite = 'save' | 'delete';

export function saveErrorMessage(error: ApiFailure): string {
  if (error.code === 'folder_limit') {
    return error.message;
  }
  if (error.code === 'rate_limited') {
    return 'Too many changes. Wait a moment.';
  }
  return 'Could not save the folder. Try again.';
}

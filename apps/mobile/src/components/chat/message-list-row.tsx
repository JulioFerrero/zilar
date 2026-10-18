import type { AlbumItem, MessageItem } from '@zilar/chat-core';

export type ListEntry =
  | { type: 'divider'; key: string }
  | { type: 'separator'; key: string; date: Date }
  | {
      type: 'message';
      key: string;
      item: MessageItem | AlbumItem;
      isDraft: boolean;
      revealTurnId: string | undefined;
    };

import type { BlocksRespondValue } from '@zilar/api-contract';
import type { BlocksData } from '@zilar/protocol';
import { createContext, useContext } from 'react';

export interface BlockRespond {
  messageId: string;
  chatId: string;
  aiName: string;
  aiJid: string;
  reply: (text: string) => void;
  answer: (
    blockId: string,
    value: BlocksRespondValue,
    itemId?: string,
  ) => Promise<BlocksData | null>;
}

export type BlockRespondTarget = Omit<BlockRespond, 'answer'>;

/** No provider means a fixture or the viewer's own card: controls stay disabled. */
export const BlockRespondContext = createContext<BlockRespond | null>(null);

export function useBlockRespond(): BlockRespond | null {
  return useContext(BlockRespondContext);
}

export function useBlockReply(): (text: string) => void {
  const respond = useContext(BlockRespondContext);
  return respond === null ? NO_REPLY : respond.reply;
}

function NO_REPLY(): void {}

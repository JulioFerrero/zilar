import type { BlocksRespondValue } from '@zilar/api-contract';
import type { BlocksData } from '@zilar/protocol';
import { createContext, useContext } from 'react';

/**
 * What an interactive block needs to answer: the message the card belongs to,
 * the room the @AI reply goes to, and the sender AI's name and JID. `reply`
 * sends the decision kinds' @AI message (the same call `QuestionCard` makes);
 * `answer` posts the answer through the card and hands the merged card back to
 * `BlockCard`, resolving `null` when the call fails.
 */
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

/** The ids and reply `AttachmentBody` hands a card; `BlockCard` adds `answer`. */
export type BlockRespondTarget = Omit<BlockRespond, 'answer'>;

/** No provider means a fixture or the viewer's own card: controls stay disabled. */
export const BlockRespondContext = createContext<BlockRespond | null>(null);

export function useBlockRespond(): BlockRespond | null {
  return useContext(BlockRespondContext);
}

/** The decision kinds' @AI reply (T-1795, step 6). A fixture sends nothing. */
export function useBlockReply(): (text: string) => void {
  const respond = useContext(BlockRespondContext);
  return respond === null ? NO_REPLY : respond.reply;
}

function NO_REPLY(): void {}

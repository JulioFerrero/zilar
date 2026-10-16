import type { Question } from '@zilar/protocol';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useChatStoreApi } from '@/store/ChatStoreProvider';

/**
 * A question card (T-1578), a work/progress card (T-1618) and an approval card
 * (T-1716) draw themselves in place of the message's fallback body text: the
 * bubble hides the text, but the text stays on the message for copy, replies
 * and search. Other cards keep theirs.
 */
export function hidesBodyText(card: { type: string } | undefined): boolean {
  return (
    card?.type === 'question' ||
    card?.type === 'progress' ||
    card?.type === 'blocks' ||
    card?.type === 'approval.request'
  );
}

/**
 * The AI's question card (T-1578): the question, then its 2-4 reply chips in a
 * wrapping row. A chip sends a normal reply that @mentions the asking AI and
 * quotes the question; after one tap in this session the chips disable, and the
 * server closes the question (step 6). No status words: plain outline pills.
 */
export function QuestionCard({
  question,
  aiName,
  chatId,
  messageId,
}: {
  question: Question;
  /** The asking AI's display name, its mention and the reply quote's sender. */
  aiName: string;
  chatId: string;
  /** The question message's id, the reply's `replyTo` target. */
  messageId: string;
}) {
  const storeApi = useChatStoreApi();
  const [answered, setAnswered] = useState(false);

  const answer = (option: string): void => {
    if (answered) {
      return;
    }
    setAnswered(true);
    storeApi.getState().sendText(chatId, `@${aiName} ${option}`, {
      replyTo: { id: messageId, senderName: aiName },
      mentions: [{ jid: question.ai, name: aiName, begin: 0, end: aiName.length + 1 }],
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[14px] text-foreground">{question.question}</p>
      <div className="flex flex-wrap gap-2">
        {question.options.map((option) => (
          <button
            key={option}
            type="button"
            disabled={answered}
            onClick={() => answer(option)}
            className={cn(
              'rounded-full border border-divider px-3 py-1 text-[13px] text-foreground transition-colors',
              answered ? 'cursor-default opacity-50' : 'hover:bg-white/5',
            )}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

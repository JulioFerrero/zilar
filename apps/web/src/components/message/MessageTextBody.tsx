// effect-plain: moved unchanged from apps/web/src/components/MessageBubble.tsx (size split)
import { type UiMessage } from '@zilar/chat-core';
import { lazy, Suspense } from 'react';
import { LinkText } from '../LinkText';
import { cn } from '@/lib/utils';
import { DraftCaret, GeneratingLabel } from './BigEmoji';
import { MessageMeta } from './MessageMeta';

/** The markdown stack loads on the first AI reply; the plain text shows meanwhile. */
const MarkdownText = lazy(() =>
  import('../MarkdownText').then((m) => ({ default: m.MarkdownText })),
);

export function MessageTextBody({
  message,
  text,
  own,
  generating,
  markdown,
  meJid,
  hasText,
}: {
  message: UiMessage;
  text: string;
  own: boolean;
  generating: boolean;
  markdown: boolean;
  meJid: string | undefined;
  hasText: boolean;
}) {
  return (
    <>
      {hasText && markdown && (
        <div className={cn('md break-words', own ? 'px-3 py-2' : 'px-3 py-2.5')}>
          <Suspense fallback={<span className="whitespace-pre-wrap">{text}</span>}>
            <MarkdownText text={text} />
          </Suspense>
          <span className="md-tail">
            {generating && <DraftCaret />}
            <MessageMeta
              message={message}
              showTicks={own && !generating}
              edited={message.edited === true}
              className={cn(
                'float-right ml-1.5 translate-y-[4px]',
                own ? 'text-bubble-out-meta' : 'text-bubble-in-meta',
                // Keeps the width the final message will have, so the
                // swap does not move anything.
                generating && 'invisible',
              )}
            />
          </span>
        </div>
      )}

      {hasText && !markdown && (
        <p className={cn('break-words whitespace-pre-wrap', own ? 'px-3 py-2' : 'px-3 py-2.5')}>
          <LinkText text={text} mentions={message.mentions} meJid={meJid} />
          {generating && <DraftCaret />}
          <MessageMeta
            message={message}
            showTicks={own && !generating}
            edited={message.edited === true}
            className={cn(
              'float-right ml-1.5 translate-y-[4px]',
              own ? 'text-bubble-out-meta' : 'text-bubble-in-meta',
              // Keeps the width the final message will have, so the
              // swap does not move anything.
              generating && 'invisible',
            )}
          />
        </p>
      )}

      {generating && hasText && <GeneratingLabel />}
    </>
  );
}

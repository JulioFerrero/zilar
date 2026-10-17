import { formatTime, senderColor, type ChatSummary } from '@zilar/chat-core';
import type { TopicPreviewMessage } from '@zilar/api-contract';
import { isValid, PayloadSchema } from '@zilar/protocol';
import { Effect } from 'effect';
import { useState } from 'react';
import { EntityAvatar } from '@/components/EntityAvatar';
import { ProgressCard } from '@/components/ProgressCard';
import { BlockCard } from '@/components/message/blocks/BlockCard';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { getTopicPreview } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { cn } from '@/lib/utils';
import { useChatStoreApi } from '@/store/ChatStoreProvider';

type PreviewState =
  | { status: 'loading' }
  | { status: 'ready'; messages: TopicPreviewMessage[] }
  | { status: 'error' };

const LOAD_FAILED = 'Could not load the messages.';
const JOIN_FAILED = 'Could not join the topic. Try again.';

/**
 * T-1797: a public topic the viewer has not joined (W9). The recent messages
 * read as the chat's incoming bubbles, oldest at the top, and the composer is
 * replaced by one Join key. Joining refreshes the chat row, so `isTopicJoined`
 * turns true and the normal chat takes over.
 */
export function TopicJoinView({ chat }: { chat: ChatSummary }) {
  const storeApi = useChatStoreApi();
  const topic = chat.topic;
  const topicId = topic?.id;
  const [preview, setPreview] = useState<PreviewState>({ status: 'loading' });

  const loadPreview =
    topicId === undefined
      ? Effect.sync(() => setPreview({ status: 'error' }))
      : Effect.sync(() => setPreview({ status: 'loading' })).pipe(
          Effect.andThen(fromApi(() => getTopicPreview(topicId))),
          Effect.tap((messages) => Effect.sync(() => setPreview({ status: 'ready', messages }))),
          Effect.catchTag('ApiFailure', () => Effect.sync(() => setPreview({ status: 'error' }))),
        );
  const [, retryPreview] = useQuery(() => loadPreview, [topicId]);

  const [joinState, runJoin] = useAction<void, void, ApiFailure>(() =>
    fromApi(() => storeApi.getState().joinTopic(chat.id)),
  );
  const joining = isWaiting(joinState);
  const joinFailed = !joining && failureOf(joinState) !== undefined;

  if (topic === undefined) {
    return null;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        <div className="chat-background scrollbar-thin h-full overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[860px] flex-col gap-2 px-3 py-4 wide:px-8 wide:py-6">
            {preview.status === 'loading' && (
              <StateMessage kind="loading" size="inline" title="Loading messages…" />
            )}
            {preview.status === 'error' && (
              <div
                role="alert"
                className="flex items-center gap-3 rounded-[14px] bg-surface-raised px-4 py-2.5"
              >
                <p className="min-w-0 flex-1 text-[13px] text-danger">{LOAD_FAILED}</p>
                <Button type="button" variant="ghost" size="sm" onClick={() => retryPreview()}>
                  Retry
                </Button>
              </div>
            )}
            {preview.status === 'ready' && preview.messages.length === 0 && (
              <p className="px-2 py-6 text-center text-[13px] text-muted-foreground">
                No messages yet
              </p>
            )}
            {preview.status === 'ready' &&
              preview.messages.map((message) => <PreviewRow key={message.id} message={message} />)}
          </div>
        </div>
      </div>
      <div className="chat-background relative shrink-0 px-3 pt-2 pb-3 wide:px-8 wide:pt-3 wide:pb-5">
        <Button
          type="button"
          className="h-10 w-full text-[14px]"
          disabled={joining}
          onClick={() => runJoin()}
        >
          {joining ? 'Joining…' : `Join ${chat.title}`}
        </Button>
        {joinFailed && (
          <p role="alert" className="mt-1 px-1 text-[12px] text-danger">
            {JOIN_FAILED}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * One preview row. A row may carry the decoded `<agent>` payload, so the card
 * kinds the thread draws are drawn here too instead of showing a blank or
 * fallback-text bubble (T-1807, the web twin of T-1798).
 */
function PreviewRow({ message }: { message: TopicPreviewMessage }) {
  const payload = isValid(PayloadSchema)(message.payload) ? message.payload : undefined;
  const blocks = payload?.type === 'blocks' ? payload.data : undefined;
  const progress = payload?.type === 'progress' ? payload.data : undefined;
  const asText = blocks === undefined && progress === undefined;
  // A row with neither a drawable card nor text has nothing to show.
  if (asText && message.body === '') {
    return null;
  }

  const time = (
    <time
      dateTime={message.at}
      className="font-mono self-end text-[10px] tabular-nums text-bubble-in-meta"
    >
      {formatTime(new Date(message.at))}
    </time>
  );

  return (
    <div className="flex max-w-[min(560px,100%)] items-end gap-1.5 self-start">
      <EntityAvatar person={{ id: message.nick, name: message.nick }} size={34} />
      <div
        className={cn(
          'flex min-w-0 flex-col',
          // A card is its own surface, as in the thread: no bubble box around it.
          asText &&
            'bubble-in gap-0.5 rounded-[14px] rounded-bl-[4px] px-3 py-2 text-[14px] leading-[1.5]',
        )}
      >
        {asText ? (
          <span
            className="truncate text-[12px] font-semibold"
            style={{ color: senderColor(message.nick) }}
          >
            {message.nick}
          </span>
        ) : (
          // The thread's standalone card keeps the sender over the card with
          // `MessageSender`'s classes plus its `px-3 pt-2` wrapper.
          <div
            className="flex items-center gap-1.5 px-3 pt-2 text-[14px] leading-5 font-semibold"
            style={{ color: senderColor(message.nick) }}
          >
            <span className="truncate">{message.nick}</span>
          </div>
        )}
        {blocks !== undefined && <BlockCard data={blocks} footer={time} />}
        {progress !== undefined && <ProgressCard progress={progress} readOnly />}
        {asText && (
          <>
            <span className="whitespace-pre-wrap break-words">{message.body}</span>
            {time}
          </>
        )}
      </div>
    </div>
  );
}

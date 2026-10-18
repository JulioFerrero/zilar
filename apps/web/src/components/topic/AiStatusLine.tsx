import { liveStageFor, type ChatSummary, type TopicAiActivity } from '@zilar/chat-core';
import { Effect } from 'effect';
import { EntityAvatar } from '@/components/EntityAvatar';
import { fromApi } from '@/lib/effect/api-effect';
import { useAction } from '@/lib/effect/use-action';
import { scrollToMessage } from '@/lib/scrollToMessage';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';

const STATE_ORDER: Record<TopicAiActivity['state'], number> = { working: 0, waiting: 1, done: 2 };

function activeAis(activity: readonly TopicAiActivity[]): TopicAiActivity[] {
  return activity
    .filter((entry) => entry.state !== 'done')
    .sort((left, right) => STATE_ORDER[left.state] - STATE_ORDER[right.state]);
}

function entryText(entry: TopicAiActivity, stage: string | undefined): string {
  if (entry.state === 'waiting') {
    return 'is waiting for you';
  }
  return stage === undefined ? 'is working' : `· ${stage}`;
}

export function AiStatusLine({ chat }: { chat: ChatSummary }) {
  const messages = useChatSelector((state) => state.messagesByChat[chat.id]);
  const storeApi = useChatStoreApi();
  const [, openQuestion] = useAction((messageId: string) =>
    fromApi(() => storeApi.getState().openAtMessage(chat.id, messageId)).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          window.requestAnimationFrame(() => scrollToMessage(messageId));
        }),
      ),
    ),
  );
  const entries = activeAis(chat.topic?.activity ?? []);
  if (entries.length === 0) {
    return null;
  }
  const shown = entries.slice(0, 2);
  const extra = entries.length - shown.length;
  return (
    <div
      role="status"
      className="flex min-w-0 max-w-full flex-nowrap items-center gap-2 overflow-hidden rounded-full border border-border bg-surface-raised/95 px-3 py-1 text-[13px] whitespace-nowrap text-muted-foreground shadow-sm backdrop-blur"
    >
      {shown.map((entry, index) => {
        const questionId = entry.questionId;
        return (
          <span key={entry.aiId} className="flex min-w-0 items-center gap-1.5">
            {index > 0 && <span aria-hidden="true">·</span>}
            <EntityAvatar
              person={{ id: entry.aiId, name: entry.name, avatarUrl: entry.avatarUrl }}
              size={16}
              ai
              className="shrink-0"
            />
            <span className="min-w-0 truncate">
              {entry.state === 'waiting' && questionId !== undefined ? (
                <button
                  type="button"
                  onClick={() => openQuestion(questionId)}
                  className="text-foreground hover:underline"
                >
                  {entry.name}
                </button>
              ) : (
                <span className="text-foreground">{entry.name}</span>
              )}{' '}
              {entryText(entry, liveStageFor(messages, entry.jid))}
            </span>
          </span>
        );
      })}
      {extra > 0 && <span className="shrink-0 font-mono">+{extra}</span>}
    </div>
  );
}

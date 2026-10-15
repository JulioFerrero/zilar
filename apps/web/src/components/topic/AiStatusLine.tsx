import { liveStageFor, type ChatSummary, type TopicAiActivity } from '@zilar/chat-core';
import { EntityAvatar } from '@/components/EntityAvatar';
import { useChatSelector } from '@/store/ChatStoreProvider';

// T-1537: working before waiting; a done or idle topic shows no line.
const STATE_ORDER: Record<TopicAiActivity['state'], number> = { working: 0, waiting: 1, done: 2 };

/** The topic's working and waiting AIs, working first. */
function activeAis(activity: readonly TopicAiActivity[]): TopicAiActivity[] {
  return activity
    .filter((entry) => entry.state !== 'done')
    .sort((left, right) => STATE_ORDER[left.state] - STATE_ORDER[right.state]);
}

/** The one sentence after the name: "· running the tests" or "is waiting for you". */
function entryText(entry: TopicAiActivity, stage: string | undefined): string {
  if (entry.state === 'waiting') {
    return 'is waiting for you';
  }
  return stage === undefined ? 'is working' : `· ${stage}`;
}

/**
 * T-1537: the quiet status line above a topic's composer, one row for the AIs
 * at work. It shows nothing when no AI is working or waiting, or when the chat
 * is not a topic. At most two AIs show, then "+N" for the rest; long text
 * truncates rather than wrapping or scrolling.
 */
export function AiStatusLine({ chat }: { chat: ChatSummary }) {
  const messages = useChatSelector((state) => state.messagesByChat[chat.id]);
  const entries = activeAis(chat.topic?.activity ?? []);
  if (entries.length === 0) {
    return null;
  }
  const shown = entries.slice(0, 2);
  const extra = entries.length - shown.length;
  return (
    <div
      role="status"
      className="flex min-w-0 shrink-0 flex-nowrap items-center gap-2 overflow-hidden px-3 py-1.5 text-[13px] whitespace-nowrap text-muted-foreground wide:px-8"
    >
      {shown.map((entry, index) => (
        <span key={entry.aiId} className="flex min-w-0 items-center gap-1.5">
          {index > 0 && <span aria-hidden="true">·</span>}
          <EntityAvatar
            person={{ id: entry.aiId, name: entry.name, avatarUrl: entry.avatarUrl }}
            size={16}
            ai
            className="shrink-0"
          />
          <span className="min-w-0 truncate">
            <span className="text-foreground">{entry.name}</span>{' '}
            {entryText(entry, liveStageFor(messages, entry.jid))}
          </span>
        </span>
      ))}
      {extra > 0 && <span className="shrink-0 font-mono">+{extra}</span>}
    </div>
  );
}

import {
  topicActivityLine,
  topicActivityView,
  type ChatSummary,
  type TopicAiActivity,
} from '@zilar/chat-core';
import { Data, Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Square } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { listAis, stopAiTurn } from '@/lib/api/ais';
import { fromApi } from '@zilar/client-core';
import { useQuery } from '@/lib/effect/use-query';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { scrollToMessage } from '@/lib/scrollToMessage';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { IconButton } from '../ui/icon-button';
import { Menu } from '../ui/menu';
import { AiActivityMark, AiActivityMarks } from './AiActivityMarks';

class StopFailed extends Data.TaggedError('StopFailed') {}

export function AisHereKey({ chat }: { chat: ChatSummary }) {
  const activity = chat.topic?.activity ?? [];
  const doneAt = chat.topic?.doneAt ?? null;
  const [open, setOpen] = useState(false);
  // Only an AI the viewer owns can be stopped. Until the list loads, or when
  // it fails, no entry shows Stop.
  const [aisResult] = useQuery(() => fromApi(() => listAis()), []);
  const ownIds = AsyncResult.isSuccess(aisResult)
    ? new Set(aisResult.value.map((ai) => ai.id))
    : undefined;
  // The action lives here, not on the row: closing the popover unmounts the row
  // and would interrupt the row's own action mid-jump.
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
  if (activity.length === 0) {
    return null;
  }
  const isGeneral = chat.topic?.isGeneral === true;
  const view = topicActivityView(activity, doneAt, isGeneral);
  // General with only finished AIs has activity but nothing to show or open, so
  // the key hides instead of drawing an empty button.
  if (view.active.length === 0 && !view.done) {
    return null;
  }

  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      label="AIs here"
      align="end"
      trigger={
        <IconButton aria-label={`AIs here: ${view.label}`}>
          <AiActivityMarks activity={activity} doneAt={doneAt} isGeneral={isGeneral} />
        </IconButton>
      }
    >
      <div className="flex min-w-[248px] flex-col py-1">
        {activity.map((entry) => (
          <AisHereRow
            key={entry.aiId}
            entry={entry}
            chatId={chat.id}
            canStop={ownIds?.has(entry.aiId) === true}
            onNavigate={() => setOpen(false)}
            openQuestion={openQuestion}
          />
        ))}
      </div>
    </Menu>
  );
}

function AisHereRow({
  entry,
  chatId,
  canStop,
  onNavigate,
  openQuestion,
}: {
  entry: TopicAiActivity;
  chatId: string;
  canStop: boolean;
  onNavigate: () => void;
  openQuestion: (messageId: string) => void;
}) {
  const [stopState, stop] = useAction<void, { stopped: boolean }, StopFailed>(() =>
    Effect.tryPromise({
      try: () => stopAiTurn(entry.aiId, chatId),
      catch: () => new StopFailed(),
    }),
  );
  const stopping = isWaiting(stopState);
  const stopFailed = failureOf(stopState) !== undefined;
  const picture = <AiActivityMark entry={entry} size={28} />;
  const lines = (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[14px] font-semibold text-foreground">{entry.name}</span>
      <span className="block truncate text-[12px] text-muted-foreground">
        {topicActivityLine(entry.state)}
      </span>
    </span>
  );
  if (entry.state === 'working') {
    return (
      <div className="flex flex-col">
        <div className="flex items-center gap-3 px-3 py-2">
          {picture}
          {lines}
          {canStop && (
            <IconButton
              aria-label={`Stop ${entry.name}`}
              disabled={stopping}
              onClick={() => stop()}
            >
              <Square className="size-4" aria-hidden="true" />
            </IconButton>
          )}
        </div>
        {stopFailed && (
          <p role="alert" className="px-3 pb-2 text-[12px] text-danger">
            Could not stop {entry.name}
          </p>
        )}
      </div>
    );
  }
  const questionId = entry.questionId;
  if (entry.state === 'waiting' && questionId !== undefined) {
    return (
      <button
        type="button"
        onClick={() => {
          onNavigate();
          openQuestion(questionId);
        }}
        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-list-hover"
      >
        {picture}
        {lines}
      </button>
    );
  }
  if (entry.state === 'waiting') {
    return (
      <Link
        to="/settings/approvals"
        onClick={onNavigate}
        className="flex items-center gap-3 px-3 py-2 hover:bg-list-hover"
      >
        {picture}
        {lines}
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      {picture}
      {lines}
    </div>
  );
}

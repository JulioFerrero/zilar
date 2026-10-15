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
import { fromApi } from '@/lib/effect/api-effect';
import { useQuery } from '@/lib/effect/use-query';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { IconButton } from '../ui/icon-button';
import { Menu } from '../ui/menu';
import { AiActivityMark, AiActivityMarks } from './AiActivityMarks';

/** The Stop call for one AI's turn failed. */
class StopFailed extends Data.TaggedError('StopFailed') {}

/**
 * The topic header's "AIs here" key (T-1532): the pictures of the AIs at work,
 * opening a popover that lists each one with what it is doing and, for a
 * working AI, Stop. Renders nothing for a topic with no AI activity.
 */
export function AisHereKey({ chat }: { chat: ChatSummary }) {
  const activity = chat.topic?.activity ?? [];
  const doneAt = chat.topic?.doneAt ?? null;
  const [open, setOpen] = useState(false);
  // Only an AI the viewer owns can be stopped (T-1532), like the task card
  // (T-1422). Until the list loads, or when it fails, no entry shows Stop.
  const [aisResult] = useQuery(() => fromApi(() => listAis()), []);
  const ownIds = AsyncResult.isSuccess(aisResult)
    ? new Set(aisResult.value.map((ai) => ai.id))
    : undefined;
  if (activity.length === 0) {
    return null;
  }
  const view = topicActivityView(activity, doneAt);

  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      label="AIs here"
      align="end"
      trigger={
        <IconButton aria-label={`AIs here: ${view.label}`}>
          <AiActivityMarks activity={activity} doneAt={doneAt} />
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
          />
        ))}
      </div>
    </Menu>
  );
}

/** One AI in the "AIs here" popover: its picture, name, what it is doing and Stop. */
function AisHereRow({
  entry,
  chatId,
  canStop,
  onNavigate,
}: {
  entry: TopicAiActivity;
  chatId: string;
  canStop: boolean;
  onNavigate: () => void;
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

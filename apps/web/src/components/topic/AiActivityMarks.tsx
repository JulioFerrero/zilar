import { topicActivityView, type TopicAiActivity } from '@zilar/chat-core';
import { cn } from '@/lib/utils';
import { EntityAvatar } from '../EntityAvatar';

const MAX_MARKS = 3;

function personOf(entry: TopicAiActivity) {
  return {
    id: entry.aiId,
    name: entry.name,
    ...(entry.avatarUrl === undefined ? {} : { avatarUrl: entry.avatarUrl }),
  };
}

export function DoneCheck({ size = 16 }: { size?: number }) {
  return (
    <svg role="img" aria-label="Done" width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" fill="#22c55e" />
      <path
        d="M4.9 8.3l2.1 2.1 4.1-4.5"
        stroke="#0a0a0a"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AiActivityMark({ entry, size = 20 }: { entry: TopicAiActivity; size?: number }) {
  return (
    <span className="relative inline-flex shrink-0">
      <EntityAvatar person={personOf(entry)} size={size} ai />
      {entry.state === 'working' && (
        <svg
          aria-hidden="true"
          width={size + 8}
          height={size + 8}
          viewBox="0 0 28 28"
          fill="none"
          className="absolute animate-spin [animation-duration:2.4s] motion-reduce:animate-none"
          style={{ left: -4, top: -4 }}
        >
          <circle
            cx="14"
            cy="14"
            r="12.5"
            stroke="#ededed"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeDasharray="52 27"
          />
        </svg>
      )}
      {entry.state === 'waiting' && (
        <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-[#f59e0b] ring-2 ring-[var(--avatar-ring)]" />
      )}
      {entry.state === 'done' && (
        <span className="absolute -right-1 -bottom-1 inline-flex rounded-full ring-2 ring-[var(--avatar-ring)]">
          <DoneCheck />
        </span>
      )}
    </span>
  );
}

export function AiActivityMarks({
  activity,
  doneAt,
  isGeneral = false,
  className,
}: {
  activity: readonly TopicAiActivity[];
  doneAt: string | null;
  isGeneral?: boolean;
  className?: string | undefined;
}) {
  const view = topicActivityView(activity, doneAt, isGeneral);
  if (view.done) {
    return <DoneCheck />;
  }
  if (view.active.length === 0) {
    return null;
  }
  const shown = view.active.slice(0, MAX_MARKS);
  const extra = view.active.length - shown.length;
  return (
    <span role="img" aria-label={view.label} className={cn('flex items-center', className)}>
      {shown.map((entry, index) => (
        <span key={entry.aiId} className={cn(index > 0 && '-ml-1.5')}>
          <AiActivityMark entry={entry} />
        </span>
      ))}
      {extra > 0 && (
        <span className="ml-1 text-[11px] leading-4 text-subtle-foreground">+{extra}</span>
      )}
    </span>
  );
}

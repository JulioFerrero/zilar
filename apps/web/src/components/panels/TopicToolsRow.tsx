import { ChevronRight, Wrench } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { RoutinesSection } from '../tools/RoutinesSection';
import { ToolsSection } from '../tools/ToolsSection';

/**
 * T-1784: the "Tools and routines · N · M" row (plan §3.4). N is the topic's
 * tool count; M arrives from `RoutinesSection` once its list loads. Collapsed by
 * default; the row expands the tools and routines lists.
 */
export function TopicToolsRow({
  topicId,
  groupId,
  isManager,
  toolsCount,
}: {
  topicId: string;
  groupId: string;
  isManager: boolean;
  toolsCount: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [routinesCount, setRoutinesCount] = useState<number | null>(null);

  const counts = [
    ...(toolsCount === null ? [] : [String(toolsCount)]),
    ...(routinesCount === null ? [] : [String(routinesCount)]),
  ].join(' · ');

  return (
    <nav
      aria-label="This topic"
      className="overflow-hidden rounded-xl border border-border bg-surface-raised"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-[44px] w-full items-center gap-2.5 px-3 text-left hover:bg-list-hover"
      >
        <span className="key-icon inline-flex size-7 shrink-0 items-center justify-center rounded-lg">
          <Wrench className="size-3.5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px]">Tools and routines</span>
        {counts !== '' && (
          <span className="font-mono text-[12px] text-muted-foreground">{counts}</span>
        )}
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-subtle-foreground transition-transform',
            open && 'rotate-90',
          )}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-divider p-2">
          <ToolsSection scope={{ topicId }} scopeKey={`topic:${topicId}`} canManage={isManager} />
          <RoutinesSection
            scope={{ groupId }}
            scopeKey={`topic-routines:${topicId}`}
            canManage={isManager}
            onCount={setRoutinesCount}
          />
        </div>
      )}
    </nav>
  );
}

// effect-plain: a React view; the api module owns the transport, and `answer`
// is a tap's fire-and-forget promise.
import type { BlocksRespondValue } from '@zilar/api-contract';
import {
  calloutTone,
  changeTone,
  linkHost,
  sparklinePath,
  statusTone,
  type BlockTone,
} from '@zilar/chat-core';
import type {
  Block,
  BlockIcon,
  BlockIcon as BlockIconName,
  BlocksData,
  CalloutBlock as CalloutBlockData,
  Change,
  ChecklistBlock as ChecklistBlockData,
  FigureBlock as FigureBlockData,
  LinkBlock as LinkBlockData,
  NumberBlock as NumberBlockData,
  StatusBlock as StatusBlockData,
} from '@zilar/protocol';
import {
  Activity,
  Bell,
  Calendar,
  ChartColumn,
  Check,
  CircleAlert,
  Clock,
  CloudSun,
  File,
  Gauge,
  Images,
  Info,
  Link,
  ListChecks,
  Loader,
  MapPin,
  MousePointerClick,
  Route,
  SlidersHorizontal,
  Star,
  Table,
  Timer,
  TrendingUp,
  TriangleAlert,
  Vote,
  type LucideIcon,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { respondToBlock } from '@/lib/api/blocks';
import { cn } from '@/lib/utils';
import { AlertBlock } from './AlertBlock';
import {
  BlockRespondContext,
  useBlockRespond,
  type BlockRespond,
  type BlockRespondTarget,
} from './BlockRespond';
import { ButtonsBlock } from './ButtonsBlock';
import { BarsBlock, GaugeBlock, LineBlock } from './ChartBlocks';
import { ChoiceBlock, RatingBlock } from './ChoiceBlocks';
import { EventBlock, FileBlock, ImagesBlock, PlaceBlock, WeatherBlock } from './ContentBlocks';
import { StatsBlock, TableBlock } from './DataBlocks';
import { FormBlock } from './FormBlock';
import { PollBlock } from './PollBlock';
import { CountdownBlock, ProgressBlock, TimelineBlock } from './ProgressBlocks';

// Every `BlockIcon` name mapped to its lucide component. The protocol pins
// the names, so each has one; where they differ, the closest glyph is picked.
const BLOCK_ICONS: Record<BlockIcon, LucideIcon> = {
  activity: Activity,
  bell: Bell,
  calendar: Calendar,
  chart: ChartColumn,
  check: Check,
  clock: Clock,
  'cloud-sun': CloudSun,
  file: File,
  gauge: Gauge,
  images: Images,
  info: Info,
  link: Link,
  'list-checks': ListChecks,
  loader: Loader,
  'map-pin': MapPin,
  'mouse-pointer-click': MousePointerClick,
  route: Route,
  sliders: SlidersHorizontal,
  star: Star,
  table: Table,
  timer: Timer,
  'trending-up': TrendingUp,
  vote: Vote,
  warning: TriangleAlert,
};

const CALLOUT: Record<BlockTone, { color: string; background: string; icon: LucideIcon }> = {
  positive: { color: '#4ade80', background: 'rgba(34,197,94,.14)', icon: Check },
  warning: { color: '#fbbf24', background: 'rgba(251,191,36,.14)', icon: TriangleAlert },
  negative: { color: '#ef4444', background: 'rgba(239,68,68,.14)', icon: CircleAlert },
  info: { color: '#ededed', background: 'rgba(237,237,237,.10)', icon: Info },
  neutral: { color: '#a1a1a1', background: 'rgba(161,161,161,.12)', icon: Info },
};

const LINK_TILE = {
  background: 'linear-gradient(180deg,#2c2c2c,#151515)',
  border: '1px solid #050505',
  boxShadow:
    'inset 0 1px 0 rgba(255,255,255,.16), inset 0 -1px 0 rgba(0,0,0,.65), 0 1px 0 rgba(0,0,0,.95)',
};

const FIGURE_CHANGE_COLOR: Record<BlockTone, string> = {
  positive: '#4ade80',
  negative: '#f87171',
  neutral: '#a1a1a1',
  warning: '#fbbf24',
  info: '#ededed',
};

const FIGURE_CHANGE_ARROW: Record<Change['direction'], string> = {
  up: '▲',
  down: '▼',
  flat: '—',
};

const NUMBER_CHANGE_COLOR: Record<BlockTone, string> = {
  positive: '#4ade80',
  negative: '#f87171',
  neutral: '#ededed',
  warning: '#fbbf24',
  info: '#ededed',
};

const NUMBER_CHANGE_ARROW: Record<Change['direction'], string> = {
  up: '▲',
  down: '▼',
  flat: '—',
};

const DOT: Record<BlockTone, { color: string; ring: string }> = {
  positive: { color: '#22c55e', ring: 'rgba(34,197,94,.14)' },
  warning: { color: '#fbbf24', ring: 'rgba(251,191,36,.14)' },
  negative: { color: '#ef4444', ring: 'rgba(239,68,68,.14)' },
  neutral: { color: '#a1a1a1', ring: 'rgba(161,161,161,.14)' },
  info: { color: '#ededed', ring: 'rgba(237,237,237,.12)' },
};

const DOT_LABEL: Record<StatusBlockData['rows'][number]['status'], string> = {
  ok: 'Up',
  warn: 'Late',
  bad: 'Down',
};

const BOX_ON = {
  background: 'linear-gradient(180deg,#ffffff,#d4d4d4)',
  boxShadow: 'inset 0 1px 0 #fff, 0 1px 2px rgba(0,0,0,.8)',
};
const BOX_OFF = {
  background: '#0c0c0c',
  border: '1px solid #2a2a2a',
  boxShadow: 'inset 0 1px 2px rgba(0,0,0,.9)',
};

export function CalloutBlock({ block }: { block: CalloutBlockData }) {
  // A newer server may add a tone (expand/contract); an unknown one falls back
  // to the neutral look instead of throwing on `tone.icon`.
  const tone = CALLOUT[calloutTone(block.tone)] ?? CALLOUT.neutral;
  const Icon = tone.icon;
  return (
    <div className="flex items-center gap-3">
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-full"
        style={{ background: tone.background }}
      >
        <Icon
          className="size-4"
          style={{ color: tone.color }}
          strokeWidth={2.4}
          aria-hidden="true"
        />
      </span>
      <span className="min-w-0 flex-1">{block.text}</span>
    </div>
  );
}

export function LinkBlock({ block }: { block: LinkBlockData }) {
  return (
    <a
      href={block.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-3 rounded-[12px] border border-[#1f1f1f] bg-[#101010] p-[10px]"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate font-mono text-[11px] text-[#8a8a8a]">
          {block.site ?? linkHost(block.url)}
        </span>
        <span className="min-w-0 truncate font-medium">{block.title}</span>
        {block.description !== undefined && (
          <span className="text-[13px] text-[#a1a1a1]">{block.description}</span>
        )}
      </div>
      <div
        className="flex size-14 shrink-0 items-center justify-center rounded-[12px]"
        style={LINK_TILE}
      >
        <Link className="size-[22px] text-[#d4d4d4]" strokeWidth={1.8} aria-hidden="true" />
      </div>
    </a>
  );
}

export function FigureBlock({ block }: { block: FigureBlockData }) {
  const hasChange = block.rows.some((row) => row.change !== undefined);
  return (
    <div
      className={cn(
        'grid gap-y-[6px]',
        hasChange ? 'grid-cols-[1fr_auto_auto] gap-x-[14px]' : 'grid-cols-[1fr_auto] gap-x-4',
      )}
    >
      {block.rows.map((row, index) => (
        <Fragment key={`${row.label}-${index}`}>
          <span className="min-w-0 truncate">{row.label}</span>
          <span className="text-right font-mono tabular-nums">{row.value}</span>
          {hasChange && (
            <span
              className="text-right font-mono tabular-nums"
              style={
                row.change === undefined
                  ? undefined
                  : { color: FIGURE_CHANGE_COLOR[changeTone(row.change)] }
              }
            >
              {row.change === undefined
                ? ''
                : `${FIGURE_CHANGE_ARROW[row.change.direction] ?? '—'} ${row.change.text}`}
            </span>
          )}
        </Fragment>
      ))}
    </div>
  );
}

export function NumberBlock({ block }: { block: NumberBlockData }) {
  const tone = block.change === undefined ? 'neutral' : changeTone(block.change);
  const color = NUMBER_CHANGE_COLOR[tone];
  return (
    <>
      <div className="flex items-center gap-2 text-[13px] font-medium text-[#a1a1a1]">
        <span className="min-w-0 flex-1 truncate">{block.label}</span>
        {block.code !== undefined && (
          <span className="shrink-0 font-mono text-[12px] text-[#a1a1a1]">{block.code}</span>
        )}
      </div>
      <div className="flex items-baseline gap-2.5">
        <span className="font-mono text-[30px] leading-9 font-medium tracking-[-0.02em] tabular-nums">
          {block.value}
        </span>
        {block.change !== undefined && (
          <span className="font-mono text-[13px] tabular-nums" style={{ color }}>
            {NUMBER_CHANGE_ARROW[block.change.direction] ?? '—'} {block.change.text}
          </span>
        )}
      </div>
      {block.points !== undefined && (
        <svg
          className="h-10 w-full"
          viewBox="0 0 360 40"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d={sparklinePath(block.points, 360, 40)}
            fill="none"
            stroke={color}
            strokeWidth={1.6}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
    </>
  );
}

export function StatusBlock({
  block,
  showHeading,
}: {
  block: StatusBlockData;
  showHeading: boolean;
}) {
  return (
    <>
      {showHeading && (
        <div className="flex items-center gap-2 text-[13px] font-medium text-[#a1a1a1]">
          <Activity className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{block.title}</span>
        </div>
      )}
      <div className="flex flex-col">
        {block.rows.map((row, index) => {
          // A newer server may add a status word (expand/contract); an unknown one
          // falls back to the neutral dot instead of throwing on `dot.color`.
          const dot = DOT[statusTone(row.status)] ?? DOT.neutral;
          return (
            <div
              key={`${row.label}-${index}`}
              className={
                index < block.rows.length - 1
                  ? 'flex min-h-[28px] items-center gap-2.5 border-b border-[#1c1c1c]'
                  : 'flex min-h-[28px] items-center gap-2.5'
              }
            >
              <span
                role="img"
                aria-label={DOT_LABEL[row.status]}
                className="size-2 shrink-0 rounded-full"
                style={{ background: dot.color, boxShadow: `0 0 0 3px ${dot.ring}` }}
              />
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              {row.value !== undefined && (
                <span className="shrink-0 font-mono text-[12px] text-[#a1a1a1]">{row.value}</span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// effect-plain: a presentational control; the block card owns the request.
export function ChecklistBlock({
  block,
  showHeading,
}: {
  block: ChecklistBlockData;
  showHeading: boolean;
}) {
  const respond = useBlockRespond();
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [seenBlock, setSeenBlock] = useState(block);

  if (block !== seenBlock) {
    setSeenBlock(block);
    setOverrides({});
  }

  const toggleItem = (item: ChecklistBlockData['items'][number]): void => {
    if (respond === null) {
      return;
    }
    const done = !(overrides[item.id] ?? item.done);
    setOverrides((current) => ({ ...current, [item.id]: done }));
    void respond.answer(block.id, { done }, item.id).then((data) => {
      if (data === null) {
        setOverrides((current) => {
          const next = { ...current };
          delete next[item.id];
          return next;
        });
      }
    });
  };

  const doneCount = block.items.filter((item) => overrides[item.id] ?? item.done).length;
  return (
    <>
      {showHeading && (
        <div className="flex items-center gap-2 text-[13px] font-medium text-[#a1a1a1]">
          <ListChecks className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{block.title}</span>
          <span className="shrink-0 font-mono text-[12px] text-[#8a8a8a]">
            {doneCount} of {block.items.length}
          </span>
        </div>
      )}
      <div className="flex flex-col">
        {block.items.map((item) => {
          const done = overrides[item.id] ?? item.done;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={done}
              aria-label={item.label}
              disabled={respond === null}
              aria-disabled={respond === null}
              onClick={() => toggleItem(item)}
              className="flex min-h-[28px] w-full items-center gap-2.5 rounded-[6px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ededed]/50 disabled:cursor-default"
            >
              <span
                aria-hidden="true"
                className="flex size-[18px] shrink-0 items-center justify-center rounded-[6px]"
                style={done ? BOX_ON : BOX_OFF}
              >
                {done && <Check className="size-3 text-[#0a0a0a]" strokeWidth={3.2} />}
              </span>
              <span
                className={cn('min-w-0 flex-1 truncate', done && 'text-[#8a8a8a] line-through')}
              >
                {item.label}
              </span>
              {item.by !== undefined && (
                <span className="shrink-0 text-[12px] text-[#8a8a8a]">{item.by}</span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

function renderBlock(block: Block, showHeading: boolean, title?: string): ReactNode {
  switch (block.kind) {
    case 'figure':
      return <FigureBlock block={block} />;
    case 'number':
      return <NumberBlock block={block} />;
    case 'checklist':
      return <ChecklistBlock block={block} showHeading={showHeading} />;
    case 'status':
      return <StatusBlock block={block} showHeading={showHeading} />;
    case 'link':
      return <LinkBlock block={block} />;
    case 'callout':
      return <CalloutBlock block={block} />;
    case 'buttons':
      return <ButtonsBlock block={block} />;
    case 'poll':
      return <PollBlock block={block} />;
    case 'choice':
      return <ChoiceBlock block={block} />;
    case 'form':
      return <FormBlock block={block} showHeading={showHeading} />;
    case 'rating':
      return <RatingBlock block={block} />;
    case 'alert':
      return <AlertBlock block={block} showHeading={showHeading} />;
    case 'stats':
      return <StatsBlock block={block} showHeading={showHeading} />;
    case 'table':
      return <TableBlock block={block} showHeading={showHeading} />;
    case 'bars':
      return <BarsBlock block={block} showHeading={showHeading} />;
    case 'line':
      return <LineBlock block={block} showHeading={showHeading} />;
    case 'gauge':
      return <GaugeBlock block={block} />;
    case 'progress':
      return <ProgressBlock block={block} showHeading={showHeading} />;
    case 'timeline':
      return <TimelineBlock block={block} showHeading={showHeading} />;
    case 'countdown':
      return <CountdownBlock block={block} showHeading={showHeading} />;
    case 'place':
      return <PlaceBlock block={block} />;
    case 'weather':
      return <WeatherBlock block={block} />;
    case 'event':
      return <EventBlock block={block} />;
    case 'images':
      return <ImagesBlock block={block} title={title} />;
    case 'file':
      return <FileBlock block={block} />;
    default:
      return null;
  }
}

export function BlockCard({
  data,
  footer,
  respond,
}: {
  data: BlocksData;
  footer?: ReactNode;
  respond?: BlockRespondTarget;
}) {
  const [shown, setShown] = useState(data);
  const [seenData, setSeenData] = useState(data);
  const [failed, setFailed] = useState(false);
  const shownRef = useRef(data);

  if (data !== seenData) {
    setSeenData(data);
    setShown(data);
    setFailed(false);
  }

  useEffect(() => {
    shownRef.current = shown;
  }, [shown]);

  const answer = useCallback(
    async (
      blockId: string,
      value: BlocksRespondValue,
      itemId?: string,
    ): Promise<BlocksData | null> => {
      if (respond === undefined) {
        return null;
      }
      const previous = shownRef.current;
      try {
        const next = await respondToBlock({
          messageId: respond.messageId,
          blockId,
          ...(itemId === undefined ? {} : { itemId }),
          value,
        });
        shownRef.current = next;
        setShown(next);
        setFailed(false);
        return next;
      } catch {
        shownRef.current = previous;
        setShown(previous);
        setFailed(true);
        return null;
      }
    },
    [respond],
  );

  const context = useMemo<BlockRespond | null>(
    () => (respond === undefined ? null : { ...respond, answer }),
    [respond, answer],
  );

  const hasHeader =
    shown.icon !== undefined || shown.title !== undefined || shown.meta !== undefined;
  const rendered = shown.blocks
    .map((block, index) => ({
      key: `${block.kind}-${index}`,
      block,
      node: renderBlock(block, !hasHeader, shown.title),
    }))
    .filter(
      (entry): entry is { key: string; block: Block; node: ReactNode } => entry.node !== null,
    );
  const lone = !hasHeader && rendered.length === 1 ? rendered[0]?.block : undefined;
  const compactCallout = lone !== undefined && lone.kind === 'callout' ? lone : undefined;
  const loneImages = lone !== undefined && lone.kind === 'images';
  const errorLine = failed ? (
    <p role="alert" className="mt-1 text-[12px] text-danger">
      Could not send. Try again.
    </p>
  ) : null;
  if (compactCallout !== undefined) {
    return (
      <>
        <div className="flex w-full min-w-[280px] max-w-[380px] flex-row items-center gap-3 rounded-[16px] border border-[#232323] bg-[#141414] px-[14px] py-[12px] text-[14px] leading-[20px] text-[#ededed]">
          <div className="min-w-0 flex-1">
            <CalloutBlock block={compactCallout} />
          </div>
          {footer}
        </div>
        {errorLine}
      </>
    );
  }
  return (
    <BlockRespondContext.Provider value={context}>
      <div
        className={cn(
          'flex w-full min-w-[280px] max-w-[380px] flex-col gap-[10px] rounded-[16px] border border-[#232323] bg-[#141414] text-[14px] leading-[20px] text-[#ededed]',
          loneImages ? 'px-[6px] pt-[6px] pb-[8px]' : 'px-[14px] pt-[12px] pb-[8px]',
        )}
      >
        {hasHeader && (
          <div className="flex items-center gap-2 text-[13px] font-medium text-[#a1a1a1]">
            {shown.icon !== undefined && <BlockIcon name={shown.icon} />}
            <span className="min-w-0 flex-1 truncate">{shown.title ?? ''}</span>
            {shown.meta !== undefined && (
              <span className="shrink-0 font-mono text-[12px] text-[#8a8a8a]">{shown.meta}</span>
            )}
          </div>
        )}

        {rendered.length === 0 ? (
          <p>{shown.fallback}</p>
        ) : (
          rendered.map((entry, index) => (
            <Fragment key={entry.key}>
              {index > 0 && <div className="h-px bg-[#232323]" />}
              {entry.node}
            </Fragment>
          ))
        )}

        {footer !== undefined && (
          <div className={cn('flex justify-end', loneImages && 'pr-2')}>{footer}</div>
        )}
      </div>
      {errorLine}
    </BlockRespondContext.Provider>
  );
}

function BlockIcon({ name }: { name: BlockIconName }) {
  // A newer server may ship an unknown icon name (additive under
  // expand/contract); it falls back to a neutral glyph instead of crashing.
  const Icon = (BLOCK_ICONS as Partial<Record<BlockIconName, LucideIcon>>)[name] ?? Info;
  return <Icon className="size-3.5 shrink-0" aria-hidden="true" />;
}

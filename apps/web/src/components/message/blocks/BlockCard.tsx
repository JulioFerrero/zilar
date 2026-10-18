// effect-plain: a React view; the api module owns the transport, and `answer`
// is a tap's fire-and-forget promise.
import type { Block, BlockIcon as BlockIconName, BlocksData } from '@zilar/protocol';
import type { BlocksRespondValue } from '@zilar/api-contract';
import { Info, type LucideIcon } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { respondToBlock } from '@/lib/api/blocks';
import { cn } from '@/lib/utils';
import { renderChartBlock } from './ChartBlocks';
import { renderChoiceBlock } from './ChoiceBlocks';
import { renderContentBlock } from './ContentBlocks';
import { renderDataBlock } from './DataBlocks';
import { renderProgressBlock } from './ProgressBlocks';
import { BLOCK_ICONS } from './blockIcons';
import { BlockRespondContext, type BlockRespond, type BlockRespondTarget } from './BlockRespond';
import { CalloutBlock } from './CalloutBlock';
import { ChecklistBlock } from './ChecklistBlock';
import { FigureBlock } from './FigureBlock';
import { LinkBlock } from './LinkBlock';
import { NumberBlock } from './NumberBlock';
import { StatusBlock } from './StatusBlock';

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
    case 'poll':
    case 'choice':
    case 'form':
    case 'rating':
    case 'alert':
      return renderChoiceBlock(block, showHeading);
    case 'stats':
    case 'table':
      return renderDataBlock(block, showHeading);
    case 'bars':
    case 'line':
    case 'gauge':
      return renderChartBlock(block, showHeading);
    case 'progress':
    case 'timeline':
    case 'countdown':
      return renderProgressBlock(block, showHeading);
    case 'place':
    case 'weather':
    case 'event':
    case 'images':
    case 'file':
      return renderContentBlock(block, showHeading, title);
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

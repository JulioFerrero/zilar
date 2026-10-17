import type { Block, BlockIcon as BlockIconName, BlocksData } from '@zilar/protocol';
import { Info, type LucideIcon } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { renderChartBlock } from './ChartBlocks';
import { renderContentBlock } from './ContentBlocks';
import { renderDataBlock } from './DataBlocks';
import { renderProgressBlock } from './ProgressBlocks';
import { BLOCK_ICONS } from './blockIcons';
import { CalloutBlock } from './CalloutBlock';
import { ChecklistBlock } from './ChecklistBlock';
import { FigureBlock } from './FigureBlock';
import { LinkBlock } from './LinkBlock';
import { NumberBlock } from './NumberBlock';
import { StatusBlock } from './StatusBlock';

/** The block kinds this build can draw; the rest are skipped (T-1755). */
function renderBlock(block: Block, showHeading: boolean): ReactNode {
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
      return renderContentBlock(block, showHeading);
    default:
      return null;
  }
}

/**
 * The blocks card (T-1755): the `#141414` shell with the optional header row,
 * every block this build knows separated by a `#232323` rule, and a footer slot
 * for the message's time. A lone callout in a headerless card is drawn as one
 * compact row (the board, `WebContent.dc.html:103-122`), with the time inline at
 * the right. A payload whose kinds are all unknown shows the `fallback` as plain
 * text, so the card is never empty.
 */
export function BlockCard({ data, footer }: { data: BlocksData; footer?: ReactNode }) {
  const hasHeader = data.icon !== undefined || data.title !== undefined || data.meta !== undefined;
  const rendered = data.blocks
    .map((block, index) => ({
      key: `${block.kind}-${index}`,
      block,
      node: renderBlock(block, !hasHeader),
    }))
    .filter(
      (entry): entry is { key: string; block: Block; node: ReactNode } => entry.node !== null,
    );
  // The board draws a lone callout in a headerless card as one row: the tinted
  // icon, the line and the time inline, 12/14 padding and no footer underneath.
  const lone = !hasHeader && rendered.length === 1 ? rendered[0]?.block : undefined;
  const compactCallout = lone !== undefined && lone.kind === 'callout' ? lone : undefined;
  if (compactCallout !== undefined) {
    return (
      <div className="flex w-full min-w-[280px] max-w-[380px] flex-row items-center gap-3 rounded-[16px] border border-[#232323] bg-[#141414] px-[14px] py-[12px] text-[14px] leading-[20px] text-[#ededed]">
        <div className="min-w-0 flex-1">
          <CalloutBlock block={compactCallout} />
        </div>
        {footer}
      </div>
    );
  }
  return (
    <div className="flex w-full min-w-[280px] max-w-[380px] flex-col gap-[10px] rounded-[16px] border border-[#232323] bg-[#141414] px-[14px] pt-[12px] pb-[8px] text-[14px] leading-[20px] text-[#ededed]">
      {hasHeader && (
        <div className="flex items-center gap-2 text-[13px] font-medium text-[#a1a1a1]">
          {data.icon !== undefined && <BlockIcon name={data.icon} />}
          <span className="min-w-0 flex-1 truncate">{data.title ?? ''}</span>
          {data.meta !== undefined && (
            <span className="shrink-0 font-mono text-[12px] text-[#8a8a8a]">{data.meta}</span>
          )}
        </div>
      )}

      {rendered.length === 0 ? (
        <p>{data.fallback}</p>
      ) : (
        rendered.map((entry, index) => (
          <Fragment key={entry.key}>
            {index > 0 && <div className="h-px bg-[#232323]" />}
            {entry.node}
          </Fragment>
        ))
      )}

      {footer !== undefined && <div className="flex justify-end">{footer}</div>}
    </div>
  );
}

function BlockIcon({ name }: { name: BlockIconName }) {
  // The map covers every name this build knows; a newer server may ship one it
  // does not (`BlockIcon` names are additive under expand/contract), so an
  // unknown name falls back to a neutral glyph instead of crashing the list.
  const Icon = (BLOCK_ICONS as Partial<Record<BlockIconName, LucideIcon>>)[name] ?? Info;
  return <Icon className="size-3.5 shrink-0" aria-hidden="true" />;
}

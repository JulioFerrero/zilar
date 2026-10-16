import type { Block, BlocksData, BlockIcon } from '@zilar/protocol';
import { Fragment, type ReactNode } from 'react';
import { View } from 'react-native';

import { BLOCK_ICONS } from '@/components/chat/blocks/block-icons';
import { CalloutBlock } from '@/components/chat/blocks/callout-block';
import { ChecklistBlock } from '@/components/chat/blocks/checklist-block';
import { FigureBlock } from '@/components/chat/blocks/figure-block';
import { LinkBlock } from '@/components/chat/blocks/link-block';
import { NumberBlock } from '@/components/chat/blocks/number-block';
import { StatusBlock } from '@/components/chat/blocks/status-block';
import { Text, TextClassContext } from '@/components/ui/text';

// The kinds this wave draws; anything else is skipped, so a payload from a newer
// build still renders the parts this one knows.
const RENDERED: ReadonlySet<Block['kind']> = new Set([
  'figure',
  'number',
  'checklist',
  'status',
  'link',
  'callout',
]);

const HEADER_ICON_COLOR = '#a1a1a1';

function BlockHeader({
  icon,
  title,
  meta,
}: {
  icon: BlockIcon | undefined;
  title: string | undefined;
  meta: string | undefined;
}) {
  const Icon = icon === undefined ? undefined : BLOCK_ICONS[icon];
  return (
    <View className="min-h-6 flex-row items-center gap-2">
      {Icon === undefined ? null : <Icon size={16} color={HEADER_ICON_COLOR} aria-hidden />}
      {title === undefined ? (
        <View className="flex-1" />
      ) : (
        <Text className="flex-1 text-[14px] font-medium text-[#a1a1a1]" numberOfLines={1}>
          {title}
        </Text>
      )}
      {meta === undefined ? null : (
        <Text className="font-mono text-[12px] text-[#8a8a8a]" numberOfLines={1}>
          {meta}
        </Text>
      )}
    </View>
  );
}

/** Draws one block, or nothing when its kind has no renderer yet. */
function BlockBody({ block, showHeading }: { block: Block; showHeading: boolean }) {
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
    default:
      return null;
  }
}

/**
 * The phone `blocks` card shell (T-1756): the board's `#141414` surface, a 1 px
 * `#232323` border and a 16 px radius, an optional header row, the rendered
 * blocks split by a `#232323` rule, and a footer at the bottom right. Unknown
 * kinds are skipped; the fallback text stands alone when none render.
 */
export function BlockCard({ data, footer }: { data: BlocksData; footer?: ReactNode }) {
  const blocks = data.blocks.filter((block) => RENDERED.has(block.kind));
  const hasHeader = data.title !== undefined || data.icon !== undefined || data.meta !== undefined;
  // The board (PhoneContent 25) draws a lone callout in a headerless card as one
  // compact row: the tinted icon, the line and the time inline, 12/14 padding and
  // no footer row underneath. Every other card keeps the stacked layout.
  const only = blocks.length === 1 ? blocks[0] : undefined;
  const compactCallout = !hasHeader && only?.kind === 'callout' ? only : undefined;
  if (compactCallout !== undefined) {
    return (
      <View className="w-full min-w-[260px] max-w-[340px] flex-row items-center gap-3 rounded-[16px] border border-[#232323] bg-[#141414] px-[14px] py-[12px]">
        <TextClassContext.Provider value="text-[15px] leading-[21px]">
          <View className="min-w-0 flex-1">
            <CalloutBlock block={compactCallout} />
          </View>
        </TextClassContext.Provider>
        {footer === undefined ? null : footer}
      </View>
    );
  }
  return (
    <View className="w-full min-w-[260px] max-w-[340px] gap-[10px] rounded-[16px] border border-[#232323] bg-[#141414] px-[14px] pt-[12px] pb-[8px]">
      <TextClassContext.Provider value="text-[15px] leading-[21px]">
        {hasHeader ? <BlockHeader icon={data.icon} title={data.title} meta={data.meta} /> : null}
        {blocks.length === 0 ? (
          <Text numberOfLines={8}>{data.fallback}</Text>
        ) : (
          blocks.map((block, index) => (
            <Fragment key={`${block.kind}-${index}`}>
              {index === 0 ? null : <View className="h-px bg-[#232323]" />}
              <BlockBody block={block} showHeading={!hasHeader} />
            </Fragment>
          ))
        )}
      </TextClassContext.Provider>
      {/* The footer stays outside the body text context: its time keeps its own size. */}
      {footer === undefined ? null : <View className="items-end">{footer}</View>}
    </View>
  );
}

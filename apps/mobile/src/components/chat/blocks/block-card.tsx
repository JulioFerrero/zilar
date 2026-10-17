import type { Block, BlocksData, BlockIcon } from '@zilar/protocol';
import { Effect } from 'effect';
import { Fragment, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { BLOCK_ICONS } from '@/components/chat/blocks/block-icons';
import {
  BlockRespondContext,
  type BlockRespondTarget,
  type BlockRespondValue,
  type BlockSubmit,
} from '@/components/chat/blocks/block-respond';
import { CalloutBlock } from '@/components/chat/blocks/callout-block';
import { renderChartBlock, CHART_KINDS } from '@/components/chat/blocks/chart-blocks';
import { ChecklistBlock } from '@/components/chat/blocks/checklist-block';
import { renderChoiceBlock, CHOICE_KINDS } from '@/components/chat/blocks/choice-blocks';
import { renderContentBlock, CONTENT_KINDS } from '@/components/chat/blocks/content-blocks';
import { renderDataBlock, DATA_KINDS } from '@/components/chat/blocks/data-blocks';
import { FigureBlock } from '@/components/chat/blocks/figure-block';
import { LinkBlock } from '@/components/chat/blocks/link-block';
import { NumberBlock } from '@/components/chat/blocks/number-block';
import { renderProgressBlock, PROGRESS_KINDS } from '@/components/chat/blocks/progress-blocks';
import { StatusBlock } from '@/components/chat/blocks/status-block';
import { Text, TextClassContext } from '@/components/ui/text';
import { respondToBlock } from '@/lib/blocks-api';
import { fromApi } from '@/lib/effect/api-effect';
import { useChatStore } from '@/store/chat-store-provider';

// The kinds this wave draws; anything else is skipped, so a payload from a newer
// build still renders the parts this one knows.
const RENDERED: ReadonlySet<Block['kind']> = new Set([
  'figure',
  'number',
  'checklist',
  'status',
  'link',
  'callout',
  ...DATA_KINDS,
  ...CHART_KINDS,
  ...PROGRESS_KINDS,
  ...CONTENT_KINDS,
  ...CHOICE_KINDS,
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
    case 'buttons':
    case 'poll':
    case 'choice':
    case 'form':
    case 'rating':
    case 'alert':
      return renderChoiceBlock(block);
    default:
      return null;
  }
}

/**
 * The phone `blocks` card shell (T-1756): the board's `#141414` surface, a 1 px
 * `#232323` border and a 16 px radius, an optional header row, the rendered
 * blocks split by a `#232323` rule, and a footer at the bottom right. Unknown
 * kinds are skipped; the fallback text stands alone when none render.
 *
 * T-1796: with a `respond` target the card owns its data state — a tap's
 * merged card replaces the prop at once, and the prop wins again whenever the
 * room correction arrives. Without one (the catalog, own cards) the choice
 * controls are drawn disabled.
 */
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
  // The prop wins whenever the room correction replaces the card: adjust during
  // render (React's derived-state pattern), as `use-chat-screen.ts:131` does.
  const [shownFrom, setShownFrom] = useState(data);
  const [failed, setFailed] = useState(false);
  if (shownFrom !== data) {
    setShownFrom(data);
    setShown(data);
    setFailed(false);
  }
  const [pending, setPending] = useState(false);
  const sendText = useChatStore((state) => state.sendText);

  const submit = (request: BlockSubmit): void => {
    if (respond === undefined) {
      request.onSettled?.(false);
      return;
    }
    const previous = shown;
    setPending(true);
    Effect.runFork(
      fromApi(() =>
        respondToBlock({
          messageId: respond.messageId,
          blockId: request.blockId,
          ...(request.itemId === undefined ? {} : { itemId: request.itemId }),
          value: request.value,
        }),
      ).pipe(
        Effect.tap((next) =>
          Effect.sync(() => {
            setShown(next);
            setFailed(false);
            if (request.reply !== undefined) {
              const replyTo = { id: respond.messageId, senderName: respond.aiName };
              if (respond.direct === true) {
                sendText(respond.chatId, request.reply, { replyTo });
              } else {
                sendText(respond.chatId, `@${respond.aiName} ${request.reply}`, {
                  replyTo,
                  mentions: [
                    {
                      jid: respond.aiJid,
                      name: respond.aiName,
                      begin: 0,
                      end: respond.aiName.length + 1,
                    },
                  ],
                });
              }
            }
            request.onSettled?.(true);
          }),
        ),
        Effect.catch(() =>
          Effect.sync(() => {
            setShown(previous);
            setFailed(true);
            request.onSettled?.(false);
          }),
        ),
        Effect.ensuring(Effect.sync(() => setPending(false))),
      ),
    );
  };

  const respondValue: BlockRespondValue | null =
    respond === undefined ? null : { ...respond, submit, pending };

  const blocks = shown.blocks.filter((block) => RENDERED.has(block.kind));
  const hasHeader =
    shown.title !== undefined || shown.icon !== undefined || shown.meta !== undefined;
  // The board (PhoneContent 25) draws a lone callout in a headerless card as one
  // compact row: the tinted icon, the line and the time inline, 12/14 padding and
  // no footer row underneath. Every other card keeps the stacked layout.
  const only = blocks.length === 1 ? blocks[0] : undefined;
  const compactCallout = !hasHeader && only?.kind === 'callout' ? only : undefined;
  const errorLine = failed ? (
    <Text accessibilityRole="alert" className="mt-1 text-[13px] font-semibold text-danger">
      Could not send. Try again.
    </Text>
  ) : null;
  return (
    <BlockRespondContext.Provider value={respondValue}>
      {compactCallout !== undefined ? (
        <>
          <View className="w-full min-w-[260px] max-w-[340px] flex-row items-center gap-3 rounded-[16px] border border-[#232323] bg-[#141414] px-[14px] py-[12px]">
            <TextClassContext.Provider value="text-[15px] leading-[21px]">
              <View className="min-w-0 flex-1">
                <CalloutBlock block={compactCallout} />
              </View>
            </TextClassContext.Provider>
            {footer === undefined ? null : footer}
          </View>
          {errorLine}
        </>
      ) : (
        <>
          <View className="w-full min-w-[260px] max-w-[340px] gap-[10px] rounded-[16px] border border-[#232323] bg-[#141414] px-[14px] pt-[12px] pb-[8px]">
            <TextClassContext.Provider value="text-[15px] leading-[21px]">
              {hasHeader ? (
                <BlockHeader icon={shown.icon} title={shown.title} meta={shown.meta} />
              ) : null}
              {blocks.length === 0 ? (
                <Text numberOfLines={8}>{shown.fallback}</Text>
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
          {errorLine}
        </>
      )}
    </BlockRespondContext.Provider>
  );
}

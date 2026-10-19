import type {
  Block,
  BlocksData,
  BlockIcon,
  CalloutBlock as CalloutBlockData,
  LinkBlock as LinkBlockData,
  StatusBlock as StatusBlockData,
  NumberBlock as NumberBlockData,
  StatsBlock as StatsBlockData,
  TableBlock as TableBlockData,
} from '@zilar/protocol';
import { Effect } from 'effect';
import { Fragment, useState, ReactNode } from 'react';
import { View, Linking, Pressable, type ViewStyle, ScrollView } from 'react-native';
import {
  BlockRespondContext,
  type BlockRespondTarget,
  type BlockRespondValue,
  type BlockSubmit,
} from '@/components/chat/blocks/block-respond';
import { renderChartBlock, CHART_KINDS } from '@/components/chat/blocks/chart-blocks';
import { ChecklistBlock } from '@/components/chat/blocks/checklist-block';
import { renderChoiceBlock, CHOICE_KINDS } from '@/components/chat/blocks/choice-blocks';
import { renderContentBlock, CONTENT_KINDS } from '@/components/chat/blocks/content-blocks';
import {
  FigureBlock,
  TABULAR,
  changeColor,
  changeLabel,
} from '@/components/chat/blocks/figure-block';
import { renderProgressBlock, PROGRESS_KINDS } from '@/components/chat/blocks/progress-blocks';
import { Text, TextClassContext } from '@/components/ui/text';
import { respondToBlock } from '@/lib/blocks-api';
import { fromApi } from '@zilar/client-core';
import { useChatStore } from '@/store/chat-store-provider';
import {
  calloutTone,
  type BlockTone,
  linkHost,
  statusTone,
  sparklinePath,
  numericColumns,
} from '@zilar/chat-core';
import {
  Check,
  Info,
  TriangleAlert,
  type LucideIcon,
  Activity,
  Bell,
  Calendar,
  ChartColumn,
  Clock,
  CloudSun,
  File,
  Gauge,
  Images,
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
  Vote,
} from 'lucide-react-native';
import { iconKey } from '@/lib/depth';
import { safeLinkTarget } from '@/lib/links';
import Svg, { Path } from 'react-native-svg';

// The board's column header and body cell
// (`docs/design/mockups/blocks/PhoneNumbers.dc.html:31-32`): a 12 px muted
// header over 14 px rows, every cell carrying its own bottom rule, so the rule
// breaks at the 14 px column gaps exactly as the board's grid does.
const HEADER = 'border-b border-[#232323] pb-1.5 text-[12px] text-[#8a8a8a]';
const HEADER_NUM = `${HEADER} text-right font-mono`;
const CELL = 'border-b border-[#1c1c1c] py-[7px] text-[14px]';
const CELL_NUM = `${CELL} text-right font-mono`;
// The total row's cells (`:96`): top padding only, never a bottom rule.
const TOTAL = 'pt-[7px] text-[14px]';
const TOTAL_NUM = `${TOTAL} text-right font-mono`;
// The board weights the total's first and last cell; the middle ones stay plain.
const TOTAL_EDGE = ' font-semibold';

function Cell({ text, numeric, className }: { text: string; numeric: boolean; className: string }) {
  return (
    <Text className={className} style={numeric ? TABULAR : undefined} numberOfLines={1}>
      {text}
    </Text>
  );
}

/**
 * 04 · TABLE: a header row, the body rows and, when `total` is set, the last row
 * drawn as the total. A column whose filled cells are all formatted numbers is
 * right-aligned and mono; every other column keeps the body font and the left
 * edge. The grid is built column by column, so a column is as wide as
 * its widest cell and the rows stay aligned. A table wider than the card scrolls
 * sideways in its own `ScrollView`.
 */
function TableBlock({ block, showHeading }: { block: TableBlockData; showHeading: boolean }) {
  const totalIndex = block.total === true ? block.rows.length - 1 : -1;
  const lastColumn = block.columns.length - 1;
  const numeric = numericColumns(block.columns, block.rows);
  return (
    <View className="gap-2.5">
      {showHeading && block.title !== undefined ? (
        <Text className="text-[14px] font-medium text-[#a1a1a1]" numberOfLines={1}>
          {block.title}
        </Text>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <View className="flex-row gap-3.5">
          {block.columns.map((column, columnIndex) => {
            const isNumeric = numeric[columnIndex] === true;
            const edge = columnIndex === 0 || columnIndex === lastColumn;
            return (
              <View
                key={columnIndex}
                // Column one hugs the left and grows into the card; the number
                // columns keep their content width so a wide table overflows.
                className={columnIndex === 0 ? 'grow shrink-0' : undefined}
              >
                <Cell
                  text={column}
                  numeric={isNumeric}
                  className={isNumeric ? HEADER_NUM : HEADER}
                />
                {block.rows.map((row, rowIndex) =>
                  rowIndex === totalIndex ? (
                    <Cell
                      key={rowIndex}
                      text={row[columnIndex] ?? ''}
                      numeric={isNumeric}
                      className={`${isNumeric ? TOTAL_NUM : TOTAL}${edge ? TOTAL_EDGE : ''}`}
                    />
                  ) : (
                    <Cell
                      key={rowIndex}
                      text={row[columnIndex] ?? ''}
                      numeric={isNumeric}
                      className={isNumeric ? CELL_NUM : CELL}
                    />
                  ),
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

// The board's recessed 6 px track and its light key fill
// (`docs/design/mockups/blocks/PhoneNumbers.dc.html:27-28`), the fill raised
// over a D24 well (`docs/design/ui-style.md:111-113`).
const TRACK: ViewStyle = {
  boxShadow:
    'inset 0 2px 6px rgba(0,0,0,.9), inset 0 1px 1px rgba(0,0,0,.8), 0 1px 0 rgba(255,255,255,.06)',
};
const FILL: ViewStyle = {
  experimental_backgroundImage: 'linear-gradient(180deg, #f5f5f5, #b5b5b5)',
};

type Tile = StatsBlockData['tiles'][number];

// One tile: the `#101010` inner surface (README.md:30), a 12/10 label over the
// 18/24 mono value and the ratio bar.
function StatTile({ tile }: { tile: Tile }) {
  return (
    <View className="flex-1 gap-1.5 rounded-[12px] border border-[#1f1f1f] bg-[#101010] px-3 py-2.5">
      <Text className="text-[12px] text-[#a1a1a1]" numberOfLines={1}>
        {tile.label}
      </Text>
      <Text className="font-mono text-[18px] leading-[24px]" style={TABULAR} numberOfLines={1}>
        {tile.value}
      </Text>
      {tile.ratio === undefined ? (
        // The board keeps a tile without a ratio the same height with an empty
        // 6 px spacer (`PhoneNumbers.dc.html:79`).
        <View className="h-1.5" />
      ) : (
        <View className="h-1.5 overflow-hidden rounded-full bg-[#0c0c0c]" style={TRACK}>
          <View className="h-full rounded-full" style={[FILL, { width: `${tile.ratio * 100}%` }]} />
        </View>
      )}
    </View>
  );
}

/**
 * 03 · STAT TILES: up to six label/value tiles in the board's two-column grid,
 * each with a thin ratio bar when `ratio` is set. A lone last tile keeps the
 * half width. `showHeading` draws the block's own title when the card has no
 * header, as `ChecklistBlock` does.
 */
function StatsBlock({ block, showHeading }: { block: StatsBlockData; showHeading: boolean }) {
  const grid: Tile[][] = [];
  for (let index = 0; index < block.tiles.length; index += 2) {
    grid.push(block.tiles.slice(index, index + 2));
  }
  return (
    <View className="gap-2.5">
      {showHeading && block.title !== undefined ? (
        <Text className="text-[14px] font-medium text-[#a1a1a1]" numberOfLines={1}>
          {block.title}
        </Text>
      ) : null}
      {grid.map((row, rowIndex) => (
        <View key={rowIndex} className="flex-row gap-2">
          {row.map((tile, tileIndex) => (
            <StatTile key={tileIndex} tile={tile} />
          ))}
          {row.length === 1 ? <View className="flex-1" /> : null}
        </View>
      ))}
    </View>
  );
}

/** The kinds the data group draws on the phone. */
const DATA_KINDS: ReadonlySet<Block['kind']> = new Set<Block['kind']>(['stats', 'table']);

/**
 * The data group's one dispatch point: `stats` (03) and `table` (04). The bodies
 * follow the board `docs/design/mockups/blocks/PhoneNumbers.dc.html`.
 */
function renderDataBlock(
  block: Extract<Block, { kind: 'stats' | 'table' }>,
  showHeading: boolean,
): ReactNode {
  switch (block.kind) {
    case 'stats':
      return <StatsBlock block={block} showHeading={showHeading} />;
    case 'table':
      return <TableBlock block={block} showHeading={showHeading} />;
  }
}

// The board's sparkline box: a 300-wide viewBox stretched to the card width, 40
// tall, its points inset `CHART_PAD` from the edges.
const CHART_WIDTH = 300;
const CHART_HEIGHT = 40;
const CHART_PAD = 6;

/**
 * 02 · BIG NUMBER: the label and its code, one large value with an optional
 * change, and the change's sparkline. The line is green while the change is up
 * and red while it is down, the plain foreground colour without a change.
 */
function NumberBlock({ block }: { block: NumberBlockData }) {
  const stroke = block.change === undefined ? '#ededed' : changeColor(block.change);
  const path =
    block.points === undefined
      ? ''
      : sparklinePath(block.points, CHART_WIDTH, CHART_HEIGHT, CHART_PAD);
  return (
    <View className="gap-2.5">
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-[14px] font-medium text-[#a1a1a1]" numberOfLines={1}>
          {block.label}
        </Text>
        {block.code === undefined ? null : (
          <Text className="font-mono text-[12px]" numberOfLines={1}>
            {block.code}
          </Text>
        )}
      </View>
      <View className="flex-row flex-wrap items-baseline gap-2.5">
        <Text
          className="font-mono text-[32px] font-medium leading-[38px] tracking-[-0.02em]"
          style={TABULAR}
          numberOfLines={1}
        >
          {block.value}
        </Text>
        {block.change === undefined ? null : (
          <Text
            className="font-mono text-[13px]"
            style={[TABULAR, { color: changeColor(block.change) }]}
            numberOfLines={1}
          >
            {changeLabel(block.change)}
          </Text>
        )}
      </View>
      {path === '' ? null : (
        <Svg
          width="100%"
          height={CHART_HEIGHT}
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          preserveAspectRatio="none"
          accessible={false}
        >
          <Path
            d={path}
            fill="none"
            stroke={stroke}
            strokeWidth={1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </Svg>
      )}
    </View>
  );
}

// The status dots from the boards: a colour with a soft ring, and the word the
// dot reads aloud (the visible row never spells the status out).
const DOT: Record<BlockTone, { background: string; ring: string; label: string }> = {
  positive: { background: '#22c55e', ring: 'rgba(34,197,94,.14)', label: 'Up' },
  warning: { background: '#fbbf24', ring: 'rgba(251,191,36,.14)', label: 'Warning' },
  negative: { background: '#ef4444', ring: 'rgba(239,68,68,.14)', label: 'Down' },
  info: { background: '#a1a1a1', ring: 'rgba(161,161,161,.14)', label: 'Status' },
  neutral: { background: '#a1a1a1', ring: 'rgba(161,161,161,.14)', label: 'Status' },
};

/**
 * 12 · STATUS LIST: a dot plus a value per row, never a word. `showHeading`
 * hides the block's own title row when the card already draws a header.
 */
function StatusBlock({ block, showHeading }: { block: StatusBlockData; showHeading: boolean }) {
  return (
    <View className="gap-1">
      {showHeading ? (
        <View className="min-h-6 flex-row items-center gap-2">
          <Activity size={16} color="#a1a1a1" aria-hidden />
          <Text className="flex-1 text-[14px] font-medium text-[#a1a1a1]" numberOfLines={1}>
            {block.title}
          </Text>
        </View>
      ) : null}
      {block.rows.map((row, index) => {
        const look = DOT[statusTone(row.status)];
        return (
          <View
            key={index}
            className={
              index === block.rows.length - 1
                ? 'min-h-[44px] flex-row items-center gap-3'
                : 'min-h-[44px] flex-row items-center gap-3 border-b border-[#1c1c1c]'
            }
          >
            <View
              accessibilityRole="image"
              accessibilityLabel={look.label}
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: look.background, boxShadow: `0 0 0 3px ${look.ring}` }}
            />
            <Text className="flex-1" numberOfLines={1}>
              {row.label}
            </Text>
            {row.value === undefined ? null : (
              <Text
                className="text-[13px] text-[#a1a1a1] font-mono"
                style={TABULAR}
                numberOfLines={1}
              >
                {row.value}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

/**
 * 19 · LINK CARD: one https link inside an inner `#101010` tile, opened with
 * `Linking.openURL` (as `plain-bubble-body.tsx` does). The site is the payload's
 * `site` or the link's own host; the key is the shared icon-key recipe.
 */
function LinkBlock({ block }: { block: LinkBlockData }) {
  const host = block.site ?? linkHost(block.url);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={block.url}
      onPress={() => {
        const target = safeLinkTarget(block.url);
        if (target !== undefined) {
          void Linking.openURL(target);
        }
      }}
      className="flex-row gap-3 rounded-[12px] border border-[#1f1f1f] bg-[#101010] p-2.5 active:opacity-80"
    >
      <View className="min-w-0 flex-1 justify-center gap-1">
        {host === '' ? null : (
          <Text className="font-mono text-[11px] text-[#8a8a8a]" numberOfLines={1}>
            {host}
          </Text>
        )}
        <Text className="font-medium" numberOfLines={2}>
          {block.title}
        </Text>
        {block.description === undefined ? null : (
          <Text className="text-[13px] leading-[18px] text-[#a1a1a1]" numberOfLines={3}>
            {block.description}
          </Text>
        )}
      </View>
      <View
        className="h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[12px]"
        style={iconKey}
      >
        <Link size={20} color="#d4d4d4" aria-hidden />
      </View>
    </Pressable>
  );
}

// Every `BlockIcon` name mapped to its lucide component, the phone twin
// of web's `BlockCard.tsx`. The protocol pins the names, so every name has one;
// where they differ from lucide's, the closest glyph is picked (`chart` →
// `ChartColumn`, `sliders` → `SlidersHorizontal`, `warning` → `TriangleAlert`).
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

// The tone's glyph and colour; the circle behind it carries the soft ring.
const LOOK: Record<BlockTone, { icon: LucideIcon; color: string; ring: string }> = {
  positive: { icon: Check, color: '#4ade80', ring: 'rgba(34,197,94,.14)' },
  warning: { icon: TriangleAlert, color: '#fbbf24', ring: 'rgba(251,191,36,.14)' },
  negative: { icon: TriangleAlert, color: '#ef4444', ring: 'rgba(239,68,68,.14)' },
  info: { icon: Info, color: '#60a5fa', ring: 'rgba(96,165,250,.14)' },
  neutral: { icon: Info, color: '#a1a1a1', ring: 'rgba(161,161,161,.14)' },
};

/** 25 · CALLOUT: a tone icon in its tinted circle, then the line. */
function CalloutBlock({ block }: { block: CalloutBlockData }) {
  const look = LOOK[calloutTone(block.tone)];
  const Icon = look.icon;
  return (
    <View className="flex-row items-center gap-3">
      <View
        className="h-8 w-8 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: look.ring }}
      >
        <Icon size={16} color={look.color} aria-hidden />
      </View>
      <Text className="flex-1" numberOfLines={3}>
        {block.text}
      </Text>
    </View>
  );
}

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
    case 'images':
    case 'place':
    case 'weather':
    case 'event':
    case 'file':
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
  // The board (PhoneContent 20) draws a card holding only photos with a 6 px
  // side padding and a 6 px top, so the grid sits close to the card's edge.
  const tightImages = only?.kind === 'images';
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
          <View
            className={
              tightImages
                ? 'w-full min-w-[260px] max-w-[340px] gap-[10px] rounded-[16px] border border-[#232323] bg-[#141414] px-[6px] pt-[6px] pb-[8px]'
                : 'w-full min-w-[260px] max-w-[340px] gap-[10px] rounded-[16px] border border-[#232323] bg-[#141414] px-[14px] pt-[12px] pb-[8px]'
            }
          >
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
            {footer === undefined ? null : (
              <View className={tightImages ? 'items-end pr-[8px]' : 'items-end'}>{footer}</View>
            )}
          </View>
          {errorLine}
        </>
      )}
    </BlockRespondContext.Provider>
  );
}

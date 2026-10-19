import { parseMessageMarkdown } from '@zilar/chat-core/markdown-ast';
import type { MdBlock, MdInline, MdListItem, MdTableAlign } from '@zilar/chat-core/markdown-ast';
import { Square, SquareCheck } from 'lucide-react-native';
import { memo, useMemo, type ReactNode } from 'react';
import {
  Linking,
  ScrollView,
  Text as RNText,
  View,
  useWindowDimensions,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { MAX_FONT_SCALE } from '@/components/ui/text';
import { BORDER, well } from '../../lib/depth';
import { safeLinkTarget } from '../../lib/links';

// The bubble's text, code and inline-code looks, shared with `link-text.tsx` so the plain path matches the full renderer.
export const BODY: TextStyle = { fontSize: 15, lineHeight: 20, fontFamily: 'Geist_400Regular' };
export const CODE: TextStyle = { fontSize: 13, lineHeight: 18, fontFamily: 'GeistMono_400Regular' };
const BLOCK_GAP = 6;
export const INLINE_CODE_BACKGROUND = '#0c0c0c';
const QUOTE_BAR = '#333';
const RULE = '#333';

/** Heading sizes: a little larger than body, and never above 20 px. */
function headingStyle(level: number): TextStyle {
  const size = Math.min(20, 15 + (7 - level));
  return { fontSize: size, lineHeight: Math.round(size * 1.35), fontFamily: 'Geist_600SemiBold' };
}

// The URL to open for a link: the shared parser emits only `http:`, `https:` and `mailto:`, and `safeLinkTarget` guards every other scheme.
function openTarget(href: string): string | undefined {
  return /^mailto:/i.test(href) ? href : safeLinkTarget(href);
}

function renderInline(nodes: MdInline[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return node.value;
      case 'strong':
        return (
          <RNText key={index} style={{ fontFamily: 'Geist_600SemiBold' }}>
            {renderInline(node.children)}
          </RNText>
        );
      case 'em':
        return (
          <RNText key={index} style={{ fontStyle: 'italic' }}>
            {renderInline(node.children)}
          </RNText>
        );
      case 'del':
        return (
          <RNText key={index} style={{ textDecorationLine: 'line-through' }}>
            {renderInline(node.children)}
          </RNText>
        );
      case 'code':
        return (
          <RNText
            key={index}
            style={{
              fontFamily: 'GeistMono_400Regular',
              backgroundColor: INLINE_CODE_BACKGROUND,
              borderRadius: 3,
              paddingHorizontal: 3,
            }}
          >
            {node.value}
          </RNText>
        );
      case 'link': {
        const target = openTarget(node.href);
        if (target === undefined) {
          return renderInline(node.children);
        }
        return (
          <RNText
            key={index}
            style={{ textDecorationLine: 'underline' }}
            onPress={() => {
              void Linking.openURL(target);
            }}
          >
            {renderInline(node.children)}
          </RNText>
        );
      }
      case 'break':
        return '\n';
    }
  });
}

function Body({
  nodes,
  color,
  style,
  trailing,
}: {
  nodes: MdInline[];
  color: string;
  style?: TextStyle;
  trailing?: ReactNode;
}) {
  return (
    <RNText style={[BODY, { color }, style]}>
      {renderInline(nodes)}
      {trailing}
    </RNText>
  );
}

function TaskBox({ checked, color }: { checked: boolean; color: string }) {
  const Box = checked ? SquareCheck : Square;
  return <Box size={14} color={color} style={{ marginTop: 3, marginRight: 6 }} aria-hidden />;
}

function ItemBlocks({ blocks, color }: { blocks: MdBlock[]; color: string }) {
  return (
    <View style={{ paddingLeft: 12, marginTop: BLOCK_GAP }}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} color={color} first={index === 0} />
      ))}
    </View>
  );
}

function ListItem({ item, color, marker }: { item: MdListItem; color: string; marker: string }) {
  const [head, ...rest] = item.children;
  const inline = head?.type === 'paragraph' ? head.children : undefined;
  const restBlocks = rest.length > 0 ? <ItemBlocks blocks={rest} color={color} /> : null;

  if (inline !== undefined && item.checked !== undefined) {
    return (
      <View>
        <View style={{ flexDirection: 'row', paddingLeft: 12 }}>
          <TaskBox checked={item.checked} color={color} />
          <RNText style={[BODY, { color, flexShrink: 1 }]}>{renderInline(inline)}</RNText>
        </View>
        {restBlocks}
      </View>
    );
  }

  return (
    <View>
      <RNText style={[BODY, { color, paddingLeft: 12 }]}>
        {marker}
        {inline === undefined ? null : (
          <>
            {'\u00a0'}
            {renderInline(inline)}
          </>
        )}
      </RNText>
      {head !== undefined && head.type !== 'paragraph' ? (
        <View style={{ paddingLeft: 12 }}>
          <BlockView block={head} color={color} first />
        </View>
      ) : null}
      {restBlocks}
    </View>
  );
}

function ListBlock({ block, color }: { block: Extract<MdBlock, { type: 'list' }>; color: string }) {
  const start = block.start ?? 1;
  return (
    <View>
      {/* One `Text` per item with the marker inline. A row whose body was
          measured at one width and laid out at another left the bubble taller
          than its content, so the item is a single flowing text instead. Wrapped
          lines start under the marker; that is accepted. A task item needs the
          box icon, so only that row is a flex row. */}
      {block.items.map((item, index) => (
        <ListItem
          key={index}
          item={item}
          color={color}
          marker={block.ordered ? `${start + index}.` : '•'}
        />
      ))}
    </View>
  );
}

export function CodeBlock({
  block,
  color,
}: {
  block: Extract<MdBlock, { type: 'code' }>;
  color: string;
}) {
  return (
    <View style={[well, { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // A horizontal ScrollView grows to fill the free height; without this the code block stretches into a tall empty grey square.
        style={{ flexGrow: 0 }}
      >
        <RNText style={[CODE, { color }]}>{block.value}</RNText>
      </ScrollView>
    </View>
  );
}

function BlockView({
  block,
  color,
  first,
  trailing,
}: {
  block: MdBlock;
  color: string;
  first: boolean;
  trailing?: ReactNode;
}) {
  const wrapper: ViewStyle | undefined = first ? undefined : { marginTop: BLOCK_GAP };
  switch (block.type) {
    case 'paragraph':
      return (
        <View style={wrapper}>
          <Body nodes={block.children} color={color} trailing={trailing} />
        </View>
      );
    case 'heading':
      return (
        <View style={wrapper}>
          <Body nodes={block.children} color={color} style={headingStyle(block.level)} />
        </View>
      );
    case 'code':
      return (
        <View style={wrapper}>
          <CodeBlock block={block} color={color} />
        </View>
      );
    case 'quote':
      return (
        <View style={[{ borderLeftWidth: 2, borderLeftColor: QUOTE_BAR, paddingLeft: 8 }, wrapper]}>
          {block.children.map((child, index) => (
            <BlockView key={index} block={child} color={color} first={index === 0} />
          ))}
        </View>
      );
    case 'list':
      return (
        <View style={wrapper}>
          <ListBlock block={block} color={color} />
        </View>
      );
    case 'table':
      return (
        <View style={wrapper}>
          <MarkdownTable
            align={block.align}
            rows={block.rows}
            color={color}
            renderCell={renderInline}
          />
        </View>
      );
    case 'hr':
      return <View style={[{ height: 1, backgroundColor: RULE }, wrapper]} />;
  }
}

// Renders a safe Markdown reply with `Text` and `View` only: no raw HTML, no remote image. Memoized on `text`, `color` and `trailing`, so a reveal frame that repeats text does not re-parse. `trailing` is the caret plus an invisible meta copy that reserves its width, keeping the meta bottom-right.
export const MarkdownText = memo(function MarkdownText({
  text,
  color,
  trailing,
}: {
  text: string;
  color: string;
  trailing?: ReactNode;
}) {
  const blocks = useMemo(() => parseMessageMarkdown(text), [text]);
  const last = blocks[blocks.length - 1];
  const inlineTrailing = last !== undefined && last.type === 'paragraph';

  const trailingRow =
    trailing === undefined ? null : (
      <View style={{ alignItems: 'flex-end' }}>
        <RNText style={[BODY, { color }]}>{trailing}</RNText>
      </View>
    );

  if (blocks.length === 0) {
    return trailingRow;
  }

  return (
    <View>
      {blocks.map((block, index) => (
        <BlockView
          key={index}
          block={block}
          color={color}
          first={index === 0}
          trailing={inlineTrailing && index === blocks.length - 1 ? trailing : undefined}
        />
      ))}
      {inlineTrailing ? null : trailingRow}
    </View>
  );
});

// GFM tables for the mobile Markdown renderer: the shared parser hands the table its aligned inline cells; web renders the same tables with `remark-gfm`.

function cellText(nodes: MdInline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'code':
          return node.value;
        case 'break':
          return ' ';
        default:
          return cellText(node.children);
      }
    })
    .join('');
}

const CELL_TEXT: TextStyle = { fontSize: 13, lineHeight: 18, fontFamily: 'Geist_400Regular' };
const HEADER_TEXT: TextStyle = { fontFamily: 'Geist_600SemiBold' };
// Geist at 13 px averages under 8 px per glyph. The estimate errs wide so a column never breaks a word mid-word; the table scrolls horizontally, so a wider column costs nothing.
const CHAR_WIDTH = 8;
const CELL_PADDING = 16;
const MIN_COLUMN_WIDTH = 72;
const MAX_COLUMN_WIDTH = 220;

// Column widths from the widest cell, floored so the longest word always fits. Both bounds grow with the system font scale, so a scaled glyph never breaks a word mid-word.
function columnWidths(rows: MdInline[][][], scale: number): number[] {
  const width = rows[0]?.length ?? 0;
  return Array.from({ length: width }, (_, column) => {
    let widest = 0;
    let longestWord = 0;
    for (const row of rows) {
      const text = cellText(row[column] ?? []);
      widest = Math.max(widest, text.length);
      for (const word of text.split(/\s+/)) {
        longestWord = Math.max(longestWord, word.length);
      }
    }
    const pixels = Math.max(widest, longestWord) * CHAR_WIDTH * scale + CELL_PADDING;
    return Math.min(MAX_COLUMN_WIDTH * scale, Math.max(MIN_COLUMN_WIDTH * scale, pixels));
  });
}

function textAlign(align: MdTableAlign | undefined): TextStyle['textAlign'] {
  if (align === 'center') {
    return 'center';
  }
  if (align === 'right') {
    return 'right';
  }
  return 'left';
}

// A bordered, horizontally scrollable grid borrowing the code-block colours; `renderCell` renders one cell's inline Markdown, so the table shares the inline grammar without importing it back.
function MarkdownTable({
  align,
  rows,
  color,
  renderCell,
}: {
  align: MdTableAlign[];
  rows: MdInline[][][];
  color: string;
  renderCell: (cell: MdInline[]) => ReactNode;
}) {
  const { fontScale } = useWindowDimensions();
  const scale = Math.min(fontScale, MAX_FONT_SCALE);
  const widths = columnWidths(rows, scale);
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const row = (cells: MdInline[][], isHeader: boolean, key: number) => (
    <View key={key} style={{ flexDirection: 'row' }}>
      {cells.map((cell, column) => (
        <View
          key={column}
          style={{
            width: widths[column] ?? MIN_COLUMN_WIDTH,
            borderColor: BORDER,
            borderRightWidth: 1,
            borderBottomWidth: 1,
            paddingHorizontal: 8,
            paddingVertical: 5,
          }}
        >
          <RNText
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[
              CELL_TEXT,
              isHeader ? HEADER_TEXT : undefined,
              { color, textAlign: textAlign(align[column]) },
            ]}
          >
            {renderCell(cell)}
          </RNText>
        </View>
      ))}
    </View>
  );

  return (
    <View style={[well, { borderRadius: 8, overflow: 'hidden' }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // A horizontal ScrollView grows to fill the free height; without this the table stretches into a tall empty square (same as CodeBlock).
        style={{ flexGrow: 0 }}
      >
        <View>
          {row(header, true, -1)}
          {body.map((cells, index) => row(cells, false, index))}
        </View>
      </ScrollView>
    </View>
  );
}

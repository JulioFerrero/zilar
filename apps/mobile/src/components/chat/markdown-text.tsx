import { memo, type ReactNode } from 'react';
import {
  Linking,
  ScrollView,
  Text as RNText,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { well } from '../../lib/depth';
import { safeLinkTarget } from '../../lib/links';
import { parseInline, parseMarkdown, type Block, type InlineNode } from '../../lib/markdown';
import {
  MarkdownTable,
  splitMarkdownTables,
  type MarkdownPart,
  type MarkdownTableData,
} from './markdown-table';

// The bubble text, code and inline-code looks, shared with `link-text.tsx`
// (T-1227) so the plain path matches the full Markdown renderer.
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

function renderInline(nodes: InlineNode[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return node.value;
      case 'bold':
        return (
          <RNText key={index} style={{ fontFamily: 'Geist_600SemiBold' }}>
            {node.value}
          </RNText>
        );
      case 'italic':
        return (
          <RNText key={index} style={{ fontStyle: 'italic' }}>
            {node.value}
          </RNText>
        );
      case 'strike':
        return (
          <RNText key={index} style={{ textDecorationLine: 'line-through' }}>
            {node.value}
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
        const target = safeLinkTarget(node.href);
        if (target === undefined) {
          return node.value;
        }
        return (
          <RNText
            key={index}
            style={{ textDecorationLine: 'underline' }}
            onPress={() => {
              void Linking.openURL(target);
            }}
          >
            {node.value}
          </RNText>
        );
      }
    }
  });
}

function Body({
  nodes,
  color,
  style,
  trailing,
}: {
  nodes: InlineNode[];
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

function ListBlock({ block, color }: { block: Extract<Block, { type: 'list' }>; color: string }) {
  return (
    <View>
      {/* One `Text` per item with the marker inline. A row whose body was
          measured at one width and laid out at another left the bubble taller
          than its content, so the item is a single flowing text instead. Wrapped
          lines start under the marker; that is accepted. */}
      {block.items.map((item, index) => (
        <RNText key={index} style={[BODY, { color, paddingLeft: 12 }]}>
          {block.ordered ? item.marker : '•'}
          {'\u00a0'}
          {renderInline(item.nodes)}
        </RNText>
      ))}
    </View>
  );
}

/** A fenced code block, shared with the plain bubble path (T-1227). */
export function CodeBlock({
  block,
  color,
}: {
  block: Extract<Block, { type: 'code' }>;
  color: string;
}) {
  return (
    <View style={[well, { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // A horizontal ScrollView grows to fill the free height; without this
        // the code block stretches into a tall empty grey square.
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
  block: Block;
  color: string;
  first: boolean;
  trailing?: ReactNode;
}) {
  const wrapper: ViewStyle | undefined = first ? undefined : { marginTop: BLOCK_GAP };
  switch (block.type) {
    case 'paragraph':
      return (
        <View style={wrapper}>
          <Body nodes={block.nodes} color={color} trailing={trailing} />
        </View>
      );
    case 'heading':
      return (
        <View style={wrapper}>
          <Body nodes={block.nodes} color={color} style={headingStyle(block.level)} />
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
          <Body nodes={block.nodes} color={color} />
        </View>
      );
    case 'list':
      return (
        <View style={wrapper}>
          <ListBlock block={block} color={color} />
        </View>
      );
    case 'hr':
      return <View style={[{ height: 1, backgroundColor: RULE }, wrapper]} />;
  }
}

type RenderItem = { kind: 'block'; block: Block } | { kind: 'table'; table: MarkdownTableData };

/** Flattens the table split back into one ordered list of blocks and tables. */
function toItems(parts: MarkdownPart[]): RenderItem[] {
  const items: RenderItem[] = [];
  for (const part of parts) {
    if (part.kind === 'table') {
      items.push({ kind: 'table', table: part.table });
      continue;
    }
    for (const block of parseMarkdown(part.text)) {
      items.push({ kind: 'block', block });
    }
  }
  return items;
}

/**
 * Renders a safe Markdown reply with React Native `Text` and `View` only: no
 * library, no raw HTML and no remote image. GFM tables come from
 * `markdown-table`, the rest from the shared parser. Memoized on `text`,
 * `color` and `trailing`, so a reveal frame that repeats the same text does not
 * re-parse the whole reply.
 *
 * `trailing` is the caret plus an invisible copy of the time/ticks meta that
 * reserves the meta's width. Telegram puts the meta at the bottom-right and the
 * bubble draws it there (`META_OVERLAY`); the reserved width keeps it inline
 * after a short final paragraph and pushes a full line's meta to its own
 * right-aligned row, so it never wraps to the left.
 */
export const MarkdownText = memo(function MarkdownText({
  text,
  color,
  trailing,
}: {
  text: string;
  color: string;
  trailing?: ReactNode;
}) {
  const items = toItems(splitMarkdownTables(text));
  const last = items[items.length - 1];
  const inlineTrailing =
    last !== undefined && last.kind === 'block' && last.block.type === 'paragraph';

  const trailingRow =
    trailing === undefined ? null : (
      <View style={{ alignItems: 'flex-end' }}>
        <RNText style={[BODY, { color }]}>{trailing}</RNText>
      </View>
    );

  if (items.length === 0) {
    return trailingRow;
  }

  return (
    <View>
      {items.map((item, index) => {
        const first = index === 0;
        if (item.kind === 'table') {
          return (
            <View key={index} style={first ? undefined : { marginTop: BLOCK_GAP }}>
              <MarkdownTable
                table={item.table}
                color={color}
                renderCell={(cell) => renderInline(parseInline(cell))}
              />
            </View>
          );
        }
        return (
          <BlockView
            key={index}
            block={item.block}
            color={color}
            first={first}
            trailing={inlineTrailing && index === items.length - 1 ? trailing : undefined}
          />
        );
      })}
      {inlineTrailing ? null : trailingRow}
    </View>
  );
});

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
import { parseMarkdown, type Block, type InlineNode } from '../../lib/markdown';

const BODY: TextStyle = { fontSize: 15, lineHeight: 20, fontFamily: 'Geist_400Regular' };
const CODE: TextStyle = { fontSize: 13, lineHeight: 18, fontFamily: 'GeistMono_400Regular' };
const BLOCK_GAP = 6;
const INLINE_CODE_BACKGROUND = '#0c0c0c';
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

function Body({ nodes, color, style }: { nodes: InlineNode[]; color: string; style?: TextStyle }) {
  return <RNText style={[BODY, { color }, style]}>{renderInline(nodes)}</RNText>;
}

function ListBlock({ block, color }: { block: Extract<Block, { type: 'list' }>; color: string }) {
  return (
    <View>
      {block.items.map((item, index) => (
        <View key={index} style={{ flexDirection: 'row' }}>
          <RNText
            style={[BODY, { color, width: 22, marginRight: 6, textAlign: 'right' }]}
            accessible={false}
          >
            {block.ordered ? item.marker : '•'}
          </RNText>
          {/* `flexShrink` only: a `flex: 1` basis of 0 collapses the item to a
              sliver inside the shrink-wrapping bubble, so the text wraps a few
              characters per line. The auto basis lets the row size to its
              content and then shrink to the bubble's max width. */}
          <RNText style={[BODY, { color, flexShrink: 1 }]}>{renderInline(item.nodes)}</RNText>
        </View>
      ))}
    </View>
  );
}

function CodeBlock({ block, color }: { block: Extract<Block, { type: 'code' }>; color: string }) {
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

function BlockView({ block, color, first }: { block: Block; color: string; first: boolean }) {
  const wrapper: ViewStyle | undefined = first ? undefined : { marginTop: BLOCK_GAP };
  switch (block.type) {
    case 'paragraph':
      return (
        <View style={wrapper}>
          <Body nodes={block.nodes} color={color} />
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

/**
 * Renders a safe Markdown reply with React Native `Text` and `View` only: no
 * library, no raw HTML and no remote image. Memoized on `text` and `color`, so a
 * reveal frame that repeats the same text does not re-parse the whole reply.
 */
export const MarkdownText = memo(function MarkdownText({
  text,
  color,
}: {
  text: string;
  color: string;
}) {
  const blocks = parseMarkdown(text);
  if (blocks.length === 0) {
    return null;
  }
  return (
    <View>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} color={color} first={index === 0} />
      ))}
    </View>
  );
});

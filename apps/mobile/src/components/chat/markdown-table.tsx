import type { MdInline, MdTableAlign } from '@zilar/chat-core/markdown-ast';
import type { ReactNode } from 'react';
import {
  ScrollView,
  Text as RNText,
  View,
  useWindowDimensions,
  type TextStyle,
} from 'react-native';

import { MAX_FONT_SCALE } from '@/components/ui/text';
import { BORDER, well } from '@/lib/depth';

/**
 * GFM tables for the mobile Markdown renderer. The shared parser hands the
 * table view its aligned inline cells; web renders the same tables with
 * `remark-gfm`.
 */

/** The plain text of one cell, used only to estimate its column width. */
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
// Geist at 13 px averages a little under 8 px per glyph. The estimate errs wide
// so a column never breaks a word mid-word (`Medium` did at 56 px + 7 px/glyph);
// the table scrolls horizontally, so a wider column costs no layout.
const CHAR_WIDTH = 8;
const CELL_PADDING = 16;
const MIN_COLUMN_WIDTH = 72;
const MAX_COLUMN_WIDTH = 220;

/**
 * Column widths from the widest cell, floored so the longest word always fits.
 * Cells use the system font scale (capped at MAX_FONT_SCALE), so the pixel
 * estimate and both bounds grow with `scale`; otherwise a scaled glyph is wider
 * than the column and a word breaks mid-word.
 */
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

/**
 * A bordered, horizontally scrollable grid that borrows the code-block colours
 * (`well`). `renderCell` renders the inline Markdown of one cell, so the table
 * shares the renderer's inline grammar without importing it back.
 */
export function MarkdownTable({
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
        // A horizontal ScrollView grows to fill the free height; without this
        // the table stretches into a tall empty square (same reason as CodeBlock).
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

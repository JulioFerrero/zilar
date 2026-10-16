import type { TableBlock as TableBlockData } from '@zilar/protocol';
import { ScrollView, View } from 'react-native';

import { TABULAR } from '@/components/chat/blocks/figure-block';
import { Text } from '@/components/ui/text';

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
 * drawn as the total. Column one is the label column; every other column is a
 * right-aligned mono number. The grid is built column by column, so a column is
 * as wide as its widest cell and the rows stay aligned. A table wider than the
 * card scrolls sideways in its own `ScrollView`.
 */
export function TableBlock({
  block,
  showHeading,
}: {
  block: TableBlockData;
  showHeading: boolean;
}) {
  const totalIndex = block.total === true ? block.rows.length - 1 : -1;
  const lastColumn = block.columns.length - 1;
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
            const numeric = columnIndex > 0;
            const edge = columnIndex === 0 || columnIndex === lastColumn;
            return (
              <View
                key={columnIndex}
                // Column one hugs the left and grows into the card; the number
                // columns keep their content width so a wide table overflows.
                className={columnIndex === 0 ? 'grow shrink-0' : undefined}
              >
                <Cell text={column} numeric={numeric} className={numeric ? HEADER_NUM : HEADER} />
                {block.rows.map((row, rowIndex) =>
                  rowIndex === totalIndex ? (
                    <Cell
                      key={rowIndex}
                      text={row[columnIndex] ?? ''}
                      numeric={numeric}
                      className={`${numeric ? TOTAL_NUM : TOTAL}${edge ? TOTAL_EDGE : ''}`}
                    />
                  ) : (
                    <Cell
                      key={rowIndex}
                      text={row[columnIndex] ?? ''}
                      numeric={numeric}
                      className={numeric ? CELL_NUM : CELL}
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

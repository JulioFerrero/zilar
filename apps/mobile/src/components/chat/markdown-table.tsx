import type { ReactNode } from 'react';
import { ScrollView, Text as RNText, View, type TextStyle } from 'react-native';

import { BORDER, well } from '@/lib/depth';

/**
 * GFM tables for the mobile Markdown renderer (T-1328). The shared parser in
 * `lib/markdown` has no table block, so this module detects tables straight from
 * the source lines and hands the renderer the remaining Markdown as text. The
 * split is fence-aware: pipes inside a fenced code block are never a table. Web
 * renders the same tables with `remark-gfm`.
 */

export type TableAlign = 'left' | 'center' | 'right' | 'default';

export interface MarkdownTableData {
  header: string[];
  align: TableAlign[];
  rows: string[][];
}

export type MarkdownPart =
  { kind: 'markdown'; text: string } | { kind: 'table'; table: MarkdownTableData };

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const DELIMITER_CELL = /^:?-+:?$/;

/**
 * Splits one row into trimmed cells, dropping the empty cells the outer pipes
 * create. GFM parses code spans before cells, so a pipe inside `` `...` `` never
 * splits a cell; the split tracks the opening backtick run to stay inside one.
 */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let codeSpan = 0;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] ?? '';
    if (character === '`') {
      let run = 1;
      while (line[index + run] === '`') {
        run += 1;
      }
      current += line.slice(index, index + run);
      if (codeSpan === 0) {
        codeSpan = run;
      } else if (run === codeSpan) {
        codeSpan = 0;
      }
      index += run - 1;
      continue;
    }
    if (character === '\\' && codeSpan === 0 && line[index + 1] === '|') {
      current += '|';
      index += 1;
      continue;
    }
    if (character === '|' && codeSpan === 0) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  cells.push(current.trim());

  if (cells.length > 0 && cells[0] === '') {
    cells.shift();
  }
  if (cells.length > 0 && cells[cells.length - 1] === '') {
    cells.pop();
  }
  return cells;
}

function isDelimiterRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => DELIMITER_CELL.test(cell));
}

function alignmentOf(cell: string): TableAlign {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) {
    return 'center';
  }
  if (right) {
    return 'right';
  }
  if (left) {
    return 'left';
  }
  return 'default';
}

/** Pads or trims a row so every row has exactly `width` cells. */
function fitCells(cells: string[], width: number): string[] {
  const fitted = cells.slice(0, width);
  while (fitted.length < width) {
    fitted.push('');
  }
  return fitted;
}

function closingFence(character: string, length: number): RegExp {
  return new RegExp(`^ {0,3}${character}{${String(length)},}\\s*$`);
}

/**
 * Splits the source into Markdown runs and tables. Pure and total: a header row
 * is only a table when the next line is a matching delimiter row, so ordinary
 * text with pipes stays text.
 */
export function splitMarkdownTables(text: string): MarkdownPart[] {
  const lines = text.split(/\r?\n/);
  const parts: MarkdownPart[] = [];
  let buffer: string[] = [];
  let fence: { character: string; length: number } | undefined;
  let index = 0;

  const flush = (): void => {
    if (buffer.length > 0) {
      parts.push({ kind: 'markdown', text: buffer.join('\n') });
      buffer = [];
    }
  };

  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (fence !== undefined) {
      buffer.push(line);
      if (closingFence(fence.character, fence.length).test(line)) {
        fence = undefined;
      }
      index += 1;
      continue;
    }

    const fenceOpen = FENCE.exec(line);
    if (fenceOpen !== null) {
      const marker = fenceOpen[1] ?? '```';
      fence = { character: marker[0] === '~' ? '~' : '`', length: marker.length };
      buffer.push(line);
      index += 1;
      continue;
    }

    if (line.includes('|')) {
      const header = splitRow(line);
      const delimiterLine = lines[index + 1];
      const delimiterCells = delimiterLine === undefined ? [] : splitRow(delimiterLine);
      if (
        delimiterLine !== undefined &&
        delimiterLine.includes('|') &&
        delimiterCells.length === header.length &&
        isDelimiterRow(delimiterCells)
      ) {
        flush();
        const rows: string[][] = [];
        let row = index + 2;
        while (row < lines.length) {
          const rowLine = lines[row] ?? '';
          if (rowLine.trim() === '' || !rowLine.includes('|') || FENCE.test(rowLine)) {
            break;
          }
          rows.push(fitCells(splitRow(rowLine), header.length));
          row += 1;
        }
        parts.push({
          kind: 'table',
          table: { header, align: delimiterCells.map(alignmentOf), rows },
        });
        index = row;
        continue;
      }
    }

    buffer.push(line);
    index += 1;
  }

  flush();
  return parts;
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

/** Column widths from the widest cell, floored so the longest word always fits. */
function columnWidths(table: MarkdownTableData): number[] {
  return table.header.map((_, column) => {
    const cells = [table.header[column] ?? '', ...table.rows.map((row) => row[column] ?? '')];
    let widest = 0;
    let longestWord = 0;
    for (const cell of cells) {
      widest = Math.max(widest, cell.length);
      for (const word of cell.split(/\s+/)) {
        longestWord = Math.max(longestWord, word.length);
      }
    }
    const width = Math.max(widest, longestWord) * CHAR_WIDTH + CELL_PADDING;
    return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width));
  });
}

function textAlign(align: TableAlign): TextStyle['textAlign'] {
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
  table,
  color,
  renderCell,
}: {
  table: MarkdownTableData;
  color: string;
  renderCell: (cell: string) => ReactNode;
}) {
  const widths = columnWidths(table);
  const row = (cells: string[], header: boolean, key: number) => (
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
            style={[
              CELL_TEXT,
              header ? HEADER_TEXT : undefined,
              { color, textAlign: textAlign(table.align[column] ?? 'default') },
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
          {row(table.header, true, -1)}
          {table.rows.map((cells, index) => row(cells, false, index))}
        </View>
      </ScrollView>
    </View>
  );
}

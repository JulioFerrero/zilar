// `WatchApp`: the pure `lead watch` view (view plus refresh state in,
// terminal lines out) so tests can render it with `ink-testing-library`.
// Moved unchanged from `lead/watch-app.tsx` (size split).

import { Box, useStdout } from 'ink';
import type { ReactNode } from 'react';
import {
  columnWidths,
  COMPACT_WIDTH,
  iconsEnabled,
  layoutColumns,
  visibleSlice,
  type VisibleSlice,
} from '../watch-format.js';
import type { WatchView } from '../watch.js';
import { EmptyCard, Footer, Header, TaskCard } from './chrome.js';
import { HEADER_ROWS, rowHeights, rowsOf } from './segments.js';

export interface WatchAppProps {
  view: WatchView;
  updatedAgoSecs: number;
  columns?: number;
  rows?: number;
  scroll?: number;
  clock?: string;
  icons?: boolean;
}

export function WatchApp({
  view,
  updatedAgoSecs,
  columns,
  rows,
  scroll,
  clock,
  icons,
}: WatchAppProps): ReactNode {
  const { stdout } = useStdout();
  const ttyColumns = (stdout as { columns?: unknown }).columns;
  const width = Math.max(
    20,
    Math.floor(columns ?? (typeof ttyColumns === 'number' ? ttyColumns : 80)),
  );
  const ttyRows = (stdout as { rows?: unknown }).rows;
  const knownRows =
    typeof rows === 'number'
      ? Math.floor(rows)
      : typeof ttyRows === 'number'
        ? Math.floor(ttyRows)
        : undefined;
  const showIcons = icons ?? iconsEnabled(false);
  const compact = width < COMPACT_WIDTH;

  // Without a known height (a non-TTY) render everything in one column, as
  // before scrolling and the two-column layout existed.
  if (knownRows === undefined) {
    return (
      <Box flexDirection="column" width={width}>
        <Header view={view} clock={clock ?? view.clock} width={width} icons={showIcons} />
        {view.entries.map((entry) => (
          <TaskCard
            key={entry.id}
            entry={entry}
            width={width}
            compact={compact}
            icons={showIcons}
          />
        ))}
        {view.entries.length === 0 ? <EmptyCard width={width} /> : null}
        <Footer view={view} updatedAgoSecs={updatedAgoSecs} icons={showIcons} width={width} />
      </Box>
    );
  }

  const columnCount = layoutColumns(width);
  const widths = columnWidths(width, columnCount);
  const cardRows = rowsOf(view.entries, columnCount);
  const availableRows = Math.max(0, knownRows - HEADER_ROWS - 1);
  const slice: VisibleSlice = visibleSlice(rowHeights(cardRows), scroll ?? 0, availableRows);
  const visibleRows = cardRows.slice(slice.start, slice.end);
  return (
    <Box flexDirection="column" width={width}>
      <Header view={view} clock={clock ?? view.clock} width={width} icons={showIcons} />
      {visibleRows.map((cards) => (
        <Box key={cards[0]?.id ?? 'row'} flexDirection="row" width={width} gap={1}>
          {cards.map((card, index) => {
            const cardWidth = widths[index] ?? width;
            return (
              <Box key={card.id} flexDirection="column" width={cardWidth}>
                <TaskCard
                  entry={card}
                  width={cardWidth}
                  compact={cardWidth < COMPACT_WIDTH}
                  icons={showIcons}
                />
              </Box>
            );
          })}
        </Box>
      ))}
      {view.entries.length === 0 ? <EmptyCard width={width} /> : null}
      <Footer
        view={view}
        updatedAgoSecs={updatedAgoSecs}
        icons={showIcons}
        width={width}
        hiddenAbove={slice.hiddenAbove}
        hiddenBelow={slice.hiddenBelow}
      />
    </Box>
  );
}

import { numericColumns } from '@zilar/chat-core';
import type { TableBlock as TableBlockData } from '@zilar/protocol';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

// The board's table (`WebNumbers.dc.html:134-142`): the header rule is `#232323`;
// a data row carries a `#1c1c1c` rule under it; a total row sits under a rule and
// is bold in its first and last cells. T-1793: alignment is per column, from
// `numericColumns` — number columns are right-aligned, mono and tabular; text
// columns are left-aligned in the body font.
const HEAD_CELL = 'border-b border-[#232323] pb-[6px] text-[12px] text-[#8a8a8a]';
const ROW_CELL = 'border-b border-[#1c1c1c] py-[6px]';
const LAST_ROW_CELL = 'py-[6px]';
const TOTAL_CELL = 'pt-[6px]';
const NUMBER = 'text-right font-mono tabular-nums';

/**
 * 04 · TABLE: a header row and the rows, with an optional total row.
 * `showHeading` draws the block's own title when the card has no header. A
 * table wider than the card scrolls sideways; while it does, a right-edge fade
 * says it is cut and 8 px of bottom padding keeps the last row clear of an
 * overlay scrollbar.
 */
export function TableBlock({
  block,
  showHeading,
}: {
  block: TableBlockData;
  showHeading: boolean;
}) {
  const columns = block.columns.length;
  const numeric = numericColumns(block.columns, block.rows);
  const autoColumns = Array.from({ length: columns - 1 }, () => 'auto');
  const gridTemplateColumns = ['1fr', ...autoColumns].join(' ');
  const lastRow = block.rows.length - 1;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    const box = scrollRef.current;
    if (box === null) return;
    const update = () => {
      const overflows = box.scrollWidth > box.clientWidth;
      setOverflowing(overflows);
      setAtEnd(!overflows || box.scrollLeft + box.clientWidth >= box.scrollWidth - 1);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(box);
    const grid = box.firstElementChild;
    if (grid !== null) observer.observe(grid);
    return () => observer.disconnect();
  }, [block]);

  const onScroll = () => {
    const box = scrollRef.current;
    if (box === null) return;
    setAtEnd(box.scrollLeft + box.clientWidth >= box.scrollWidth - 1);
  };

  return (
    <>
      {showHeading && block.title !== undefined && (
        <div className="flex items-center gap-2 text-[13px] font-medium text-[#a1a1a1]">
          <span className="min-w-0 flex-1 truncate">{block.title}</span>
        </div>
      )}
      {/* A table wider than the card scrolls inside its own box instead of
          stretching the card (`overflow-x` on the wrapper, `min-w-max` on the
          grid so the columns keep their width). */}
      <div className="relative min-w-0">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className={cn('min-w-0 overflow-x-auto', overflowing && 'pb-[8px]')}
        >
          <div className="grid min-w-max gap-x-[18px]" style={{ gridTemplateColumns }}>
            {block.columns.map((column, index) => (
              <span
                key={`head-${index}`}
                className={cn(HEAD_CELL, numeric[index] === true && NUMBER)}
              >
                {column}
              </span>
            ))}
            {block.rows.map((row, rowIndex) =>
              row.map((cell, index) => {
                const total = rowIndex === lastRow && block.total === true;
                const bold = total && (index === 0 || index === columns - 1);
                return (
                  <span
                    key={`${rowIndex}-${index}`}
                    className={cn(
                      total ? TOTAL_CELL : rowIndex < lastRow ? ROW_CELL : LAST_ROW_CELL,
                      numeric[index] === true && NUMBER,
                      bold && 'font-semibold',
                    )}
                  >
                    {cell}
                  </span>
                );
              }),
            )}
          </div>
        </div>
        {overflowing && !atEnd && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-[24px] bg-gradient-to-r from-transparent to-[#141414]"
          />
        )}
      </div>
    </>
  );
}

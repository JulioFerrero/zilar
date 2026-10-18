import { numericColumns } from '@zilar/chat-core';
import type { StatsBlock as StatsBlockData, TableBlock as TableBlockData } from '@zilar/protocol';
import { Server } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const TILE =
  'flex flex-col gap-[6px] rounded-[12px] border border-[#1f1f1f] bg-[#101010] px-3 py-2.5';

const TRACK =
  'h-[6px] overflow-hidden rounded-full bg-[#0c0c0c] shadow-[inset_0_1px_2px_rgba(0,0,0,.9),0_1px_0_rgba(255,255,255,.05)]';
const FILL = 'h-full rounded-full bg-gradient-to-b from-[#f5f5f5] to-[#b5b5b5]';

const HEAD_CELL = 'border-b border-[#232323] pb-[6px] text-[12px] text-[#8a8a8a]';
const ROW_CELL = 'border-b border-[#1c1c1c] py-[6px]';
const LAST_ROW_CELL = 'py-[6px]';
const TOTAL_CELL = 'pt-[6px]';
const NUMBER = 'text-right font-mono tabular-nums';

export function StatsBlock({
  block,
  showHeading,
}: {
  block: StatsBlockData;
  showHeading: boolean;
}) {
  return (
    <>
      {showHeading && block.title !== undefined && (
        <div className="flex items-center gap-2 text-[13px] font-medium text-[#a1a1a1]">
          <Server className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{block.title}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {block.tiles.map((tile, index) => (
          <div key={`${tile.label}-${index}`} className={TILE}>
            <span className="truncate text-[12px] text-[#a1a1a1]">{tile.label}</span>
            <span className="text-left font-mono text-[18px] leading-6 tabular-nums">
              {tile.value}
            </span>
            {tile.ratio === undefined ? (
              <span className="h-[6px]" aria-hidden="true" />
            ) : (
              <div className={TRACK}>
                {/* The ratio is 0-1; a rounded percentage keeps the style clean. */}
                <div
                  className={FILL}
                  style={{ width: `${Number((tile.ratio * 100).toFixed(2))}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

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
       * stretching it, so the columns keep their width.
       */}
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

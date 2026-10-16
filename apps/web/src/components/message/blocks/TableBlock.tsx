import type { TableBlock as TableBlockData } from '@zilar/protocol';
import { cn } from '@/lib/utils';

// The board's table (`WebNumbers.dc.html:134-142`): the first column is the row
// label and the rest are pre-formatted numbers, mono, tabular and right-aligned.
// The header rule is `#232323`; a data row carries a `#1c1c1c` rule under it; a
// total row sits under a rule and is bold in its first and last cells.
const HEAD_CELL = 'border-b border-[#232323] pb-[6px] text-[12px] text-[#8a8a8a]';
const ROW_CELL = 'border-b border-[#1c1c1c] py-[6px]';
const LAST_ROW_CELL = 'py-[6px]';
const TOTAL_CELL = 'pt-[6px]';
const NUMBER = 'text-right font-mono tabular-nums';

/** 04 · TABLE: a header row and the rows, with an optional total row. */
export function TableBlock({ block }: { block: TableBlockData }) {
  const columns = block.columns.length;
  const autoColumns = Array.from({ length: columns - 1 }, () => 'auto');
  const gridTemplateColumns = ['1fr', ...autoColumns].join(' ');
  const lastRow = block.rows.length - 1;
  return (
    <>
      {block.title !== undefined && (
        <div className="flex items-center gap-2 text-[13px] font-medium text-[#a1a1a1]">
          <span className="min-w-0 flex-1 truncate">{block.title}</span>
        </div>
      )}
      {/* A table wider than the card scrolls inside its own box instead of
          stretching the card (`overflow-x` on the wrapper, `min-w-max` on the
          grid so the columns keep their width). */}
      <div className="min-w-0 overflow-x-auto">
        <div className="grid min-w-max gap-x-[18px]" style={{ gridTemplateColumns }}>
          {block.columns.map((column, index) => (
            <span key={`head-${index}`} className={cn(HEAD_CELL, index > 0 && NUMBER)}>
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
                    index > 0 && NUMBER,
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
    </>
  );
}

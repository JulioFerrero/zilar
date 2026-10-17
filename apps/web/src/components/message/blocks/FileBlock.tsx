import type { FileBlock as FileBlockData } from '@zilar/protocol';
import { Download, File } from 'lucide-react';
import { BLOCK_KEY } from './blockKey';

// The raised file tile of the boards (`WebContent.dc.html:27`).
const TILE = {
  background: 'linear-gradient(180deg,#2c2c2c,#151515)',
  border: '1px solid #050505',
  boxShadow:
    'inset 0 1px 0 rgba(255,255,255,.16), inset 0 -1px 0 rgba(0,0,0,.65), 0 1px 0 rgba(0,0,0,.95)',
};

/** 24 · FILE: the file tile, the name and `size · format · rows`, plus Download. */
export function FileBlock({ block }: { block: FileBlockData }) {
  const meta = [
    block.size,
    block.format,
    block.rows === undefined ? undefined : `${block.rows} rows`,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' · ');
  return (
    <div className="flex items-center gap-3">
      <div
        className="flex size-10 shrink-0 items-center justify-center rounded-[10px]"
        style={TILE}
      >
        <File className="size-[18px] text-[#d4d4d4]" strokeWidth={1.8} aria-hidden="true" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium">{block.name}</span>
        <span className="truncate font-mono text-[11px] text-[#8a8a8a]">{meta}</span>
      </div>
      <a
        href={`/api/card-media/${block.media}`}
        download={block.name}
        aria-label="Download"
        className="flex size-9 shrink-0 items-center justify-center rounded-[10px]"
        style={BLOCK_KEY}
      >
        <Download className="size-4 text-[#d4d4d4]" strokeWidth={2} aria-hidden="true" />
      </a>
    </div>
  );
}

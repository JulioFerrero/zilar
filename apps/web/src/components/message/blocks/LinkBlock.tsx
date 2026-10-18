import { linkHost } from '@zilar/chat-core';
import type { LinkBlock as LinkBlockData } from '@zilar/protocol';
import { Link } from 'lucide-react';

const TILE = {
  background: 'linear-gradient(180deg,#2c2c2c,#151515)',
  border: '1px solid #050505',
  boxShadow:
    'inset 0 1px 0 rgba(255,255,255,.16), inset 0 -1px 0 rgba(0,0,0,.65), 0 1px 0 rgba(0,0,0,.95)',
};

export function LinkBlock({ block }: { block: LinkBlockData }) {
  return (
    <a
      href={block.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-3 rounded-[12px] border border-[#1f1f1f] bg-[#101010] p-[10px]"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate font-mono text-[11px] text-[#8a8a8a]">
          {block.site ?? linkHost(block.url)}
        </span>
        <span className="min-w-0 truncate font-medium">{block.title}</span>
        {block.description !== undefined && (
          <span className="text-[13px] text-[#a1a1a1]">{block.description}</span>
        )}
      </div>
      <div
        className="flex size-14 shrink-0 items-center justify-center rounded-[12px]"
        style={TILE}
      >
        <Link className="size-[22px] text-[#d4d4d4]" strokeWidth={1.8} aria-hidden="true" />
      </div>
    </a>
  );
}

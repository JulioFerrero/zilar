import { calloutTone, type BlockTone } from '@zilar/chat-core';
import type { CalloutBlock as CalloutBlockData } from '@zilar/protocol';
import { Check, CircleAlert, Info, TriangleAlert, type LucideIcon } from 'lucide-react';

// The callout recipe of the boards (`WebContent.dc.html:105-115`): a tinted
// circle with the tone's glyph and colour, then the one line of text.
const CALLOUT: Record<BlockTone, { color: string; background: string; icon: LucideIcon }> = {
  positive: { color: '#4ade80', background: 'rgba(34,197,94,.14)', icon: Check },
  warning: { color: '#fbbf24', background: 'rgba(251,191,36,.14)', icon: TriangleAlert },
  negative: { color: '#ef4444', background: 'rgba(239,68,68,.14)', icon: CircleAlert },
  info: { color: '#ededed', background: 'rgba(237,237,237,.10)', icon: Info },
  neutral: { color: '#a1a1a1', background: 'rgba(161,161,161,.12)', icon: Info },
};

/** 25 · CALLOUT: one tone, one line. */
export function CalloutBlock({ block }: { block: CalloutBlockData }) {
  // A newer server may add a tone (expand/contract); an unknown one falls back
  // to the neutral look instead of leaving `tone` undefined and throwing on
  // `tone.icon`.
  const tone = CALLOUT[calloutTone(block.tone)] ?? CALLOUT.neutral;
  const Icon = tone.icon;
  return (
    <div className="flex items-center gap-3">
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-full"
        style={{ background: tone.background }}
      >
        <Icon
          className="size-4"
          style={{ color: tone.color }}
          strokeWidth={2.4}
          aria-hidden="true"
        />
      </span>
      <span className="min-w-0 flex-1">{block.text}</span>
    </div>
  );
}

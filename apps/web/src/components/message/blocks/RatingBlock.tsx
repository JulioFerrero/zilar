// effect-plain: a presentational control; the block card owns the request.
import type { RatingBlock as RatingBlockData } from '@zilar/protocol';
import { Star } from 'lucide-react';
import { useState } from 'react';
import { useBlockReply, useBlockRespond } from './BlockRespond';

// The board's dark square key (`WebChoices.dc.html:27`), 36 px and icon-only.
const KEY_STYLE = {
  border: '1px solid #2a2a2a',
  background: 'linear-gradient(180deg,#1c1c1c,#121212)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.06), 0 2px 6px rgba(0,0,0,.6)',
};

/**
 * 17 · RATING: the prompt, then `max` dark star keys. Stars up to the chosen one
 * are filled; the rest are outlined. A tap answers with 1..`max` and sends
 * "{n}/{max}" as the @AI reply.
 */
export function RatingBlock({ block }: { block: RatingBlockData }) {
  const respond = useBlockRespond();
  const reply = useBlockReply();
  const [selected, setSelected] = useState<number | undefined>(block.selected);
  const [seenSelected, setSeenSelected] = useState(block.selected);
  const [busy, setBusy] = useState(false);

  // React's prop-sync pattern: a room correction replaces the local pick.
  if (block.selected !== seenSelected) {
    setSeenSelected(block.selected);
    setSelected(block.selected);
  }

  const rate = (rating: number): void => {
    if (respond === null || busy || selected === rating) {
      return;
    }
    const previous = selected;
    setSelected(rating);
    setBusy(true);
    void respond.answer(block.id, { rating }).then((data) => {
      setBusy(false);
      if (data === null) {
        setSelected(previous);
        return;
      }
      reply(`${rating}/${block.max}`);
    });
  };

  const stars = Array.from({ length: block.max }, (_, index) => index + 1);
  return (
    <>
      <span>{block.prompt}</span>
      <div role="radiogroup" aria-label={block.prompt} className="flex gap-1.5">
        {stars.map((rating) => {
          const on = selected !== undefined && rating <= selected;
          return (
            <button
              key={rating}
              type="button"
              role="radio"
              aria-checked={selected === rating}
              aria-label={`${rating} ${rating === 1 ? 'star' : 'stars'}`}
              disabled={respond === null || busy}
              aria-disabled={respond === null || busy}
              onClick={() => rate(rating)}
              className="flex size-9 items-center justify-center rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ededed]/50 disabled:cursor-default"
              style={KEY_STYLE}
            >
              <Star
                className="size-[18px]"
                aria-hidden="true"
                fill={on ? '#ededed' : 'none'}
                stroke={on ? '#ededed' : '#5a5a5a'}
                strokeWidth={on ? 0 : 1.6}
              />
            </button>
          );
        })}
      </div>
    </>
  );
}

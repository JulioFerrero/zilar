// effect-plain: presentational block controls; the block card owns the request.
import type {
  ChoiceBlock as ChoiceBlockData,
  RatingBlock as RatingBlockData,
} from '@zilar/protocol';
import { Star } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useBlockReply, useBlockRespond } from './BlockRespond';

const KEY_STYLE = {
  border: '1px solid #2a2a2a',
  background: 'linear-gradient(180deg,#1c1c1c,#121212)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.06), 0 2px 6px rgba(0,0,0,.6)',
};

const SEG = {
  background: '#0c0c0c',
  border: '1px solid #1a1a1a',
  boxShadow: 'inset 0 2px 6px rgba(0,0,0,.9), 0 1px 0 rgba(255,255,255,.06)',
};
const ON = {
  background: 'linear-gradient(180deg,#333,#1c1c1c)',
  boxShadow:
    'inset 0 1px 0 rgba(255,255,255,.16), inset 0 -1px 0 rgba(0,0,0,.6), 0 1px 0 rgba(0,0,0,.9), 0 2px 4px rgba(0,0,0,.7)',
};

function useBlockSelection(initial: number | undefined) {
  const [selected, setSelected] = useState(initial);
  const [seenSelected, setSeenSelected] = useState(initial);
  const [busy, setBusy] = useState(false);
  if (initial !== seenSelected) {
    setSeenSelected(initial);
    setSelected(initial);
  }
  return { selected, setSelected, busy, setBusy };
}

export function ChoiceBlock({ block }: { block: ChoiceBlockData }) {
  const respond = useBlockRespond();
  const reply = useBlockReply();
  const { selected, setSelected, busy, setBusy } = useBlockSelection(block.selected);

  const choose = (index: number): void => {
    if (respond === null || busy || selected === index) {
      return;
    }
    const previous = selected;
    setSelected(index);
    setBusy(true);
    void respond.answer(block.id, { selected: index }).then((data) => {
      setBusy(false);
      if (data === null) {
        setSelected(previous);
        return;
      }
      const option = block.options[index];
      if (option !== undefined) {
        reply(option);
      }
    });
  };

  return (
    <>
      <span>{block.question}</span>
      <div
        role="radiogroup"
        aria-label={block.question}
        className="flex gap-0.5 rounded-[10px] p-[3px]"
        style={SEG}
      >
        {block.options.map((option, index) => {
          const on = selected === index;
          return (
            <button
              key={`${index}-${option}`}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={respond === null || busy}
              aria-disabled={respond === null || busy}
              onClick={() => choose(index)}
              className={cn(
                'h-[30px] min-w-0 flex-1 truncate rounded-[7px] px-2 font-mono text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ededed]/50 disabled:cursor-default',
                on ? 'text-[#ededed]' : 'text-[#a1a1a1]',
              )}
              style={on ? ON : undefined}
            >
              {option}
            </button>
          );
        })}
      </div>
    </>
  );
}

export function RatingBlock({ block }: { block: RatingBlockData }) {
  const respond = useBlockRespond();
  const reply = useBlockReply();
  const { selected, setSelected, busy, setBusy } = useBlockSelection(block.selected);

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

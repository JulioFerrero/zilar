// effect-plain: a presentational control; the block card owns the request.
import type { ChoiceBlock as ChoiceBlockData } from '@zilar/protocol';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useBlockReply, useBlockRespond } from './BlockRespond';

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

export function ChoiceBlock({ block }: { block: ChoiceBlockData }) {
  const respond = useBlockRespond();
  const reply = useBlockReply();
  const [selected, setSelected] = useState<number | undefined>(block.selected);
  const [seenSelected, setSeenSelected] = useState(block.selected);
  const [busy, setBusy] = useState(false);

  if (block.selected !== seenSelected) {
    setSeenSelected(block.selected);
    setSelected(block.selected);
  }

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

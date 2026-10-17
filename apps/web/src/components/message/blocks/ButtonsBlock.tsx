// effect-plain: a presentational control; the block card owns the request.
import { formatTime } from '@zilar/chat-core';
import type { ButtonsBlock as ButtonsBlockData } from '@zilar/protocol';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useBlockReply, useBlockRespond } from './BlockRespond';

// The board's keys (`WebChoices.dc.html:25-27`): 36 px high, 10 px radius, a
// raised light or dark face. The focus ring is the web build's, not the board's.
const KEY =
  'inline-flex h-9 items-center justify-center rounded-[10px] px-4 text-[14px] font-medium transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ededed]/50 disabled:cursor-default';
const KEY_LIGHT = 'border border-white text-[#0a0a0a]';
const KEY_DARK = 'border border-[#2a2a2a] text-[#ededed]';
const KEY_LIGHT_STYLE = {
  background: 'linear-gradient(180deg,#ffffff,#d9d9d9)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.4), 0 2px 6px rgba(0,0,0,.6)',
};
const KEY_DARK_STYLE = {
  background: 'linear-gradient(180deg,#1c1c1c,#121212)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.06), 0 2px 6px rgba(0,0,0,.6)',
};

type Answer = {
  actionId?: string;
  label: string;
  at: Date;
  by?: string | undefined;
  mine: boolean;
};

/** The answered row the server merged in; `undefined` when the card is open. */
function chosenAnswer(block: ButtonsBlockData): Answer | undefined {
  const chosen = block.chosen;
  const action =
    chosen === undefined ? undefined : block.actions.find((item) => item.id === chosen.actionId);
  if (chosen === undefined || action === undefined) {
    return undefined;
  }
  return {
    actionId: action.id,
    label: action.label,
    at: new Date(chosen.at),
    by: chosen.by,
    mine: false,
  };
}

/**
 * 13 · BUTTONS: the line, then its keys. A press answers with the action id; on
 * success the keys become the answered row (the green tick, the label, the
 * time) and the label is sent as the @AI reply. The recorded `chosen` action
 * reopens the card answered for everyone.
 */
export function ButtonsBlock({
  block,
  initialAnswer,
}: {
  block: ButtonsBlockData;
  /** The answered row a fixture starts with; a live card starts open. */
  initialAnswer?: { label: string; at: Date };
}) {
  const respond = useBlockRespond();
  const reply = useBlockReply();
  const [answered, setAnswered] = useState<Answer | null>(() => {
    if (initialAnswer !== undefined) {
      return { ...initialAnswer, mine: true };
    }
    return chosenAnswer(block) ?? null;
  });
  const [seenChosen, setSeenChosen] = useState(block.chosen);
  const [busy, setBusy] = useState(false);

  // React's prop-sync pattern: the room correction fills `chosen` in. A tap
  // made in this view on the same action keeps the "You chose" wording.
  if (block.chosen !== seenChosen) {
    setSeenChosen(block.chosen);
    const next = chosenAnswer(block);
    if (next !== undefined) {
      setAnswered((current) =>
        current !== null && current.actionId === next.actionId ? { ...next, mine: true } : next,
      );
    }
  }

  const press = (action: ButtonsBlockData['actions'][number]): void => {
    if (respond === null || busy || answered !== null) {
      return;
    }
    setAnswered({ actionId: action.id, label: action.label, at: new Date(), mine: true });
    setBusy(true);
    void respond.answer(block.id, { actionId: action.id }).then((next) => {
      setBusy(false);
      if (next === null) {
        setAnswered(null);
        return;
      }
      reply(action.label);
    });
  };

  return (
    <>
      <span>{block.text}</span>
      {answered === null ? (
        <div className="flex flex-wrap gap-2">
          {block.actions.map((action) => {
            const light = action.style === 'light';
            return (
              <button
                key={action.id}
                type="button"
                disabled={respond === null || busy}
                aria-disabled={respond === null || busy}
                onClick={() => press(action)}
                className={cn(KEY, light ? KEY_LIGHT : KEY_DARK)}
                style={light ? KEY_LIGHT_STYLE : KEY_DARK_STYLE}
              >
                {action.label}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[13px] text-[#a1a1a1]">
          <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-[#22c55e]">
            <Check className="size-3 text-[#0a0a0a]" strokeWidth={3} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1 truncate">
            {answered.mine ? 'You' : (answered.by ?? 'Someone')} chose{' '}
            <span className="font-medium text-[#ededed]">{answered.label}</span>
          </span>
          <span className="shrink-0 font-mono text-[12px] tabular-nums text-[#8a8a8a]">
            {formatTime(answered.at)}
          </span>
        </div>
      )}
    </>
  );
}

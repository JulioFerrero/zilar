// effect-plain: a presentational control; the block card owns the request.
import type { AlertBlock as AlertBlockData } from '@zilar/protocol';
import { Bell } from 'lucide-react';
import { useState } from 'react';
import { useBlockRespond } from './BlockRespond';
import { ICON_KEY_STYLE, MAX_FIELD_CHARS, WELL_STYLE } from './choiceStyles';

// The board's on switch (`WebChoices.dc.html:163`): a light track with a dark
// knob at the right; the off look is the dark icon key with a grey knob at the
// left.
const ON_TRACK_STYLE = {
  background: 'linear-gradient(180deg,#ffffff,#d4d4d4)',
  boxShadow: 'inset 0 1px 0 #fff, 0 1px 2px rgba(0,0,0,.8)',
};
const KNOB_SHADOW = 'inset 0 1px 0 rgba(255,255,255,.16), 0 1px 2px rgba(0,0,0,.8)';
const ON_KNOB_STYLE = {
  background: 'linear-gradient(180deg,#2c2c2c,#151515)',
  boxShadow: KNOB_SHADOW,
};
const OFF_KNOB_STYLE = { background: '#8a8a8a', boxShadow: KNOB_SHADOW };

/**
 * 18 · ALERT RULE: the bell and title header, a well showing the threshold and
 * the switch, then the note. The well commits on Enter or blur and the switch
 * on tap; both answer through `BlockRespond` and revert when the request fails.
 * An alert answer is not a decision, so no @AI reply is sent.
 */
export function AlertBlock({
  block,
  showHeading,
}: {
  block: AlertBlockData;
  showHeading: boolean;
}) {
  const respond = useBlockRespond();
  const [value, setValue] = useState(block.field.value);
  const [seenValue, setSeenValue] = useState(block.field.value);
  const [on, setOn] = useState(block.on);
  const [seenOn, setSeenOn] = useState(block.on);
  const [busy, setBusy] = useState(false);

  // React's prop-sync pattern: a room correction of the value or the switch
  // replaces the local state.
  if (block.field.value !== seenValue) {
    setSeenValue(block.field.value);
    setValue(block.field.value);
  }
  if (block.on !== seenOn) {
    setSeenOn(block.on);
    setOn(block.on);
  }

  const interactive = respond !== null && !busy;

  const commitValue = (): void => {
    if (respond === null || busy) {
      return;
    }
    const next = value.trim();
    if (next === '' || next === block.field.value.trim()) {
      setValue(block.field.value);
      return;
    }
    setValue(next);
    setBusy(true);
    void respond.answer(block.id, { fields: { value: next } }).then((data) => {
      setBusy(false);
      if (data === null) {
        setValue(block.field.value);
      }
    });
  };

  const toggle = (): void => {
    if (respond === null || busy) {
      return;
    }
    const previous = block.on;
    const next = !on;
    setOn(next);
    setBusy(true);
    void respond.answer(block.id, { done: next }).then((data) => {
      setBusy(false);
      if (data === null) {
        setOn(previous);
      }
    });
  };

  return (
    <>
      {showHeading && (
        <div className="flex items-center gap-2 text-[13px] font-medium text-[#a1a1a1]">
          <Bell className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{block.title}</span>
        </div>
      )}
      <div className="flex items-center gap-2.5">
        <input
          type="text"
          aria-label={block.field.label}
          value={value}
          maxLength={MAX_FIELD_CHARS}
          inputMode="decimal"
          disabled={!interactive}
          aria-disabled={!interactive}
          onChange={(event) => setValue(event.target.value)}
          onBlur={commitValue}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
          className="h-9 min-w-0 flex-1 rounded-[10px] px-2.5 font-mono text-[13px] text-[#ededed] outline-none focus-visible:ring-2 focus-visible:ring-[#ededed]/50 disabled:cursor-default"
          style={WELL_STYLE}
        />
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Alert on"
          disabled={!interactive}
          aria-disabled={!interactive}
          onClick={toggle}
          className={`flex h-[26px] w-11 shrink-0 items-center rounded-full p-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ededed]/50 disabled:cursor-default ${
            on ? 'justify-end' : 'justify-start'
          }`}
          style={on ? ON_TRACK_STYLE : ICON_KEY_STYLE}
        >
          <span
            className="block size-5 rounded-full"
            aria-hidden="true"
            style={on ? ON_KNOB_STYLE : OFF_KNOB_STYLE}
          />
        </button>
      </div>
      {block.note !== undefined && <p className="text-[12px] text-[#8a8a8a]">{block.note}</p>}
    </>
  );
}

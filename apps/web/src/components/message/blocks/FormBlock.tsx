// effect-plain: a presentational control; the block card owns the request.
import type { FormBlock as FormBlockData } from '@zilar/protocol';
import { Calendar, Minus, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useBlockReply, useBlockRespond } from './BlockRespond';

const MAX_FIELD_CHARS = 120;

// The board's well (`WebChoices.dc.html:28`).
const WELL_STYLE = {
  background: '#0c0c0c',
  border: '1px solid #1f1f1f',
  boxShadow:
    'inset 0 2px 6px rgba(0,0,0,.9), inset 0 1px 1px rgba(0,0,0,.8), inset 0 0 0 1px rgba(0,0,0,.4), 0 1px 0 rgba(255,255,255,.06)',
};
// The board's icon key and light key (`:27`, `:26`).
const ICON_KEY_STYLE = {
  border: '1px solid #2a2a2a',
  background: 'linear-gradient(180deg,#1c1c1c,#121212)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.06), 0 2px 6px rgba(0,0,0,.6)',
};
const LIGHT_KEY_STYLE = {
  border: '1px solid #ffffff',
  background: 'linear-gradient(180deg,#ffffff,#d9d9d9)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.4), 0 2px 6px rgba(0,0,0,.6)',
};

function valuesOf(block: FormBlockData): Record<string, string> {
  return Object.fromEntries(block.fields.map((field) => [field.id, field.value ?? '']));
}

/**
 * 16 · QUICK FORM: the optional title header, the fields in wells (two to a
 * row) and the light submit key. A number field gets −/+ dark icon keys around
 * a centered mono value. Submit answers with every field and sends the
 * "Label: value" pairs as the @AI reply. Each value is capped at 120 characters.
 */
export function FormBlock({ block, showHeading }: { block: FormBlockData; showHeading: boolean }) {
  const respond = useBlockRespond();
  const reply = useBlockReply();
  const [values, setValues] = useState<Record<string, string>>(() => valuesOf(block));
  const [seenBlock, setSeenBlock] = useState(block);
  const [busy, setBusy] = useState(false);

  // React's prop-sync pattern: the room correction replaces the drawn values.
  if (block !== seenBlock) {
    setSeenBlock(block);
    setValues(valuesOf(block));
  }

  const setValue = (fieldId: string, value: string): void => {
    setValues((current) => ({ ...current, [fieldId]: value.slice(0, MAX_FIELD_CHARS) }));
  };

  const step = (fieldId: string, delta: number): void => {
    const current = Number.parseInt(values[fieldId] ?? '', 10);
    const next = Math.max(0, (Number.isFinite(current) ? current : 0) + delta);
    setValue(fieldId, String(next));
  };

  const submit = (): void => {
    if (respond === null || busy) {
      return;
    }
    const fields = Object.fromEntries(
      block.fields.map((field) => [field.id, (values[field.id] ?? '').slice(0, MAX_FIELD_CHARS)]),
    );
    setBusy(true);
    void respond.answer(block.id, { fields }).then((data) => {
      setBusy(false);
      if (data === null) {
        return;
      }
      reply(block.fields.map((field) => `${field.label}: ${fields[field.id] ?? ''}`).join(', '));
    });
  };

  const interactive = respond !== null && !busy;
  const rows: FormBlockData['fields'][] = [];
  for (let index = 0; index < block.fields.length; index += 2) {
    rows.push(block.fields.slice(index, index + 2));
  }
  // The board puts Send on the last number field's row, right-aligned and
  // bottom-aligned; a form without numbers keeps it on its own row.
  const lastNumber = [...block.fields].reverse().find((field) => field.kind === 'number');

  const control = (field: FormBlockData['fields'][number]): ReactNode =>
    field.kind === 'number' ? (
      <span className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label={`Decrease ${field.label}`}
          disabled={!interactive}
          aria-disabled={!interactive}
          onClick={() => step(field.id, -1)}
          className="flex size-9 shrink-0 items-center justify-center rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ededed]/50 disabled:cursor-default"
          style={ICON_KEY_STYLE}
        >
          <Minus className="size-3.5 text-[#d4d4d4]" aria-hidden="true" />
        </button>
        <span className="w-8 shrink-0 text-center font-mono text-[15px] tabular-nums">
          {values[field.id] ?? ''}
        </span>
        <button
          type="button"
          aria-label={`Increase ${field.label}`}
          disabled={!interactive}
          aria-disabled={!interactive}
          onClick={() => step(field.id, 1)}
          className="flex size-9 shrink-0 items-center justify-center rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ededed]/50 disabled:cursor-default"
          style={ICON_KEY_STYLE}
        >
          <Plus className="size-3.5 text-[#d4d4d4]" aria-hidden="true" />
        </button>
      </span>
    ) : (
      <input
        type={field.kind === 'date' ? 'date' : 'text'}
        aria-label={field.label}
        value={values[field.id] ?? ''}
        maxLength={MAX_FIELD_CHARS}
        disabled={!interactive}
        aria-disabled={!interactive}
        onChange={(event) => setValue(field.id, event.target.value)}
        className="h-9 min-w-0 rounded-[10px] px-2.5 font-mono text-[13px] text-[#ededed] outline-none focus-visible:ring-2 focus-visible:ring-[#ededed]/50 disabled:cursor-default"
        style={WELL_STYLE}
      />
    );

  const submitKey = (
    <button
      type="button"
      disabled={!interactive}
      aria-disabled={!interactive}
      onClick={submit}
      className="inline-flex h-9 shrink-0 items-center justify-center rounded-[10px] px-4 text-[14px] font-medium text-[#0a0a0a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ededed]/50 disabled:cursor-default"
      style={LIGHT_KEY_STYLE}
    >
      {block.submit}
    </button>
  );

  return (
    <>
      {showHeading && block.title !== undefined && (
        <div className="flex items-center gap-2 text-[13px] font-medium text-[#a1a1a1]">
          <Calendar className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{block.title}</span>
        </div>
      )}
      <div className="flex flex-col gap-2">
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} className="flex items-end gap-2">
            {row.map((field) => (
              <div key={field.id} className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-[12px] text-[#a1a1a1]">{field.label}</span>
                {control(field)}
              </div>
            ))}
            {lastNumber !== undefined && row.includes(lastNumber) && submitKey}
          </div>
        ))}
        {lastNumber === undefined && <div className="flex justify-end">{submitKey}</div>}
      </div>
    </>
  );
}

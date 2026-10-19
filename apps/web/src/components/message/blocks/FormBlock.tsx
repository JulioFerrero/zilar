// effect-plain: a presentational control; the block card owns the request.
import { formatTime, sentAnswer, type FormAnswer as Answer } from '@zilar/chat-core';
import type { FormBlock as FormBlockData } from '@zilar/protocol';
import { Calendar, Check, Minus, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useBlockReply, useBlockRespond } from './BlockRespond';
import { ICON_KEY_STYLE, LIGHT_KEY_STYLE, MAX_FIELD_CHARS, WELL_STYLE } from './choiceStyles';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function usesNativeDate(field: FormBlockData['fields'][number]): boolean {
  return (
    field.kind === 'date' &&
    (field.value === undefined || field.value === '' || ISO_DATE.test(field.value))
  );
}

function valueOf(field: FormBlockData['fields'][number]): string {
  const value = field.value ?? '';
  return field.kind === 'number' && value === '' ? '0' : value;
}

function valuesOf(block: FormBlockData): Record<string, string> {
  return Object.fromEntries(block.fields.map((field) => [field.id, valueOf(field)]));
}

export function FormBlock({ block, showHeading }: { block: FormBlockData; showHeading: boolean }) {
  const respond = useBlockRespond();
  const reply = useBlockReply();
  const [values, setValues] = useState<Record<string, string>>(() => valuesOf(block));
  const [seenBlock, setSeenBlock] = useState(block);
  const [busy, setBusy] = useState(false);
  const [answered, setAnswered] = useState<Answer | null>(() => sentAnswer(block) ?? null);

  if (block !== seenBlock) {
    setSeenBlock(block);
    setValues(valuesOf(block));
    const next = sentAnswer(block);
    if (next !== undefined) {
      setAnswered((current) => (current?.mine === true ? current : next));
    }
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
      setAnswered((current) => current ?? { at: new Date(), mine: true });
      reply(block.fields.map((field) => `${field.label}: ${fields[field.id] ?? ''}`).join(', '));
    });
  };

  const interactive = respond !== null && !busy && answered === null;
  const rows: FormBlockData['fields'][] = [];
  for (let index = 0; index < block.fields.length; index += 2) {
    rows.push(block.fields.slice(index, index + 2));
  }
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
        type={usesNativeDate(field) ? 'date' : 'text'}
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

  const submitKey = answered === null && (
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

  const answeredRow = answered !== null && (
    <div className="flex items-center gap-2 text-[13px] text-[#a1a1a1]">
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-[#22c55e]">
        <Check className="size-3 text-[#0a0a0a]" strokeWidth={3} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate">
        {answered.mine
          ? 'You sent this'
          : answered.by === undefined
            ? 'Sent'
            : `${answered.by} sent this`}
      </span>
      <span className="shrink-0 font-mono text-[12px] tabular-nums text-[#8a8a8a]">
        {formatTime(answered.at)}
      </span>
    </div>
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
        {lastNumber === undefined && answered === null && (
          <div className="flex justify-end">{submitKey}</div>
        )}
        {answeredRow}
      </div>
    </>
  );
}

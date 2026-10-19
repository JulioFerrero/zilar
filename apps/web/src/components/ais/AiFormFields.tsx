import type { KeyboardEvent } from 'react';
import { useMemo, useRef, useState } from 'react';
import { Check, Wrench } from 'lucide-react';
import type { AiCatalogModel } from '@zilar/api-contract';
import {
  formatContextTokens,
  formatModelPrices,
  isLlmProvider,
  providerLabel,
} from '@zilar/chat-core';
import type { Connection } from '@/lib/api';
import { cn } from '@/lib/utils';
import { TextArea, TextInput } from '@/components/ui/text-input';
import { FieldError, SelectOption } from './AiPageShell';

export function AiLimitsFields({
  day,
  month,
  dayError,
  monthError,
  onDayChange,
  onMonthChange,
}: {
  day: string;
  month: string;
  dayError: string;
  monthError: string;
  onDayChange: (value: string) => void;
  onMonthChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-[14px] font-medium">Per day (USD)</span>
        <div className="flex items-center gap-2">
          <span className="text-[15px] text-muted-foreground">$</span>
          <TextInput
            aria-label="Per day amount"
            inputMode="decimal"
            value={day}
            onChange={(event) => onDayChange(event.target.value)}
            placeholder="No limit"
            className="w-32"
          />
        </div>
        {dayError !== '' && <FieldError>{dayError}</FieldError>}
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[14px] font-medium">Per month (USD)</span>
        <div className="flex items-center gap-2">
          <span className="text-[15px] text-muted-foreground">$</span>
          <TextInput
            aria-label="Per month amount"
            inputMode="decimal"
            value={month}
            onChange={(event) => onMonthChange(event.target.value)}
            placeholder="No limit"
            className="w-32"
          />
        </div>
        {monthError !== '' && <FieldError>{monthError}</FieldError>}
      </label>

      <p className="text-[13px] text-muted-foreground">
        Optional. Leave empty for no limit. Amounts are in USD.
      </p>
    </div>
  );
}

export function AiFormFields({
  name,
  persona,
  connections,
  selectedConnectionId,
  modelProvider,
  modelSuggestions,
  modelDraft,
  onNameChange,
  onPersonaChange,
  onChooseConnection,
  onModelChange,
}: {
  name: string;
  persona: string;
  connections: Connection[];
  selectedConnectionId: string | null;
  modelProvider: string;
  modelSuggestions: readonly string[];
  modelDraft: string;
  onNameChange: (value: string) => void;
  onPersonaChange: (value: string) => void;
  onChooseConnection: (id: string) => void;
  onModelChange: (value: string) => void;
}) {
  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-[14px] font-medium">Name</span>
        <TextInput
          aria-label="Name"
          value={name}
          maxLength={64}
          onChange={(event) => onNameChange(event.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[14px] font-medium">Persona</span>
        <TextArea
          aria-label="Persona"
          rows={10}
          maxLength={4000}
          value={persona}
          onChange={(event) => onPersonaChange(event.target.value)}
          placeholder="Describe how this AI should behave…"
          className="min-h-0"
        />
      </label>

      {connections.length > 1 && (
        <div className="flex flex-col gap-2">
          <span className="text-[14px] font-medium">Provider</span>
          {/* A connection whose provider is not an LLM one (GitHub) is dropped: it cannot run an AI. */}
          <div role="radiogroup" aria-label="Provider connection" className="flex flex-col gap-2">
            {connections
              .filter((connection) => isLlmProvider(connection.provider))
              .map((connection) => {
                const selected = connection.id === selectedConnectionId;
                return (
                  <SelectOption
                    key={connection.id}
                    selected={selected}
                    onClick={() => onChooseConnection(connection.id)}
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[14px] font-semibold text-accent">
                      {providerLabel(connection.provider).charAt(0)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium">
                        {providerLabel(connection.provider)}
                      </span>
                      <span className="block truncate text-[13px] text-muted-foreground">
                        {connection.label ?? 'No label'}
                      </span>
                    </span>
                  </SelectOption>
                );
              })}
          </div>
        </div>
      )}

      <ModelPicker
        provider={modelProvider}
        suggestions={modelSuggestions}
        value={modelDraft}
        onChange={onModelChange}
        inputId="ai-panel-model"
      />
    </>
  );
}

interface ModelOption {
  readonly id: string;
  readonly name: string;
  readonly detail?: string;
  readonly toolCalls: boolean;
}

function ModelPicker({
  provider,
  suggestions,
  models = [],
  value,
  onChange,
  inputId = 'ai-model',
}: {
  provider: string;
  suggestions: readonly string[];
  models?: readonly AiCatalogModel[];
  value: string;
  onChange: (model: string) => void;
  inputId?: string;
}) {
  const [query, setQuery] = useState('');
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const options: readonly ModelOption[] = useMemo(() => {
    if (models.length === 0) {
      return suggestions.map((id) => ({ id, name: id, toolCalls: false }));
    }
    const term = query.trim().toLowerCase();
    const matches =
      term === ''
        ? models
        : models.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(term));
    return matches.map((model) => ({
      id: model.id,
      name: model.name,
      detail: `${formatContextTokens(model.contextTokens)} · ${formatModelPrices(
        model.inputPricePerMTok,
        model.outputPricePerMTok,
      )}`,
      toolCalls: model.toolCalls,
    }));
  }, [models, suggestions, query]);

  const selectedIndex = options.findIndex((option) => option.id === value);
  // With a custom value nothing is checked, but the first option still takes the
  // tab stop so the radiogroup stays keyboard reachable.
  const tabbableIndex = selectedIndex === -1 ? 0 : selectedIndex;

  const moveSelection = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = options.length - 1;
    let next: number | undefined;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      next = index === last ? 0 : index + 1;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      next = index === 0 ? last : index - 1;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = last;
    }
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    const option = options[next];
    if (option === undefined) {
      return;
    }
    onChange(option.id);
    optionRefs.current[next]?.focus();
  };

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-[14px] font-medium">Model</span>
        <TextInput
          id={inputId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={`${providerLabel(provider)} model name`}
          maxLength={256}
          autoComplete="off"
        />
      </label>

      {models.length > 0 && (
        <TextInput
          aria-label="Search models"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search models"
          maxLength={64}
          autoComplete="off"
        />
      )}

      {options.length === 0 ? (
        models.length > 0 || suggestions.length > 0 ? (
          <p className="text-[13px] text-muted-foreground">No models match your search.</p>
        ) : null
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            {models.length > 0 ? 'Catalog' : 'Suggested'}
          </span>
          <div role="radiogroup" aria-label="Model" className="flex flex-col gap-2">
            {options.map((option, index) => {
              const selected = value === option.id;
              return (
                <button
                  key={option.id}
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={index === tabbableIndex ? 0 : -1}
                  onClick={() => onChange(option.id)}
                  onKeyDown={(event) => moveSelection(event, index)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-lg border border-edge px-3 py-2 text-left text-[15px] transition-colors',
                    selected
                      ? 'segment-raised text-foreground'
                      : 'raised-pill text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{option.name}</span>
                    {option.detail !== undefined && (
                      <span className="truncate text-[12px] text-muted-foreground">
                        {option.detail}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {option.toolCalls && (
                      <span className="flex items-center gap-1 rounded-full border border-divider px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        <Wrench className="size-3" aria-hidden="true" />
                        tools
                      </span>
                    )}
                    {selected && <Check className="size-4 shrink-0" aria-hidden="true" />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

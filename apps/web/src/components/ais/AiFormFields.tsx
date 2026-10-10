import type { Connection } from '@/lib/api';
import { TextArea, TextInput } from '@/components/ui/text-input';
import { ConnectionPicker } from './ConnectionPicker';
import { LimitsFields } from './LimitsFields';
import { ModelPicker } from './ModelPicker';

/** The AI's name, persona, provider and model fields. The panel owns the
 *  values and the save patch; this renders the controls. */
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
          <ConnectionPicker
            connections={connections}
            value={selectedConnectionId}
            onChange={onChooseConnection}
          />
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

/** The AI's USD daily and monthly caps, the panel's other saved form fields. */
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
    <LimitsFields
      day={day}
      month={month}
      dayError={dayError}
      monthError={monthError}
      onDayChange={onDayChange}
      onMonthChange={onMonthChange}
    />
  );
}

import { AI_TEMPLATE_OPTIONS } from '@zilar/chat-core';
import { Combobox } from '@/components/ui/combobox';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { OrbPicker } from './OrbPicker';
import type { NewAiFlow } from './useNewAiFlow';

const TEMPLATE_OPTIONS = AI_TEMPLATE_OPTIONS.filter((option) => option.id !== 'custom').map(
  (option) => ({ value: option.id, label: option.label }),
);

/** Step 3: the orb, the name, the model and the template. */
export function ModelStep({ flow }: { flow: NewAiFlow }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-3.5">
        <OrbPicker flow={flow} />
        <label className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="text-[13px] font-medium">Name</span>
          <span className="well-surface flex h-10 items-center rounded-[10px] px-3">
            <input
              aria-label="Name"
              type="text"
              autoComplete="off"
              value={flow.name}
              maxLength={64}
              placeholder="Research helper"
              onChange={(event) => flow.setName(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-subtle-foreground"
            />
          </span>
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">Model</span>
        {flow.modelOptions.length > 0 ? (
          <Combobox
            label="Model"
            options={flow.modelOptions}
            value={flow.model === '' ? null : flow.model}
            onValueChange={flow.setModel}
            placeholder="Search models"
            triggerPlaceholder="Choose a model"
          />
        ) : (
          <span className="well-surface flex h-10 items-center rounded-[10px] px-3">
            <input
              aria-label="Model"
              type="text"
              autoComplete="off"
              value={flow.model}
              maxLength={256}
              placeholder="Model id"
              onChange={(event) => flow.setModel(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-subtle-foreground"
            />
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">Template</span>
        <SegmentedControl
          ariaLabel="Template"
          tone="choice"
          mode="radio"
          options={TEMPLATE_OPTIONS}
          value={flow.template}
          onChange={flow.setTemplate}
        />
      </div>
    </div>
  );
}

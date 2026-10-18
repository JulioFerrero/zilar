import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { DialogStepper } from '../ui/dialog-stepper';
import { KeyStep } from './new-ai/KeyStep';
import { ProviderStep } from './new-ai/ProviderStep';
import { useNewAiFlow, type NewAiFlow } from './new-ai/useNewAiFlow';
import { OrbPicker } from './new-ai/OrbPicker';
import { Combobox } from '@/components/ui/combobox';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';
import type { PublicAi } from '@/lib/api';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { type ChatSummary, AI_TEMPLATE_OPTIONS } from '@zilar/chat-core';
import { Cloud, Power, Server, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router';

const TEMPLATE_OPTIONS = AI_TEMPLATE_OPTIONS.filter((option) => option.id !== 'custom').map(
  (option) => ({ value: option.id, label: option.label }),
);

function ModelStep({ flow }: { flow: NewAiFlow }) {
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

function computerOptions(cloudAvailable: boolean): SegmentedOption[] {
  return [
    { value: 'off', label: 'Off', icon: Power },
    { value: 'cloud', label: 'Zilar', icon: Cloud, disabled: !cloudAvailable },
    { value: 'runner', label: 'Machine', icon: Server },
    { value: 'auto', label: 'Auto', icon: Sparkles },
  ];
}

function MoneyField({
  label,
  value,
  error,
  onChange,
}: {
  label: string;
  value: string;
  error: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[13px] font-medium">{label}</span>
      <span className="well-surface flex h-10 items-center gap-1.5 rounded-[10px] px-3">
        <span className="font-mono text-[14px] text-muted-foreground">$</span>
        <input
          aria-label={label}
          inputMode="decimal"
          value={value}
          placeholder="No limit"
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-subtle-foreground"
        />
      </span>
      {error !== '' && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </label>
  );
}

function SetupStep({ flow }: { flow: NewAiFlow }) {
  const needsMachine = flow.computerMode === 'runner' || flow.computerMode === 'auto';

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">Computer</span>
        <SegmentedControl
          ariaLabel="Computer"
          tone="choice"
          mode="radio"
          options={computerOptions(flow.cloudAvailable)}
          value={flow.computerMode}
          onChange={flow.setComputerMode}
        />
        {needsMachine && (
          <Combobox
            label="Machine"
            options={flow.machines
              .filter((machine) => machine.status === 'approved')
              .map((machine) => ({
                value: machine.id,
                label: machine.name,
                ...(machine.online === true ? { dot: 'online' as const } : {}),
              }))}
            value={flow.machineId}
            onValueChange={flow.setMachineId}
            placeholder="Search machines"
            triggerPlaceholder="Choose a machine"
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MoneyField label="Per day" value={flow.day} error={flow.dayError} onChange={flow.setDay} />
        <MoneyField
          label="Per month"
          value={flow.month}
          error={flow.monthError}
          onChange={flow.setMonth}
        />
      </div>
    </div>
  );
}

export function NewAiDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const storeApi = useChatStoreApi();

  const flow = useNewAiFlow({
    onClose,
    onCreated: (created: PublicAi) => {
      const summary: ChatSummary = {
        id: created.jid,
        title: created.name,
        kind: 'dm',
        isAI: true,
        space: 'personal',
        unread: 0,
        muted: false,
        online: false,
        createdAt: new Date(created.createdAt),
      };
      storeApi.setState((state) => ({
        chats: state.chats.some((chat) => chat.id === created.jid)
          ? state.chats
          : [summary, ...state.chats],
      }));
      onClose();
      navigate(`/c/${encodeURIComponent(created.jid)}`);
    },
  });

  return (
    <Dialog
      open
      onClose={flow.close}
      title="New AI"
      size="lg"
      busy={flow.busy}
      stepper={<DialogStepper steps={flow.steps} current={flow.step} onStep={flow.goToStep} />}
      error={flow.error === '' ? undefined : flow.error}
      onSubmit={(event) => {
        event.preventDefault();
        flow.primary();
      }}
      footer={
        <>
          {flow.step > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="key-icon mr-auto text-foreground"
              disabled={flow.busy}
              onClick={flow.back}
            >
              Back
            </Button>
          )}
          <Button type="submit" size="lg" disabled={flow.primaryDisabled}>
            {flow.primaryLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {flow.step === 0 && <ProviderStep keys={flow.keys} />}
        {flow.step === 1 && <KeyStep keys={flow.keys} />}
        {flow.step === 2 && <ModelStep flow={flow} />}
        {flow.step === 3 && <SetupStep flow={flow} />}
      </div>
    </Dialog>
  );
}

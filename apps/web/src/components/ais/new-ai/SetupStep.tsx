import { Cloud, Power, Server, Sparkles } from 'lucide-react';
import { Combobox } from '@/components/ui/combobox';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';
import type { NewAiFlow } from './useNewAiFlow';

function computerOptions(cloudAvailable: boolean): SegmentedOption[] {
  return [
    { value: 'off', label: 'Off', icon: Power },
    ...(cloudAvailable ? [{ value: 'cloud', label: 'Zilar', icon: Cloud }] : []),
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

/** Step 4: where the AI runs and its USD caps, then Create AI. */
export function SetupStep({ flow }: { flow: NewAiFlow }) {
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

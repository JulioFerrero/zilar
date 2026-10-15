import { Cloud, Laptop, PowerOff, Sparkles } from 'lucide-react-native';
import { View } from 'react-native';

import { LimitsFields } from '@/components/ais/limits-fields';
import type { ComputerMode } from '@/components/ais/computer-picker';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';
import { SelectSheet } from '@/components/ui/select-sheet';
import { Text } from '@/components/ui/text';

import type { NewAiFlow } from './use-new-ai-flow';

const COMPUTER_OPTIONS: SegmentedOption[] = [
  { value: 'off', label: 'Off', icon: PowerOff },
  { value: 'cloud', label: 'Zilar', icon: Cloud },
  { value: 'runner', label: 'Machine', icon: Laptop },
  { value: 'auto', label: 'Auto', icon: Sparkles },
];

/**
 * Step 4 (PhoneSetup.dc.html): where the AI's computer runs and the spending
 * caps. Zilar is inert until the server says cloud desks are wired; Machine and
 * Auto reveal the machine picker.
 */
export function SetupStep({ flow }: { flow: NewAiFlow }) {
  const machineOptions = flow.machines.map((machine) => ({
    value: machine.id,
    label: machine.name,
    ...(machine.online === true ? { dot: 'online' as const } : {}),
  }));
  const needsMachine = flow.computer === 'runner' || flow.computer === 'auto';
  const computerOptions = COMPUTER_OPTIONS.map((option) =>
    option.value === 'cloud' ? { ...option, disabled: !flow.cloud } : option,
  );

  return (
    <View className="gap-5">
      <View className="gap-2">
        <Text className="text-[13px] font-medium text-foreground">Computer</Text>
        <SegmentedControl
          mode="radio"
          tone="choice"
          accessibilityLabel="Computer"
          value={flow.computer}
          options={computerOptions}
          onChange={(value) => flow.setComputer(value as ComputerMode)}
        />
        {needsMachine ? (
          <SelectSheet
            label="Machine"
            value={flow.machineId}
            options={machineOptions}
            onChange={flow.setMachineId}
            placeholder="Select a machine"
          />
        ) : null}
      </View>

      <LimitsFields
        day={flow.day}
        month={flow.month}
        dayError={flow.dayError}
        monthError={flow.monthError}
        onDayChange={flow.setDay}
        onMonthChange={flow.setMonth}
      />
    </View>
  );
}

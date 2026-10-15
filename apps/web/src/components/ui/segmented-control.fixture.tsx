import { Cloud, Power, Server, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { SegmentedControl, type SegmentedOption } from './segmented-control';

const OPTIONS: SegmentedOption[] = [
  { value: 'all', label: 'All chats', count: 54 },
  { value: 'people', label: 'People' },
  { value: 'ais', label: 'AIs', count: 7 },
];

const COMPUTER: SegmentedOption[] = [
  { value: 'off', label: 'Off', icon: Power },
  { value: 'zilar', label: 'Zilar', icon: Cloud },
  { value: 'machine', label: 'Machine', icon: Server },
  { value: 'auto', label: 'Auto', icon: Sparkles },
];

function Controlled({ initial = 'all' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <SegmentedControl options={OPTIONS} value={value} onChange={setValue} ariaLabel="Folders" />
  );
}

function ChoiceControl() {
  const [value, setValue] = useState('auto');
  return (
    <SegmentedControl
      options={COMPUTER}
      value={value}
      onChange={setValue}
      ariaLabel="Computer"
      mode="radio"
      tone="choice"
    />
  );
}

function DisabledChoice() {
  const [value, setValue] = useState('off');
  return (
    <SegmentedControl
      options={[
        { value: 'off', label: 'Off', icon: Power },
        { value: 'zilar', label: 'Zilar', icon: Cloud, disabled: true },
        { value: 'machine', label: 'Machine', icon: Server },
        { value: 'auto', label: 'Auto', icon: Sparkles },
      ]}
      value={value}
      onChange={setValue}
      ariaLabel="Computer"
      mode="radio"
      tone="choice"
    />
  );
}

export default {
  WithCounts: <Controlled />,
  WithoutCounts: (
    <SegmentedControl
      options={[
        { value: 'week', label: 'Week' },
        { value: 'month', label: 'Month' },
      ]}
      value="week"
      onChange={() => {}}
      ariaLabel="Range"
    />
  ),
  LastSelected: <Controlled initial="ais" />,
  Choice: <ChoiceControl />,
  Disabled: <DisabledChoice />,
};

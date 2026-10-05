import { useState } from 'react';
import { SegmentedControl, type SegmentedOption } from './segmented-control';

const OPTIONS: SegmentedOption[] = [
  { value: 'all', label: 'All chats', count: 54 },
  { value: 'people', label: 'People' },
  { value: 'ais', label: 'AIs', count: 7 },
];

function Controlled({ initial = 'all' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <SegmentedControl options={OPTIONS} value={value} onChange={setValue} ariaLabel="Folders" />
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
};

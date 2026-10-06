import { useState } from 'react';
import { Checkbox } from './checkbox';

function Toggle({
  initial = false,
  label = 'Remember me',
  disabled = false,
}: {
  initial?: boolean;
  label?: string;
  disabled?: boolean;
}) {
  const [checked, setChecked] = useState(initial);
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-list-hover">
      <Checkbox checked={checked} onCheckedChange={setChecked} label={label} disabled={disabled} />
      <span className="truncate text-[15px]">{label}</span>
    </label>
  );
}

export default {
  Off: <Toggle initial={false} />,
  On: <Toggle initial label="Email me updates" />,
  DisabledOff: <Toggle label="Disabled off" disabled />,
  DisabledOn: <Toggle initial label="Disabled on" disabled />,
};

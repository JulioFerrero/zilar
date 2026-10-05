import { useState } from 'react';
import { Switch } from './switch';

function Toggle({
  initial = false,
  label = 'Notifications',
  disabled = false,
}: {
  initial?: boolean;
  label?: string;
  disabled?: boolean;
}) {
  const [checked, setChecked] = useState(initial);
  return (
    <Switch checked={checked} onCheckedChange={setChecked} label={label} disabled={disabled} />
  );
}

export default {
  Off: <Toggle initial={false} />,
  On: <Toggle initial label="Read receipts" />,
  DisabledOff: <Toggle label="Sounds" disabled />,
  DisabledOn: <Toggle initial label="Vibrate" disabled />,
};

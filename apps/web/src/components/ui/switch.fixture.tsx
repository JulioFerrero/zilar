import { useState } from 'react';
import { Switch } from './switch';

function Toggle({
  initial = false,
  label = 'Notifications',
  disabled = false,
  hideLabel = false,
}: {
  initial?: boolean;
  label?: string;
  disabled?: boolean;
  hideLabel?: boolean;
}) {
  const [checked, setChecked] = useState(initial);
  return (
    <Switch
      checked={checked}
      onCheckedChange={setChecked}
      label={label}
      disabled={disabled}
      hideLabel={hideLabel}
    />
  );
}

export default {
  Off: <Toggle initial={false} />,
  On: <Toggle initial label="Read receipts" />,
  DisabledOff: <Toggle label="Sounds" disabled />,
  DisabledOn: <Toggle initial label="Vibrate" disabled />,
  HiddenLabel: <Toggle initial label="Hidden label" hideLabel />,
};

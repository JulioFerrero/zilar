import { useState } from 'react';
import { LogOut, Settings, UserPlus } from 'lucide-react';
import { Button } from './button';
import { Menu, MenuItem, MenuRadioGroup, MenuRadioItem } from './menu';

function OpenMenu() {
  const [open, setOpen] = useState(false);
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      label="Sample actions"
      trigger={<Button variant="outline">Open menu</Button>}
    >
      <MenuItem icon={UserPlus} onSelect={() => setOpen(false)}>
        Invite a friend
      </MenuItem>
      <MenuItem icon={Settings} onSelect={() => setOpen(false)}>
        Settings
      </MenuItem>
      <MenuItem icon={LogOut} destructive onSelect={() => setOpen(false)}>
        Sign out
      </MenuItem>
    </Menu>
  );
}

function OpenRadioMenu() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('in_progress');
  const options = ['open', 'in_progress', 'done'];
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      label="Change status"
      trigger={<Button variant="outline">Status: {selected}</Button>}
    >
      <MenuRadioGroup value={selected} onValueChange={setSelected}>
        {options.map((option) => (
          <MenuRadioItem key={option} value={option} className="text-[13px]">
            {option}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </Menu>
  );
}

export default {
  Default: <OpenMenu />,
  RadioGroup: <OpenRadioMenu />,
};

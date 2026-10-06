import { useState } from 'react';
import { LogOut, Settings, UserPlus } from 'lucide-react';
import { Button } from './button';
import { Menu, MenuItem, MenuRadioItem } from './menu';

function OpenMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button variant="outline" onClick={() => setOpen((value) => !value)}>
        Open menu
      </Button>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        label="Sample actions"
        closeLabel="Close sample menu"
        className="top-full left-0 mt-1"
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
    </div>
  );
}

function OpenRadioMenu() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('in_progress');
  const options = ['open', 'in_progress', 'done'];
  return (
    <div className="relative">
      <Button variant="outline" onClick={() => setOpen((value) => !value)}>
        Status: {selected}
      </Button>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        label="Change status"
        closeLabel="Close status menu"
        className="top-full left-0 mt-1 min-w-[160px]"
      >
        {options.map((option) => (
          <MenuRadioItem
            key={option}
            checked={option === selected}
            onSelect={() => {
              setSelected(option);
              setOpen(false);
            }}
            className="text-[13px]"
          >
            {option}
          </MenuRadioItem>
        ))}
      </Menu>
    </div>
  );
}

export default {
  Default: <OpenMenu />,
  RadioGroup: <OpenRadioMenu />,
};

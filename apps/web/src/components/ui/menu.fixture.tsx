import { useState } from 'react';
import { LogOut, Settings, UserPlus } from 'lucide-react';
import { Button } from './button';
import { Menu, MenuItem } from './menu';

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

export default {
  Default: <OpenMenu />,
};

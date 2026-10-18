import { useState } from 'react';
import { LogOut, Settings, UserPlus } from 'lucide-react';
import { Button } from './button';
import { Menu, MenuItem } from './menu';

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

export default {
  Default: <OpenMenu />,
};

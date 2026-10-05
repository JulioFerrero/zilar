import { Plus, Search, Settings } from 'lucide-react';
import { IconButton } from './icon-button';

export default {
  Default: (
    <IconButton aria-label="New chat">
      <Plus size={18} />
    </IconButton>
  ),
  Row: (
    <div className="flex items-center gap-2">
      <IconButton aria-label="Search">
        <Search size={18} />
      </IconButton>
      <IconButton aria-label="Settings">
        <Settings size={18} />
      </IconButton>
    </div>
  ),
  Sizes: (
    <div className="flex items-center gap-2">
      <IconButton aria-label="Small" size={28} radius={8}>
        <Plus size={16} />
      </IconButton>
      <IconButton aria-label="Large" size={44} radius={12}>
        <Plus size={20} />
      </IconButton>
    </div>
  ),
  Disabled: (
    <IconButton aria-label="Disabled" disabled>
      <Plus size={18} />
    </IconButton>
  ),
};
